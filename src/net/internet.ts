/**
 * The emulated Internet that joins every ISP cloud: a few backbone routers (they answer traceroute),
 * the ISPs' own core routers and virtual hosts such as the public DNS servers 8.8.8.8/8.8.4.4.
 * Packets travel hop by hop: TTL is decremented and "time exceeded" is returned for echo requests.
 */
import type { IpPacket, UnreachableCode } from './packets.ts';
import { parseIp } from '../core/ip.ts';

export interface InternetEdge {
  readonly id: string;
  /** The ISP's core router address (first hop inside the Internet). */
  coreHop(): number;
  /** Public addresses reachable through this edge. */
  owns(ip: number): boolean;
  /** A packet arrives from the Internet. */
  fromInternet(packet: IpPacket): void;
  /** The ISP's public /16. */
  publicBlock(): number;
}

export interface VirtualHost {
  readonly ips: readonly number[];
  /** Router in front of the host (last hop). */
  readonly hop: number;
  receive(packet: IpPacket): void;
}

export interface DomainSource {
  /** Domains registered at every ISP: name → A address or delegated name server. */
  domains(): readonly { readonly name: string; readonly kind: 'a' | 'ns'; readonly ip: number }[];
}

const ip = (t: string): number => parseIp(t) ?? 0;
export const BACKBONE = [ip('198.51.100.1'), ip('198.51.100.2')] as const;
export const HOP_MS = 2;
const ERROR_TTL = 250;
const FIRST_BLOCK = ip('81.32.0.0');
const BLOCK_STEP = 1 << 16;
const MAX_BLOCKS = 200;

export class InternetCore implements DomainSource {
  private readonly edges = new Set<InternetEdge>();
  private readonly hosts: VirtualHost[] = [];
  private readonly schedule: (ms: number, fn: () => void) => void;
  private sources: DomainSource[] = [];
  /** Simulation-mode hook: a packet goes from one edge (cloud) to another through the Internet. */
  observer: ((fromEdge: string, toEdge: string, packet: IpPacket) => void) | undefined;

  constructor(schedule: (ms: number, fn: () => void) => void) {
    this.schedule = schedule;
  }

  attach(edge: InternetEdge & Partial<DomainSource>): void {
    this.edges.add(edge);
    if (edge.domains) this.sources.push(edge as DomainSource);
  }

  detach(edge: InternetEdge): void {
    this.edges.delete(edge);
    this.sources = this.sources.filter((s) => s !== (edge as unknown));
  }

  addHost(host: VirtualHost): void {
    this.hosts.push(host);
  }

  later(ms: number, fn: () => void): void {
    this.schedule(ms, fn);
  }

  domains(): readonly { name: string; kind: 'a' | 'ns'; ip: number }[] {
    return this.sources.flatMap((s) => s.domains());
  }

  /** Public blocks of the other ISP clouds. */
  otherBlocks(edge: InternetEdge): number[] {
    return [...this.edges].filter((e) => e !== edge).map((e) => e.publicBlock());
  }

  /** Addresses of the emulated Internet itself (virtual hosts and routers). */
  isVirtual(addr: number): boolean {
    return this.hostFor(addr) !== undefined || BACKBONE.includes(addr as (typeof BACKBONE)[number]);
  }

  /** First /16 public block not used by another ISP cloud. */
  freeBlock(used: readonly number[]): number {
    for (let i = 0; i < MAX_BLOCKS; i++) {
      const b = (FIRST_BLOCK + i * BLOCK_STEP) >>> 0;
      if (!used.includes(b)) return b;
    }
    return FIRST_BLOCK;
  }

  private edgeFor(addr: number): InternetEdge | undefined {
    for (const e of this.edges) if (e.owns(addr)) return e;
    return undefined;
  }

  private hostFor(addr: number): VirtualHost | undefined {
    return this.hosts.find((h) => h.ips.includes(addr));
  }

  private hopFor(addr: number): number | undefined {
    const e = this.edgeFor(addr);
    if (e) return e.coreHop();
    const h = this.hostFor(addr);
    if (h) return h.hop;
    for (const x of this.edges) if (x.coreHop() === addr) return addr;
    return BACKBONE.includes(addr as (typeof BACKBONE)[number]) ? addr : undefined;
  }

  /** Routers crossed between two public addresses. */
  path(src: number, dst: number): number[] {
    const a = this.hopFor(src);
    const b = this.hopFor(dst);
    const hops = a !== undefined && a === b ? [a] : [a, ...BACKBONE, b];
    return hops.filter((h, i): h is number => h !== undefined && hops.indexOf(h) === i && h !== src && h !== dst);
  }

  /** Sends a packet into the Internet (from an ISP edge or a virtual host). */
  send(packet: IpPacket): void {
    const hops = this.path(packet.src, packet.dst);
    let ttl = packet.ttl;
    for (const hop of hops) {
      if (ttl <= 1) {
        this.icmpError(packet, hop, 'ttl-exceeded');
        return;
      }
      ttl -= 1;
    }
    const p = { ...packet, ttl };
    const delay = HOP_MS * (hops.length + 1);
    const edge = this.edgeFor(p.dst);
    const origin = this.edgeFor(p.src)?.id ?? edge?.id;
    if (origin) this.observer?.(origin, edge?.id ?? origin, p);
    if (edge) return this.schedule(delay, () => edge.fromInternet(p));
    const host = this.hostFor(p.dst);
    if (host) return this.schedule(delay, () => host.receive(p));
    if (this.hopFor(p.dst) === p.dst) {
      if (p.icmp?.type === 'echo-request') this.schedule(delay, () => this.send({ src: p.dst, dst: p.src, ttl: ERROR_TTL, protocol: 'icmp', icmp: { ...p.icmp!, type: 'echo-reply' } }));
      return;
    }
    this.icmpError(packet, hops.at(-1) ?? BACKBONE[1], 'unreachable', 'net');
  }

  private icmpError(packet: IpPacket, from: number, type: 'ttl-exceeded' | 'unreachable', code?: UnreachableCode): void {
    if (packet.icmp?.type !== 'echo-request') return;
    const err: IpPacket = { src: from, dst: packet.src, ttl: ERROR_TTL, protocol: 'icmp', icmp: { ...packet.icmp, type, ...(code ? { code } : {}) } };
    this.schedule(HOP_MS, () => this.send(err));
  }
}
