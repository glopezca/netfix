/** Minimal IPv4 host/router stack: ARP, ICMP echo, routing hand-off and local delivery. */
import type { IpWithPrefix } from '../core/ip.ts';
import { inSubnet, broadcastOf, BROADCAST_IP } from '../core/ip.ts';
import { BROADCAST_MAC } from '../core/mac.ts';
import type { Frame, IpPacket, IcmpMessage } from './packets.ts';

export interface L3Iface {
  readonly name: string;
  readonly mac: string;
  readonly addrs: readonly IpWithPrefix[];
  readonly up: boolean;
}

export interface Egress {
  readonly iface: string;
  readonly nextHop: number;
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
  /** Hosts may want to drop the packet that triggered ARP (IOS behaviour). */
  readonly dropOnArpMiss: boolean;
  readonly ttl: number;
}

export interface ArpEntry {
  readonly mac: string;
  readonly iface: string;
  readonly learnedAt: number;
}

export type EchoResult = { kind: 'reply'; from: number; ttl: number } | { kind: 'unreachable'; from: number } | { kind: 'ttl'; from: number };

const ARP_TIMEOUT_MS = 1000;
const MAX_PENDING = 4;

export class IpStack {
  readonly arp = new Map<number, ArpEntry>();
  private readonly pending = new Map<number, { iface: string; packets: IpPacket[] }>();
  private readonly echoWaiters = new Map<string, (r: EchoResult) => void>();
  private readonly host: StackHost;
  private now: () => number;

  constructor(host: StackHost, now: () => number) {
    this.host = host;
    this.now = now;
  }

  isMine(ip: number): boolean {
    return this.host.l3Ifaces().some((i) => i.addrs.some((a) => a.ip === ip));
  }

  private isLocalBroadcast(iface: L3Iface, ip: number): boolean {
    return ip === BROADCAST_IP || iface.addrs.some((a) => broadcastOf(a.ip, a.prefix) === ip);
  }

  receiveFrame(ifaceName: string, frame: Frame): void {
    const iface = this.host.l3Iface(ifaceName);
    if (!iface?.up) return;
    if (frame.dst !== iface.mac && frame.dst !== BROADCAST_MAC) return;
    if (frame.arp) this.onArp(iface, frame);
    else if (frame.ip) this.onIp(iface, frame.ip, frame);
  }

  private onArp(iface: L3Iface, frame: Frame): void {
    const arp = frame.arp!;
    const targetsMe = iface.addrs.some((a) => a.ip === arp.targetIp);
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

  private onIp(iface: L3Iface, packet: IpPacket, frame: Frame): void {
    const forMe = this.isMine(packet.dst) || this.isLocalBroadcast(iface, packet.dst);
    if (!forMe) {
      this.host.forward?.(iface.name, packet);
      return;
    }
    if (packet.icmp) {
      this.onIcmp(packet, packet.icmp);
      return;
    }
    this.host.deliver(iface.name, packet, frame);
  }

  private onIcmp(packet: IpPacket, icmp: IcmpMessage): void {
    if (icmp.type === 'echo-request') {
      this.send({ src: packet.dst, dst: packet.src, ttl: this.host.ttl, protocol: 'icmp', icmp: { ...icmp, type: 'echo-reply' } });
      return;
    }
    const waiter = this.echoWaiters.get(`${icmp.id}:${icmp.seq}`);
    if (!waiter) return;
    this.echoWaiters.delete(`${icmp.id}:${icmp.seq}`);
    if (icmp.type === 'echo-reply') waiter({ kind: 'reply', from: packet.src, ttl: packet.ttl });
    else if (icmp.type === 'unreachable') waiter({ kind: 'unreachable', from: packet.src });
    else waiter({ kind: 'ttl', from: packet.src });
  }

  /** Sends an ICMP echo request; the callback fires on reply/error (never on timeout). */
  echo(dst: number, id: number, seq: number, src: number | undefined, onResult: (r: EchoResult) => void): boolean {
    const egress = this.host.route(dst);
    if (!egress) return false;
    const srcIp = src ?? this.host.l3Iface(egress.iface)?.addrs[0]?.ip;
    if (srcIp === undefined) return false;
    this.echoWaiters.set(`${id}:${seq}`, onResult);
    if (this.isMine(dst)) {
      this.host.schedule(0, () => onResult({ kind: 'reply', from: dst, ttl: this.host.ttl }));
      return true;
    }
    this.sendVia(egress, { src: srcIp, dst, ttl: this.host.ttl, protocol: 'icmp', icmp: { type: 'echo-request', id, seq } });
    return true;
  }

  /** Routes and sends a packet originated (or forwarded) by this host. */
  send(packet: IpPacket): boolean {
    const egress = this.host.route(packet.dst);
    if (!egress) return false;
    this.sendVia(egress, packet);
    return true;
  }

  sendVia(egress: Egress, packet: IpPacket): void {
    const iface = this.host.l3Iface(egress.iface);
    if (!iface?.up) return;
    if (this.isLocalBroadcast(iface, packet.dst)) {
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
