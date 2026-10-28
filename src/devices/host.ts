/** End host with one NIC (PC, Server): IP config, DHCP client, TCP, DNS resolver. */
import type { HostKind } from './kinds.ts';
import { t } from '../i18n/t.ts';
import type { NetDevice } from '../net/network.ts';
import type { Frame, IpPacket, UdpDatagram, AppPayload, DnsType, IcmpQuote, UnreachableCode } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, DNS_PORT, LINUX_TTL, PC_TTL } from '../net/packets.ts';

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
import { Kernel } from './host-kernel.ts';
import { lookupRoute, MAX_STATIC_ROUTES } from './host-nics.ts';
import type { WgManager } from './wg-manager.ts';
import type { NicInfo, StaticRoute } from './host-nics.ts';
import { inSubnet, BROADCAST_IP } from '../core/ip.ts';
import type { SimClock } from '../core/clock.ts';

export const HOST_PORT = 'FastEthernet0';
/** Linux name of the NIC (ip, nft iif/oif, netplan). */
export const HOST_LINUX_IF = 'eth0';
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
  if (name.trim() === '') return t('host.err.empty');
  if (name.length > MAX_HOSTNAME) return t('host.err.long', { max: MAX_HOSTNAME });
  const labels = name.split('.');
  if (labels.some((l) => l.length > MAX_LABEL)) return t('host.err.label', { max: MAX_LABEL });
  if (!labels.every((l) => LABEL.test(l))) return t('host.err.chars');
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
  abstract readonly kind: HostKind;
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
  /** DNS search domains of netplan's `nameservers.search` (the DHCP domain is added while the lease lasts). */
  dnsSearch: readonly string[] = [];
  /** Operating system of the default terminal (both terminals are always available). */
  os: HostOs = 'windows';
  /** Windows-style clients send option 61 = 01 + MAC. */
  sendClientId = true;
  /** «Prompt con marca de fecha y hora» in this device's terminals (saved with the topology). */
  timestampPrompt = false;
  /** Option 61 to send instead of 01 + MAC (lowercase hex), like dhclient's `send dhcp-client-identifier`. */
  clientIdOverride: string | undefined = undefined;
  portUp = true;
  dhcpStatus: DhcpStatus = 'idle';
  readonly stack: IpStack;
  readonly dhcpClient: DhcpClient;
  readonly tcp: TcpLayer;
  readonly resolver: DnsResolver;
  readonly clock: SimClock;
  /** sysctl, netfilter (nftables) and the kernel log. */
  readonly kernel: Kernel;
  /** Routes added with `ip route add NET via GW` (running configuration; the default route is `config.gateway`). */
  staticRoutes: readonly StaticRoute[] = [];
  private readonly statusListeners = new Set<() => void>();

  readonly dropOnArpMiss = false;
  /** Initial TTL of what this host sends: 64 on Linux, 128 on Windows. */
  get ttl(): number { return this.os === 'linux' ? LINUX_TTL : PC_TTL; }
  /** Linux aborts a connect() in SYN_SENT on an ICMP unreachable quoting it (tcp_v4_err); Windows ignores it. */
  icmpUnreachable(orig: IcmpQuote, code: UnreachableCode): void { if (orig.protocol === 'tcp' && this.os === 'linux') this.tcp.icmpUnreachable(orig, code); }
  /** Windows never answers an echo to a broadcast address; Linux only with icmp_echo_ignore_broadcasts=0. */
  ignoresBroadcastEcho = (): boolean => this.os === 'windows' || this.kernel.sysctl.enabled('net.ipv4.icmp_echo_ignore_broadcasts');

  constructor(id: string, name: string, clock: SimClock, seed: number) {
    this.id = id;
    this.name = name;
    this.clock = clock;
    this.mac = macFromSeed(seed);
    this.kernel = new Kernel({
      clock,
      runtimeName: () => this.runtimeName(),
      setTransientName: (n) => this.setTransientName(n),
      linuxIfName: (port) => this.linuxIfName(port),
      linuxIfIp: (name) => this.linuxIfIp(name),
      sendRaw: (p) => {
        const egress = this.route(p.dst);
        if (egress) this.stack.sendVia(egress, p);
      },
    });
    this.kernel.sysctl.onChange(() => this.changed());
    this.stack = new IpStack(this, () => clock.now());
    this.dhcpClient = this.createDhcpClient();
    const host = this;
    this.tcp = new TcpLayer({
      get ttl(): number { return host.ttl; },
      send: (p) => this.stack.send(p),
      sourceFor: (dst) => this.sourceFor(dst),
      schedule: (d, fn) => this.hooks.schedule(d, fn),
    });
    this.resolver = new DnsResolver({
      sendQuery: (server, sport, msg) => this.sendUdp(server, sport, DNS_PORT, { dns: msg }),
      schedule: (d, fn) => this.hooks.schedule(d, fn),
    });
  }

  /** Source address towards `dst`: the address of the egress interface (routers with several NICs, wg0). */
  sourceFor(dst: number): number | undefined {
    const egress = this.route(dst);
    if (!egress) return undefined;
    return this.l3Iface(egress.iface)?.addrs[0]?.ip ?? this.config.ip;
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

  /** hostnamectl --pretty (undefined clears it). */
  setPrettyName(name: string | undefined): void {
    this.prettyName = name;
    this.changed();
  }

  /** `hostname NAME` / hostnamectl --transient (undefined = back to the static name). */
  setTransientName(name: string | undefined): void {
    this.transientName = name;
    this.changed();
  }

  /** `ip link set dev eth0 up|down`: administrative state of the NIC. */
  setPortUp(up: boolean): void {
    if (this.portUp === up) return;
    this.portUp = up;
    this.hooks.portChanged(this.primaryPort());
    this.changed();
  }

  /** dhclient -r: releases the lease and leaves the interface without an address. */
  releaseDhcp(): void {
    this.dhcpClient.release();
    this.hooks.runUntil(() => false, 10);
    this.config = { mode: 'dhcp' };
    this.dhcpStatus = 'idle';
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Tells open panels that something outside the device's own setters changed (nft, sysctl files…). */
  notifyChange(): void {
    this.changed();
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

  /** Sends a UDP datagram; broadcasts go out of `port` (the main NIC by default) directly. */
  sendUdp(dst: number, sport: number, dport: number, body: Omit<UdpDatagram, 'sport' | 'dport'>, src?: number, port = this.primaryPort()): boolean {
    const from = src ?? (dst === BROADCAST_IP ? this.ifaceConfig(port)?.ip : this.sourceFor(dst)) ?? this.config.ip ?? 0;
    const packet: IpPacket = { src: from, dst, ttl: this.ttl, protocol: 'udp', udp: { sport, dport, ...body } };
    if (dst === BROADCAST_IP) {
      this.stack.broadcast(port, packet);
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

  /** The NIC that the IP configuration, DHCP client and hostname belong to. */
  primaryPort(): string {
    return HOST_PORT;
  }

  /** Address of a NIC (the main one uses `config`). */
  ifaceConfig(port: string): { readonly ip?: number; readonly prefix?: number } | undefined {
    return port === this.primaryPort() ? this.config : undefined;
  }

  portNames(): readonly string[] {
    return [HOST_PORT];
  }

  portAdminUp(_port?: string): boolean {
    return this.portUp;
  }

  linkUp(): boolean {
    return this.portUp && this.hooks.peerUp(this.primaryPort());
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
    return lookupRoute(this.nics(), this.staticRoutes, this.config.gateway, dst);
  }

  // ------------------------------------------------------------ NICs (ip addr / ip link / ip route)

  /** The NICs as `ip` shows them (one on a PC or Server). */
  nics(): NicInfo[] {
    const { ip, prefix } = this.config;
    return [{ port: HOST_PORT, linux: HOST_LINUX_IF, mac: this.mac, up: this.linkUp(), adminUp: this.portUp, ip, prefix, dhcp: this.config.mode === 'dhcp' }];
  }

  /** `ip addr add|del` on a NIC (undefined removes the address and the routes through it). */
  setNicAddress(port: string, addr: { readonly ip: number; readonly prefix: number } | undefined): void {
    if (port !== this.primaryPort()) return;
    this.setStatic(addr ? { ...addr, gateway: undefined, dns: this.config.dns } : { dns: this.config.dns });
  }

  setNicUp(port: string, up: boolean): void {
    if (port === this.primaryPort()) this.setPortUp(up);
  }

  setStaticRoutes(routes: readonly StaticRoute[]): void {
    this.staticRoutes = routes.slice(0, MAX_STATIC_ROUTES);
    this.changed();
  }

  deliver(iface: string, packet: IpPacket): void {
    if (packet.tcp) {
      this.tcp.receive(packet);
      return;
    }
    const udp = packet.udp;
    if (!udp) return;
    if (udp.dhcp && udp.dport === DHCP_CLIENT_PORT) this.dhcpClient.receive(udp.dhcp);
    else if (udp.dns?.response && this.resolver.ownsPort(udp.dport)) this.resolver.receive(udp.dns, packet.src);
    else this.onUdp(packet, iface);
  }

  /** Linux name of a NIC port (eth0 for the only NIC of a PC or Server). */
  linuxIfName(port: string): string {
    return port === HOST_PORT ? HOST_LINUX_IF : port;
  }

  /** IPv4 address of a Linux interface name (masquerade, nft). */
  linuxIfIp(name: string): number | undefined {
    const port = this.portNames().find((p) => this.linuxIfName(p) === name);
    return port === undefined ? undefined : this.ifaceConfig(port)?.ip;
  }

  // ------------------------------------------------------------ netfilter hooks

  // The kernel (sysctl + nftables) decides; each hook returns the packet, rewritten, or null when dropped.
  prerouting = (iface: string, packet: IpPacket): IpPacket | null => this.kernel.prerouting(iface, packet);
  noteFrame = (packet: IpPacket, frame: Frame): void => this.kernel.netfilter.noteFrame(packet, frame.dst, frame.src);
  input = (iface: string, packet: IpPacket): IpPacket | null => this.kernel.input(iface, packet);
  output = (iface: string, packet: IpPacket): IpPacket | null => this.kernel.output(iface, packet);
  postrouting = (iface: string, packet: IpPacket): IpPacket | null => this.kernel.postrouting(iface, packet);

  /** WireGuard links (Linux router only). */
  wgLinks(): WgManager | undefined { return undefined; }

  /** Server-side UDP services (DHCP on 67, DNS on 53). Plain hosts (a PC) run none. */
  protected onUdp(_packet: IpPacket, _iface: string): void {}
}

