/**
 * One customer line of the ISP cloud, with its own IP plane (so every line can use 192.168.1.0/24):
 *  - public: the ISP gateway x.y.n.1/29; DHCP hands x.y.n.2 to the customer's router.
 *  - router: the operator's router (CPE): LAN gateway, DHCP .33-.199, NAT to x.y.n.2 and port forwarding.
 */
import { IpStack } from '../net/ipstack.ts';
import type { L3Iface, StackHost, Egress } from '../net/ipstack.ts';
import type { Frame, IpPacket, DhcpMessage } from '../net/packets.ts';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, DEFAULT_TTL } from '../net/packets.ts';
import { DhcpServer } from '../dhcp/server.ts';
import type { ServerReply } from '../dhcp/server.ts';
import { ptPoolToIos, ptExclusions } from '../services/dhcp-pt.ts';
import { NatTable } from '../net/nat.ts';
import type { StaticNat } from '../net/nat.ts';
import type { InternetCore } from '../net/internet.ts';
import { GOOGLE_DNS } from '../net/internet-hosts.ts';
import { BROADCAST_IP, inSubnet, networkOf } from '../core/ip.ts';
import { DnsForwarder } from '../services/dns-forwarder.ts';
import { DNS_PORT } from '../net/packets.ts';
import type { CloudPortSettings } from './cloud-config.ts';
import { LINE_PREFIX, lineSubnet } from './cloud-config.ts';

const DHCP_FIRST_HOST = 33;
const DHCP_LAST_HOST = 199;
const LEASE_MINUTES = 1440;
const SMALL_LAN = 64;
const ERROR_TTL = 255;

export interface PortOwner {
  readonly id: string;
  block(): number;
  mac(port: string): string;
  peerUp(port: string): boolean;
  transmit(port: string, frame: Frame): void;
  schedule(delayMs: number, fn: () => void): void;
  now(): number;
}

export class CloudPort implements StackHost {
  readonly stack: IpStack;
  readonly dropOnArpMiss = false;
  readonly ttl = DEFAULT_TTL;
  dhcp = new DhcpServer();
  readonly nat = new NatTable();
  readonly name: string;
  settings: CloudPortSettings;
  private readonly owner: PortOwner;
  private readonly core: InternetCore;
  private appliedNet = -1;
  /** ISP DNS relay (router mode with dnsRelay): customers' queries to the gateway, relayed to Google. */
  readonly relay: DnsForwarder;

  constructor(owner: PortOwner, core: InternetCore, name: string, settings: CloudPortSettings) {
    this.owner = owner;
    this.core = core;
    this.name = name;
    this.settings = settings;
    this.stack = new IpStack(this, () => owner.now());
    this.relay = new DnsForwarder({
      send: (dst, sport, msg) => this.core.send({ src: this.wan(), dst, ttl: DEFAULT_TTL, protocol: 'udp', udp: { sport, dport: DNS_PORT, dns: msg } }),
      reply: (to, port, msg) => { this.stack.send({ src: this.gatewayAddr().ip, dst: to, ttl: DEFAULT_TTL, protocol: 'udp', udp: { sport: DNS_PORT, dport: port, dns: msg } }); },
      schedule: (d, fn) => owner.schedule(d, fn),
      now: () => owner.now(),
      log: () => undefined,
    });
    this.apply(settings);
  }

  /** Public /29 of the line: gateway and the customer's (or the CPE's WAN) address. */
  line(): { net: number; gw: number; customer: number } {
    return lineSubnet(this.owner.block(), this.name);
  }

  /** Reconfigures the line; a new mode, LAN or public block drops ARP, NAT and leases. */
  apply(settings: CloudPortSettings): void {
    const modeChanged = settings.mode !== this.settings.mode || settings.lanIp !== this.settings.lanIp || settings.lanPrefix !== this.settings.lanPrefix;
    const blockChanged = this.line().net !== this.appliedNet;
    this.settings = settings;
    this.appliedNet = this.line().net;
    if (modeChanged || blockChanged) {
      this.stack.flushArp();
      this.nat.clear();
      this.dhcp = new DhcpServer();
    }
    const { net, gw } = this.line();
    const lan = settings.mode === 'router';
    const prefix = lan ? settings.lanPrefix : LINE_PREFIX;
    const gateway = lan ? settings.lanIp : gw;
    const base = networkOf(gateway, prefix);
    const hosts = 2 ** (32 - prefix) - 2;
    const offset = hosts > SMALL_LAN ? DHCP_FIRST_HOST : 2;
    const start = lan ? base + offset : net + 2;
    const max = lan ? Math.min(DHCP_LAST_HOST - DHCP_FIRST_HOST + 1, hosts - offset + 1) : 1;
    const relay = lan && settings.dnsRelay === true;
    const pool = { name: this.name, start, prefix, maxUsers: Math.max(1, max), gateway, dns: relay ? gateway : GOOGLE_DNS[0], leaseMinutes: LEASE_MINUTES, reservations: [] };
    this.dhcp.pools = [{ ...ptPoolToIos(pool), dnsServers: relay ? [gateway] : [...GOOGLE_DNS] }];
    if (!relay) this.relay.flush();
    this.dhcp.excluded = ptExclusions(pool);
    this.dhcp.pingPackets = 0;
  }

  private gatewayAddr(): { ip: number; prefix: number } {
    return this.settings.mode === 'router' ? { ip: this.settings.lanIp, prefix: this.settings.lanPrefix } : { ip: this.line().gw, prefix: LINE_PREFIX };
  }

  /** DHCP leases handed out on this line. */
  leases(): ReturnType<DhcpServer['allBindings']> {
    return this.dhcp.allBindings(this.owner.now());
  }

  /** WAN address of the operator router (router mode). */
  wan(): number {
    return this.line().customer;
  }

  // ------------------------------------------------------------ StackHost

  l3Iface(name: string): L3Iface | undefined {
    if (name !== this.name) return undefined;
    return { name, mac: this.owner.mac(name), addrs: [this.gatewayAddr()], up: this.owner.peerUp(name) };
  }

  l3Ifaces(): readonly L3Iface[] {
    const i = this.l3Iface(this.name);
    return i ? [i] : [];
  }

  emit(_iface: string, frame: Frame): void {
    this.owner.transmit(this.name, frame);
  }

  schedule(delayMs: number, fn: () => void): void {
    this.owner.schedule(delayMs, fn);
  }

  route(dst: number): Egress | null {
    const g = this.gatewayAddr();
    return dst !== BROADCAST_IP && inSubnet(dst, g.ip, g.prefix) ? { iface: this.name, nextHop: dst } : null;
  }

  deliver(_iface: string, packet: IpPacket): void {
    const udp = packet.udp;
    if (udp?.dhcp && udp.dport === DHCP_SERVER_PORT) this.onDhcp(udp.dhcp);
    else if (udp?.dns && !udp.dns.response && udp.dport === DNS_PORT && this.relaying()) this.relay.resolve(udp.dns, packet.src, udp.sport, GOOGLE_DNS);
  }

  private relaying(): boolean {
    return this.settings.mode === 'router' && this.settings.dnsRelay === true;
  }

  /** Customer side → Internet. */
  forward(_iface: string, packet: IpPacket): void {
    if (packet.dst === BROADCAST_IP) return;
    const g = this.gatewayAddr();
    if (packet.ttl <= 1) return this.icmpError(packet, g.ip, 'ttl-exceeded');
    let out: IpPacket = { ...packet, ttl: packet.ttl - 1 };
    if (this.settings.mode === 'router') {
      if (!inSubnet(packet.src, g.ip, g.prefix)) return;
      const translated = this.nat.inside(out, this.forwards(), () => ({ global: this.wan(), overload: true }));
      if (translated === 'drop') return;
      out = translated ?? out;
    }
    this.core.send(out);
  }

  private forwards(): StaticNat[] {
    const wan = this.wan();
    return this.settings.forwards.map((f) => ({ local: f.ip, global: wan, proto: f.proto, localPort: f.toPort, globalPort: f.port }));
  }

  private icmpError(packet: IpPacket, src: number, type: 'ttl-exceeded' | 'unreachable'): void {
    if (packet.icmp?.type !== 'echo-request') return;
    this.stack.send({ src, dst: packet.src, ttl: ERROR_TTL, protocol: 'icmp', icmp: { ...packet.icmp, type } });
  }

  // ------------------------------------------------------------ Internet side

  owns(ip: number): boolean {
    if (this.settings.mode === 'router') return ip === this.wan();
    return inSubnet(ip, this.line().net, LINE_PREFIX);
  }

  fromInternet(p: IpPacket): void {
    const own = this.settings.mode === 'router' ? this.wan() : this.line().gw;
    if (this.settings.mode === 'router') {
      if (p.dst === own && p.udp?.dns?.response && this.relay.onResponse(p.udp.dport, p.udp.dns)) return;
      const inside = this.nat.outside(p, this.forwards());
      if (inside) return this.toCustomer(inside);
    } else if (p.dst !== own) return this.toCustomer(p);
    this.answerLocally(p, own);
  }

  private toCustomer(p: IpPacket): void {
    if (p.ttl <= 1) return;
    this.stack.send({ ...p, ttl: p.ttl - 1 });
  }

  /** Echo to the line's own public address, TCP reset for closed ports. */
  private answerLocally(p: IpPacket, own: number): void {
    if (p.icmp?.type === 'echo-request') {
      this.core.send({ src: own, dst: p.src, ttl: ERROR_TTL, protocol: 'icmp', icmp: { ...p.icmp, type: 'echo-reply' } });
    } else if (p.tcp && p.tcp.flags.includes('SYN')) {
      this.core.send({ src: own, dst: p.src, ttl: ERROR_TTL, protocol: 'tcp', tcp: { sport: p.tcp.dport, dport: p.tcp.sport, flags: ['RST', 'ACK'], seq: 0, ack: p.tcp.seq + 1 } });
    }
  }

  // ------------------------------------------------------------ DHCP

  private onDhcp(msg: DhcpMessage): void {
    const g = this.gatewayAddr();
    const reply = this.dhcp.handle(msg, { ifaceName: this.name, ifaceAddrs: [g], ownIps: [g.ip], now: this.owner.now(), ipInUse: () => false, log: () => undefined });
    if (reply) this.sendDhcp(reply, g.ip);
  }

  private sendDhcp(reply: ServerReply, src: number): void {
    const m = reply.msg;
    const packet: IpPacket = { src, dst: reply.via === 'unicast' ? m.ciaddr : BROADCAST_IP, ttl: this.ttl, protocol: 'udp', udp: { sport: DHCP_SERVER_PORT, dport: DHCP_CLIENT_PORT, dhcp: m } };
    if (packet.dst === BROADCAST_IP) this.stack.broadcast(this.name, packet);
    else this.stack.send(packet);
  }
}
