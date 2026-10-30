/** Minimal IPv4 host/router stack: ARP, ICMP echo, routing hand-off and local delivery. */
import type { IpWithPrefix } from '../core/ip.ts';
import { inSubnet, broadcastOf, BROADCAST_IP } from '../core/ip.ts';
import { BROADCAST_MAC } from '../core/mac.ts';
import type { Frame, IpPacket, IcmpMessage, IcmpQuote, UnreachableCode } from './packets.ts';

export interface L3Iface {
  readonly name: string;
  readonly mac: string;
  readonly addrs: readonly IpWithPrefix[];
  readonly up: boolean;
  /** Point-to-point link without ARP (WireGuard): packets go straight to the interface. */
  readonly pointToPoint?: boolean;
}

export interface Egress {
  readonly iface: string;
  readonly nextHop: number;
}

/**
 * Local sockets the stack itself does not know (mDNS, net/mdns.ts): which hosts joined a multicast group, and the
 * datagrams a service takes before the host's protocols see them. Registered once; nothing joins without it.
 */
export interface LocalSockets {
  member(host: StackHost, group: number): boolean;
  take(host: StackHost, iface: string, packet: IpPacket): boolean;
}

const sockets: LocalSockets[] = [];

/** Each service registers once (mDNS, NetBIOS). */
export function registerLocalSockets(s: LocalSockets): void {
  sockets.push(s);
}

const isMulticast = (ip: number): boolean => ip >>> 28 === 0xe;

/** 01:00:5e + the low 23 bits of the group (224.0.0.251 → 01005e0000fb). */
export function multicastMac(group: number): string {
  return `01005e${[(group >>> 16) & 0x7f, (group >>> 8) & 0xff, group & 0xff].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface StackHost {
  l3Iface(name: string): L3Iface | undefined;
  l3Ifaces(): readonly L3Iface[];
  emit(iface: string, frame: Frame): void;
  schedule(delayMs: number, fn: () => void): void;
  route(dst: number): Egress | null;
  /** Packets addressed to this host (or broadcast) that are not ICMP echo. */
  deliver(iface: string, packet: IpPacket, frame: Frame): void;
  /** Routers forward transit packets; hosts drop them. */
  forward?(iface: string, packet: IpPacket): void;
  /** Before the routing decision (IOS `ip nat outside`, netfilter prerouting); null = dropped. */
  prerouting?(iface: string, packet: IpPacket): IpPacket | null;
  /** The Ethernet frame a packet arrived in (Linux hosts keep it for the MAC= of the kernel log). */
  noteFrame?(packet: IpPacket, frame: Frame): void;
  /** Packet for this host, before ICMP echo and delivery (netfilter input); null = dropped. */
  input?(iface: string, packet: IpPacket): IpPacket | null;
  /** Locally generated packet once its egress is known (netfilter output); null = dropped. */
  output?(iface: string, packet: IpPacket): IpPacket | null;
  /** Every packet leaving an interface, generated or forwarded (netfilter postrouting); null = dropped. */
  postrouting?(iface: string, packet: IpPacket): IpPacket | null;
  /** An echo to a broadcast address is not answered (Linux icmp_echo_ignore_broadcasts, Windows); IOS answers. */
  ignoresBroadcastEcho?(): boolean;
  /** A directed broadcast for this interface's subnet, arriving from elsewhere, goes out as a link broadcast
   * (IOS `ip directed-broadcast`, Linux bc_forwarding); off by default. */
  forwardsDirectedBroadcast?(iface: string): boolean;
  /** Extra addresses answered by ARP on an interface (static NAT globals). */
  answersArp?(iface: string, ip: number): boolean;
  /** An ICMP destination unreachable about one of our TCP or UDP packets (the quote says which). */
  icmpUnreachable?(orig: IcmpQuote, code: UnreachableCode): void;
  /** Hosts may want to drop the packet that triggered ARP (IOS behaviour). */
  readonly dropOnArpMiss: boolean;
  readonly ttl: number;
}

export interface ArpEntry {
  readonly mac: string;
  readonly iface: string;
  readonly learnedAt: number;
}

export type EchoResult = { kind: 'reply'; from: number; ttl: number } | { kind: 'unreachable'; from: number; code: UnreachableCode } | { kind: 'ttl'; from: number };

const ARP_TIMEOUT_MS = 1000;
/** Interface name the hooks see for traffic to the host's own addresses. */
export const LOOPBACK = 'lo';
const LOOPBACK_NET = 127;
const LOOPBACK_IP = 0x7f000001;
const LOOPBACK_MAC = '000000000000';
const MAX_PENDING = 4;
/** /31 and /32 have no broadcast address. */
const MAX_PREFIX = 32;

export class IpStack {
  readonly arp = new Map<number, ArpEntry>();
  private readonly pending = new Map<number, { iface: string; packets: IpPacket[] }>();
  /** Pending echoes; `dup` keeps listening after the first answer (a broadcast is answered by several devices). */
  private readonly echoWaiters = new Map<string, { first: (r: EchoResult) => void; dup?: (r: EchoResult) => void; answered: boolean }>();
  private readonly host: StackHost;
  private now: () => number;

  constructor(host: StackHost, now: () => number) {
    this.host = host;
    this.now = now;
  }

  /** One of our addresses, or the loopback network 127.0.0.0/8 (the kernel's lo). */
  isMine(ip: number): boolean {
    return (ip >>> 24) === LOOPBACK_NET || this.host.l3Ifaces().some((i) => i.addrs.some((a) => a.ip === ip));
  }

  private isLocalBroadcast(iface: L3Iface, ip: number): boolean {
    return ip === BROADCAST_IP || iface.addrs.some((a) => broadcastOf(a.ip, a.prefix) === ip);
  }

  /** The interface whose subnet has `ip` as its broadcast address (directed broadcast), if any. */
  private directedIface(ip: number): { iface: L3Iface; addr: number } | undefined {
    for (const iface of this.host.l3Ifaces()) {
      if (!iface.up) continue;
      const a = iface.addrs.find((x) => x.prefix < MAX_PREFIX - 1 && broadcastOf(x.ip, x.prefix) === ip);
      if (a) return { iface, addr: a.ip };
    }
    return undefined;
  }

  /** 255.255.255.255 or the broadcast address of one of our subnets (what ping -b is needed for). */
  isBroadcast(ip: number): boolean {
    return ip === BROADCAST_IP || this.directedIface(ip) !== undefined;
  }

  receiveFrame(ifaceName: string, frame: Frame): void {
    const iface = this.host.l3Iface(ifaceName);
    if (!iface?.up) return;
    if (!iface.pointToPoint && frame.dst !== iface.mac && frame.dst !== BROADCAST_MAC && !this.joined(frame.ip?.dst, frame.dst)) return;
    if (frame.arp) this.onArp(iface, frame);
    else if (frame.ip) this.onIp(iface, frame.ip, frame);
  }

  private onArp(iface: L3Iface, frame: Frame): void {
    const arp = frame.arp!;
    const targetsMe = iface.addrs.some((a) => a.ip === arp.targetIp) || (this.host.answersArp?.(iface.name, arp.targetIp) ?? false);
    if (targetsMe || this.arp.has(arp.senderIp)) this.learn(arp.senderIp, arp.senderMac, iface.name);
    if (arp.op === 'request' && targetsMe) {
      this.host.emit(iface.name, {
        src: iface.mac, dst: arp.senderMac,
        arp: { op: 'reply', senderMac: iface.mac, senderIp: arp.targetIp, targetMac: arp.senderMac, targetIp: arp.senderIp },
      });
    }
  }

  private learn(ip: number, mac: string, iface: string): void {
    this.arp.set(ip, { mac, iface, learnedAt: this.now() });
    const waiting = this.pending.get(ip);
    if (!waiting) return;
    this.pending.delete(ip);
    for (const p of waiting.packets) this.emitIp(waiting.iface, mac, p);
  }

  private onIp(iface: L3Iface, arrived: IpPacket, frame: Frame): void {
    this.host.noteFrame?.(arrived, frame);
    const packet = this.host.prerouting ? this.host.prerouting(iface.name, arrived) : arrived;
    if (!packet) return;
    // Martian: 127.0.0.0/8 never comes in from the wire (Linux drops it), only through lo.
    if ((packet.dst >>> 24) === LOOPBACK_NET || (packet.src >>> 24) === LOOPBACK_NET) return;
    const directed = this.directedIface(packet.dst);
    const forMe = this.isMine(packet.dst) || this.isLocalBroadcast(iface, packet.dst) || directed !== undefined || this.joined(packet.dst);
    if (!forMe) {
      // 224.0.0.0/4 is never routed here (mDNS and the like stay on their link).
      if (!isMulticast(packet.dst)) this.host.forward?.(iface.name, packet);
      return;
    }
    // A directed broadcast for another of our subnets is ours too; the link only gets it if forwarding is on. One that
    // arrived on a link of that subnet already reached it: relaying it again could bounce between routers forever.
    if (directed && directed.iface.name !== iface.name && !this.isLocalBroadcast(iface, packet.dst)) this.relayDirected(iface.name, directed.iface, packet);
    this.localIn(iface.name, packet, frame);
  }

  /** Allowed: the normal forwarding path (TTL, outbound ACL, IPsec, nftables) sends it out as a link broadcast. */
  private relayDirected(inIface: string, out: L3Iface, packet: IpPacket): void {
    if (out.up && this.host.forwardsDirectedBroadcast?.(out.name)) this.host.forward?.(inIface, packet);
  }

  /** Local delivery: input hook, then ICMP echo handling or the host's protocols. */
  private localIn(ifaceName: string, arrived: IpPacket, frame: Frame): void {
    const packet = this.host.input ? this.host.input(ifaceName, arrived) : arrived;
    if (!packet) return;
    if (packet.icmp) {
      this.onIcmp(ifaceName, packet, packet.icmp);
      return;
    }
    if (packet.udp && sockets.some((s) => s.take(this.host, ifaceName, packet))) return;
    this.host.deliver(ifaceName, packet, frame);
  }

  /** Output hook for a locally generated packet; null = dropped by the firewall. */
  private outbound(iface: string, packet: IpPacket): IpPacket | null {
    return this.host.output ? this.host.output(iface, packet) : packet;
  }

  private onIcmp(ifaceName: string, packet: IpPacket, icmp: IcmpMessage): void {
    if (icmp.type === 'echo-request') {
      const src = this.echoSource(ifaceName, packet.dst);
      if (src !== undefined) this.send({ src, dst: packet.src, ttl: this.host.ttl, protocol: 'icmp', icmp: { ...icmp, type: 'echo-reply' } });
      return;
    }
    if (icmp.type === 'unreachable' && icmp.orig) {
      this.host.icmpUnreachable?.(icmp.orig, icmp.code ?? 'host');
      return;
    }
    const key = `${icmp.id}:${icmp.seq}`;
    const waiter = this.echoWaiters.get(key);
    if (!waiter) return;
    const result: EchoResult = icmp.type === 'echo-reply' ? { kind: 'reply', from: packet.src, ttl: packet.ttl }
      : icmp.type === 'unreachable' ? { kind: 'unreachable', from: packet.src, code: icmp.code ?? 'host' } : { kind: 'ttl', from: packet.src };
    if (waiter.answered) return waiter.dup?.(result);
    waiter.answered = true;
    if (!waiter.dup) this.echoWaiters.delete(key);
    waiter.first(result);
  }

  /** Who answers an echo: the address it was sent to; for a broadcast, our own address on that subnet (or none). */
  private echoSource(ifaceName: string, dst: number): number | undefined {
    const directed = this.directedIface(dst);
    if (dst !== BROADCAST_IP && !directed) return dst;
    if (this.host.ignoresBroadcastEcho?.()) return undefined;
    return directed?.addr ?? this.host.l3Iface(ifaceName)?.addrs[0]?.ip;
  }

  /** Stops listening for the answers of a ping (`id`), duplicates included. */
  endEcho(id: number): void {
    for (const key of this.echoWaiters.keys()) if (key.startsWith(`${id}:`)) this.echoWaiters.delete(key);
  }

  /** Sends an ICMP echo request; the callback fires on reply/error (never on timeout). */
  echo(dst: number, id: number, seq: number, src: number | undefined, onResult: (r: EchoResult) => void, ttl = this.host.ttl, onDup?: (r: EchoResult) => void): boolean {
    if (this.isMine(dst)) {
      this.host.schedule(0, () => onResult({ kind: 'reply', from: dst, ttl: this.host.ttl }));
      return true;
    }
    const egress = this.host.route(dst);
    if (!egress) return false;
    const srcIp = src ?? this.host.l3Iface(egress.iface)?.addrs[0]?.ip;
    if (srcIp === undefined) return false;
    this.echoWaiters.set(`${id}:${seq}`, { first: onResult, dup: onDup, answered: false });
    const out = this.outbound(egress.iface, { src: srcIp, dst, ttl, protocol: 'icmp', icmp: { type: 'echo-request', id, seq } });
    if (out) this.sendVia(egress, out);
    // Only our own ping: a broadcast we forward was already delivered to us when it came in.
    const iface = this.host.l3Iface(egress.iface);
    if (out && iface && !iface.pointToPoint && this.isLocalBroadcast(iface, dst)) this.loopBroadcast(egress.iface, iface.mac, out);
    return true;
  }

  /** Routes and sends a packet originated (or forwarded) by this host. */
  send(packet: IpPacket): boolean {
    if (this.isMine(packet.dst)) return this.loopback(packet);
    const egress = this.host.route(packet.dst);
    if (!egress) return false;
    const out = this.outbound(egress.iface, packet);
    if (out) this.sendVia(egress, out);
    return true;
  }

  /** Sends a locally generated packet through a given egress (output hook included). */
  sendRouted(egress: Egress, packet: IpPacket): void {
    const out = this.outbound(egress.iface, packet);
    if (out) this.sendVia(egress, out);
  }

  sendVia(egress: Egress, original: IpPacket): void {
    const iface = this.host.l3Iface(egress.iface);
    if (!iface?.up) return;
    const packet = this.host.postrouting ? this.host.postrouting(egress.iface, original) : original;
    if (!packet) return;
    if (iface.pointToPoint || this.isLocalBroadcast(iface, packet.dst)) {
      this.emitIp(egress.iface, BROADCAST_MAC, packet);
      return;
    }
    const known = this.arp.get(egress.nextHop);
    if (known) {
      this.emitIp(egress.iface, known.mac, packet);
      return;
    }
    this.resolve(iface, egress.nextHop, packet);
  }

  /**
   * Linux hands a copy of every broadcast it sends to itself (ip_mc_output): a host that answers broadcast echoes
   * answers its own ping -b. Only for its own echo requests, so DHCP and the rest are not seen twice.
   */
  private loopBroadcast(ifaceName: string, mac: string, packet: IpPacket): void {
    if (this.host.ignoresBroadcastEcho?.() !== false) return;
    this.host.schedule(0, () => this.localIn(ifaceName, packet, { src: mac, dst: BROADCAST_MAC, ip: packet }));
  }

  /** Packets to one of our own addresses never reach the wire (like the kernel's loopback path). */
  private loopback(packet: IpPacket): boolean {
    const toLo = (packet.dst >>> 24) === LOOPBACK_NET;
    const iface = this.host.l3Ifaces().find((i) => i.addrs.some((a) => a.ip === packet.dst));
    if (!iface && !toLo) return false;
    // To 127.x the source is 127.0.0.1 too (a socket bound to lo), as on Linux.
    const sent = toLo && (packet.src >>> 24) !== LOOPBACK_NET ? { ...packet, src: LOOPBACK_IP } : packet;
    const out = this.outbound(LOOPBACK, sent);
    if (!out) return true;
    const mac = iface?.mac ?? LOOPBACK_MAC;
    this.host.schedule(0, () => this.localIn(LOOPBACK, out, { src: mac, dst: mac, ip: out }));
    return true;
  }

  /** A multicast group this host has joined (with its MAC, when a frame brings one). */
  private joined(group: number | undefined, mac?: string): boolean {
    if (group === undefined || !isMulticast(group) || (mac !== undefined && mac !== multicastMac(group))) return false;
    return sockets.some((s) => s.member(this.host, group));
  }

  /** Sends a datagram to a link-local multicast group (it is never routed: TTL 255, mDNS). */
  multicast(ifaceName: string, packet: IpPacket): void {
    this.emitIp(ifaceName, multicastMac(packet.dst), packet);
  }

  /** Sends a frame on an interface to the broadcast MAC (DHCP, etc.). */
  broadcast(ifaceName: string, packet: IpPacket): void {
    this.emitIp(ifaceName, BROADCAST_MAC, packet);
  }

  private resolve(iface: L3Iface, target: number, packet: IpPacket): void {
    const waiting = this.pending.get(target);
    if (waiting) {
      const drop = this.host.dropOnArpMiss && packet.icmp?.type === 'echo-request';
      if (!drop && waiting.packets.length < MAX_PENDING) waiting.packets.push(packet);
      return;
    }
    this.pending.set(target, { iface: iface.name, packets: this.host.dropOnArpMiss && packet.icmp?.type === 'echo-request' ? [] : [packet] });
    const sender = iface.addrs.find((a) => inSubnet(target, a.ip, a.prefix)) ?? iface.addrs[0];
    this.host.emit(iface.name, {
      src: iface.mac, dst: BROADCAST_MAC,
      arp: { op: 'request', senderMac: iface.mac, senderIp: sender?.ip ?? 0, targetMac: '000000000000', targetIp: target },
    });
    this.host.schedule(ARP_TIMEOUT_MS, () => {
      if (this.pending.get(target)) this.pending.delete(target);
    });
  }

  private emitIp(iface: string, dstMac: string, packet: IpPacket): void {
    const mac = this.host.l3Iface(iface)?.mac ?? '';
    this.host.emit(iface, { src: mac, dst: dstMac, ip: packet });
  }

  flushArp(iface?: string): void {
    for (const [ip, e] of this.arp) if (!iface || e.iface === iface) this.arp.delete(ip);
  }

  setClock(now: () => number): void {
    this.now = now;
  }
}
