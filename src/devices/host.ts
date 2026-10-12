/** End host with one NIC (PC, Server): IP config, DHCP client, TCP, DNS resolver. */
import type { NetDevice } from '../net/network.ts';
import type { Frame, IpPacket, UdpDatagram, AppPayload, DnsType } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, DNS_PORT, PC_TTL } from '../net/packets.ts';

export { DHCP_SERVER_PORT, DNS_PORT };
import { IpStack } from '../net/ipstack.ts';
import type { L3Iface, StackHost, Egress } from '../net/ipstack.ts';
import { TcpLayer } from '../net/tcp.ts';
import type { TcpResult } from '../net/tcp.ts';
import { DnsResolver } from '../net/dns.ts';
import type { DnsResult } from '../net/dns.ts';
import { DhcpClient } from '../dhcp/client.ts';
import type { Lease } from '../dhcp/client.ts';
import { DETACHED } from './hooks.ts';
import type { DeviceHooks } from './hooks.ts';
import { macFromSeed, clientIdFromMac } from '../core/mac.ts';
import { inSubnet, BROADCAST_IP } from '../core/ip.ts';
import type { SimClock } from '../core/clock.ts';

export const HOST_PORT = 'FastEthernet0';
const APIPA_NET = 0xa9fe0000;
const APIPA_PREFIX = 16;
const APIPA_HOST_SPACE = 0xfe00;

export type IpMode = 'static' | 'dhcp';
export type DhcpStatus = 'idle' | 'requesting' | 'ok' | 'failed';
export type HostOs = 'windows' | 'linux';

const MAX_LABEL = 63;
const MAX_HOSTNAME = 253;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** RFC 1123 host name (letters, digits and hyphens; dot-separated labels). Returns an error or null. */
export function validHostname(name: string): string | null {
  if (name.trim() === '') return 'El nombre de host no puede estar vacío.';
  if (name.length > MAX_HOSTNAME) return `El nombre de host admite como máximo ${MAX_HOSTNAME} caracteres.`;
  const labels = name.split('.');
  if (labels.some((l) => l.length > MAX_LABEL)) return `Cada parte del nombre admite como máximo ${MAX_LABEL} caracteres.`;
  if (!labels.every((l) => LABEL.test(l))) return 'Usa solo letras sin tilde, números y guiones (sin espacios; no puede empezar ni acabar en guion).';
  return null;
}

export interface HostIpConfig {
  readonly mode: IpMode;
  readonly ip?: number;
  readonly prefix?: number;
  readonly gateway?: number;
  readonly dns?: number;
}

export abstract class Host implements NetDevice, StackHost {
  abstract readonly kind: 'pc' | 'server';
  readonly id: string;
  /** Static host name (hostnamectl, /etc/hostname, Windows computer name). */
  name: string;
  /** Transient name set with `hostname NAME` (not saved); undefined = the static name. */
  transientName: string | undefined = undefined;
  /** hostnamectl's pretty host name (free text). */
  prettyName: string | undefined = undefined;
  readonly mac: string;
  hooks: DeviceHooks = DETACHED;
  config: HostIpConfig = { mode: 'static' };
  /** Operating system of the default terminal (both terminals are always available). */
  os: HostOs = 'windows';
  /** Windows-style clients send option 61 = 01 + MAC. */
  sendClientId = true;
  /** Option 61 to send instead of 01 + MAC (lowercase hex), like dhclient's `send dhcp-client-identifier`. */
  clientIdOverride: string | undefined = undefined;
  portUp = true;
  dhcpStatus: DhcpStatus = 'idle';
  readonly stack: IpStack;
  readonly dhcpClient: DhcpClient;
  readonly tcp: TcpLayer;
  readonly resolver: DnsResolver;
  readonly clock: SimClock;
  private readonly statusListeners = new Set<() => void>();

  readonly dropOnArpMiss = false;
  readonly ttl = PC_TTL;

  constructor(id: string, name: string, clock: SimClock, seed: number) {
    this.id = id;
    this.name = name;
    this.clock = clock;
    this.mac = macFromSeed(seed);
    this.stack = new IpStack(this, () => clock.now());
    this.dhcpClient = this.createDhcpClient();
    this.tcp = new TcpLayer({
      send: (p) => this.stack.send(p),
      sourceFor: (dst) => (this.route(dst) ? this.config.ip : undefined),
      schedule: (d, fn) => this.hooks.schedule(d, fn),
      ttl: PC_TTL,
    });
    this.resolver = new DnsResolver({
      sendQuery: (server, sport, msg) => this.sendUdp(server, sport, DNS_PORT, { dns: msg }),
      schedule: (d, fn) => this.hooks.schedule(d, fn),
    });
  }

  displayName(): string {
    return this.name;
  }

  /** The name the running system uses (gethostname). */
  runtimeName(): string {
    return this.transientName ?? this.name;
  }

  /** Sets the static host name (and the running one). Throws on an invalid name. */
  setHostname(name: string): void {
    const err = validHostname(name);
    if (err) throw new Error(err);
    this.name = name;
    this.transientName = undefined;
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  protected changed(): void {
    for (const l of this.statusListeners) l();
  }

  // ------------------------------------------------------------ IP configuration

  setStatic(cfg: Omit<HostIpConfig, 'mode'>): void {
    this.dhcpClient.stop();
    this.dhcpStatus = 'idle';
    this.config = { ...cfg, mode: 'static' };
    this.stack.flushArp();
    this.changed();
  }

  /** Switches to DHCP and starts DORA. */
  useDhcp(): void {
    this.config = { mode: 'dhcp' };
    this.dhcpStatus = 'requesting';
    this.stack.flushArp();
    this.changed();
    this.dhcpClient.start();
  }

  clientId(): string | undefined {
    if (!this.sendClientId) return undefined;
    return this.clientIdOverride ?? clientIdFromMac(this.mac);
  }

  private createDhcpClient(): DhcpClient {
    return new DhcpClient({
      mac: this.mac,
      send: (msg, dst, src) => {
        const dhcp = { ...msg, options: { ...msg.options, clientId: this.clientId(), hostname: this.runtimeName() } };
        this.sendUdp(dst, DHCP_CLIENT_PORT, DHCP_SERVER_PORT, { dhcp }, src);
      },
      schedule: (d, fn) => this.hooks.schedule(d, fn),
      now: () => this.clock.now(),
      onBound: (lease) => this.applyLease(lease),
      onFailed: () => this.applyApipa(),
      onLost: () => { this.config = { mode: 'dhcp' }; this.changed(); },
    });
  }

  private applyLease(lease: Lease): void {
    this.config = { mode: 'dhcp', ip: lease.ip, prefix: lease.prefix, gateway: lease.routers[0], dns: lease.dnsServers[0] };
    this.dhcpStatus = 'ok';
    this.changed();
  }

  private applyApipa(): void {
    const host = (parseInt(this.mac.slice(8), 16) % APIPA_HOST_SPACE) + 0x100;
    this.config = { mode: 'dhcp', ip: (APIPA_NET + host) >>> 0, prefix: APIPA_PREFIX };
    this.dhcpStatus = 'failed';
    this.changed();
  }

  // ------------------------------------------------------------ transport helpers

  /** Sends a UDP datagram; broadcasts go out of the NIC directly. */
  sendUdp(dst: number, sport: number, dport: number, body: Omit<UdpDatagram, 'sport' | 'dport'>, src?: number): boolean {
    const from = src ?? this.config.ip ?? 0;
    const packet: IpPacket = { src: from, dst, ttl: PC_TTL, protocol: 'udp', udp: { sport, dport, ...body } };
    if (dst === BROADCAST_IP) {
      this.stack.broadcast(HOST_PORT, packet);
      return true;
    }
    return this.stack.send(packet);
  }

  /** DNS lookup through the configured server (asynchronous). */
  lookup(name: string, type: DnsType, done: (r: DnsResult) => void, server = this.config.dns): void {
    this.resolver.query(server, name, type, done);
  }

  /** Opens a TCP connection and exchanges one request/reply (asynchronous). */
  connect(dst: number, port: number, payload: AppPayload, done: (r: TcpResult) => void, timeoutMs?: number): void {
    this.tcp.request(dst, port, payload, done, timeoutMs);
  }

  // ------------------------------------------------------------ NetDevice

  portNames(): readonly string[] {
    return [HOST_PORT];
  }

  portAdminUp(): boolean {
    return this.portUp;
  }

  linkUp(): boolean {
    return this.portUp && this.hooks.peerUp(HOST_PORT);
  }

  receive(_port: string, frame: Frame): void {
    this.stack.receiveFrame(HOST_PORT, frame);
  }

  onLinkEvent(_port: string, up: boolean): void {
    if (up && this.config.mode === 'dhcp' && this.dhcpStatus !== 'ok') this.useDhcp();
    this.changed();
  }

  ownsIp(ip: number): boolean {
    return this.config.ip === ip;
  }

  // ------------------------------------------------------------ StackHost

  l3Iface(name: string): L3Iface | undefined {
    return name === HOST_PORT ? this.l3Ifaces()[0] : undefined;
  }

  l3Ifaces(): readonly L3Iface[] {
    const { ip, prefix } = this.config;
    const addrs = ip !== undefined && prefix !== undefined ? [{ ip, prefix }] : [];
    return [{ name: HOST_PORT, mac: this.mac, addrs, up: this.linkUp() }];
  }

  emit(_iface: string, frame: Frame): void {
    this.hooks.transmit(HOST_PORT, frame);
  }

  schedule(delayMs: number, fn: () => void): void {
    this.hooks.schedule(delayMs, fn);
  }

  route(dst: number): Egress | null {
    const { ip, prefix, gateway } = this.config;
    if (ip === undefined || prefix === undefined) return null;
    if (inSubnet(dst, ip, prefix) || dst === BROADCAST_IP) return { iface: HOST_PORT, nextHop: dst };
    return gateway !== undefined ? { iface: HOST_PORT, nextHop: gateway } : null;
  }

  deliver(_iface: string, packet: IpPacket): void {
    if (packet.tcp) {
      this.tcp.receive(packet);
      return;
    }
    const udp = packet.udp;
    if (!udp) return;
    if (udp.dhcp && udp.dport === DHCP_CLIENT_PORT) this.dhcpClient.receive(udp.dhcp);
    else if (udp.dns?.response && this.resolver.ownsPort(udp.dport)) this.resolver.receive(udp.dns, packet.src);
    else this.onUdp(packet);
  }

  /** Server-side UDP services (DHCP on 67, DNS on 53). Plain hosts ignore them. */
  protected onUdp(_packet: IpPacket): void {
    // A PC runs no UDP services.
  }
}

