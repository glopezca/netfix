/** Packet Tracer-style PC: one NIC, static or DHCP addressing, command prompt. */
import type { NetDevice } from '../net/network.ts';
import type { Frame, IpPacket } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, PC_TTL } from '../net/packets.ts';
import { IpStack } from '../net/ipstack.ts';
import type { L3Iface, StackHost, Egress } from '../net/ipstack.ts';
import { DhcpClient } from '../dhcp/client.ts';
import type { Lease } from '../dhcp/client.ts';
import { DETACHED } from './hooks.ts';
import type { DeviceHooks } from './hooks.ts';
import { macFromSeed, clientIdFromMac } from '../core/mac.ts';
import { inSubnet } from '../core/ip.ts';
import type { SimClock } from '../core/clock.ts';

export const PC_PORT = 'FastEthernet0';
const APIPA_NET = 0xa9fe0000;
const APIPA_PREFIX = 16;
const APIPA_HOST_SPACE = 0xfe00;

export type IpMode = 'static' | 'dhcp';
export type DhcpStatus = 'idle' | 'requesting' | 'ok' | 'failed';

export interface PcIpConfig {
  readonly mode: IpMode;
  readonly ip?: number;
  readonly prefix?: number;
  readonly gateway?: number;
  readonly dns?: number;
}

export class Pc implements NetDevice, StackHost {
  readonly kind = 'pc' as const;
  readonly id: string;
  name: string;
  readonly mac: string;
  hooks: DeviceHooks = DETACHED;
  config: PcIpConfig = { mode: 'static' };
  /** Windows-style clients send option 61 = 01 + MAC. */
  sendClientId = true;
  portUp = true;
  dhcpStatus: DhcpStatus = 'idle';
  readonly stack: IpStack;
  readonly dhcpClient: DhcpClient;
  private readonly clock: SimClock;
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
  }

  displayName(): string {
    return this.name;
  }

  onChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.statusListeners) l();
  }

  private createDhcpClient(): DhcpClient {
    return new DhcpClient({
      mac: this.mac,
      send: (msg, dst, src) => this.sendDhcp(msg, dst, src),
      schedule: (d, fn) => this.hooks.schedule(d, fn),
      now: () => this.clock.now(),
      onBound: (lease) => this.applyLease(lease),
      onFailed: () => this.applyApipa(),
      onLost: () => { this.config = { mode: 'dhcp' }; this.changed(); },
    });
  }

  // ------------------------------------------------------------ configuration

  setStatic(cfg: Omit<PcIpConfig, 'mode'>): void {
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
    return this.sendClientId ? clientIdFromMac(this.mac) : undefined;
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

  private sendDhcp(msg: Parameters<DhcpClient['receive']>[0], dst: number, src: number): void {
    const withId = { ...msg, options: { ...msg.options, clientId: this.clientId(), hostname: this.name } };
    const packet: IpPacket = { src, dst, ttl: PC_TTL, protocol: 'udp', udp: { sport: DHCP_CLIENT_PORT, dport: DHCP_SERVER_PORT, dhcp: withId } };
    if (dst === 0xffffffff) this.stack.broadcast(PC_PORT, packet);
    else this.stack.send(packet);
  }

  // ------------------------------------------------------------ NetDevice

  portNames(): readonly string[] {
    return [PC_PORT];
  }

  portAdminUp(): boolean {
    return this.portUp;
  }

  linkUp(): boolean {
    return this.portUp && this.hooks.peerUp(PC_PORT);
  }

  receive(_port: string, frame: Frame): void {
    this.stack.receiveFrame(PC_PORT, frame);
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
    return name === PC_PORT ? this.l3Ifaces()[0] : undefined;
  }

  l3Ifaces(): readonly L3Iface[] {
    const { ip, prefix } = this.config;
    const addrs = ip !== undefined && prefix !== undefined ? [{ ip, prefix }] : [];
    return [{ name: PC_PORT, mac: this.mac, addrs, up: this.linkUp() }];
  }

  emit(_iface: string, frame: Frame): void {
    this.hooks.transmit(PC_PORT, frame);
  }

  schedule(delayMs: number, fn: () => void): void {
    this.hooks.schedule(delayMs, fn);
  }

  route(dst: number): Egress | null {
    const { ip, prefix, gateway } = this.config;
    if (ip === undefined || prefix === undefined) return null;
    if (inSubnet(dst, ip, prefix) || dst === 0xffffffff) return { iface: PC_PORT, nextHop: dst };
    return gateway !== undefined ? { iface: PC_PORT, nextHop: gateway } : null;
  }

  deliver(_iface: string, packet: IpPacket): void {
    const dhcp = packet.udp?.dhcp;
    if (dhcp && packet.udp?.dport === DHCP_CLIENT_PORT) this.dhcpClient.receive(dhcp);
  }
}
