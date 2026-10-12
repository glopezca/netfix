/**
 * Network address translation shared by IOS NAT (`ip nat inside source …`) and the ISP cloud's
 * operator router: static mappings (optionally per port), dynamic 1:1 and PAT (overload).
 * ICMP echo uses the identifier as its "port", like IOS.
 */
import type { IpPacket } from './packets.ts';

export type NatProto = 'icmp' | 'tcp' | 'udp';

export interface StaticNat {
  readonly local: number;
  readonly global: number;
  /** Port mapping (`ip nat inside source static tcp …`); absent = whole address. */
  readonly proto?: 'tcp' | 'udp';
  readonly localPort?: number;
  readonly globalPort?: number;
}

export interface NatEntry {
  readonly proto: NatProto | null;
  readonly insideLocal: number;
  readonly insideGlobal: number;
  readonly localPort?: number;
  readonly globalPort?: number;
  readonly outside?: number;
  readonly outsidePort?: number;
  readonly static: boolean;
}

/** Where a dynamic rule translates an inside source to (null = no rule matches). */
export type DynamicTarget = { readonly global: number; readonly overload: boolean } | null;

const FIRST_PAT_PORT = 1024;
const LAST_PORT = 65535;
const MAX_ENTRIES = 4096;

interface Flow {
  readonly proto: NatProto;
  readonly sport: number;
  readonly dport: number;
}

export function flowOf(p: IpPacket): Flow {
  if (p.tcp) return { proto: 'tcp', sport: p.tcp.sport, dport: p.tcp.dport };
  if (p.udp) return { proto: 'udp', sport: p.udp.sport, dport: p.udp.dport };
  const id = p.icmp?.id ?? 0;
  return { proto: 'icmp', sport: id, dport: id };
}

export function rewriteSrc(p: IpPacket, ip: number, port?: number): IpPacket {
  if (port === undefined) return { ...p, src: ip };
  if (p.tcp) return { ...p, src: ip, tcp: { ...p.tcp, sport: port } };
  if (p.udp) return { ...p, src: ip, udp: { ...p.udp, sport: port } };
  return p.icmp ? { ...p, src: ip, icmp: { ...p.icmp, id: port } } : { ...p, src: ip };
}

export function rewriteDst(p: IpPacket, ip: number, port?: number): IpPacket {
  if (port === undefined) return { ...p, dst: ip };
  if (p.tcp) return { ...p, dst: ip, tcp: { ...p.tcp, dport: port } };
  if (p.udp) return { ...p, dst: ip, udp: { ...p.udp, dport: port } };
  return p.icmp ? { ...p, dst: ip, icmp: { ...p.icmp, id: port } } : { ...p, dst: ip };
}

function staticMatchesOut(s: StaticNat, p: IpPacket, f: Flow): boolean {
  return s.local === p.src && (s.proto === undefined || (s.proto === f.proto && s.localPort === f.sport));
}

function staticMatchesIn(s: StaticNat, p: IpPacket, f: Flow): boolean {
  return s.global === p.dst && (s.proto === undefined || (s.proto === f.proto && s.globalPort === f.dport));
}

export class NatTable {
  private dynamic: NatEntry[] = [];
  hits = 0;
  misses = 0;

  /** Inside → outside: translates the source, or returns null when no rule applies. */
  inside(p: IpPacket, statics: readonly StaticNat[], target: (p: IpPacket) => DynamicTarget): IpPacket | null {
    const f = flowOf(p);
    const st = statics.find((s) => staticMatchesOut(s, p, f));
    if (st) return this.hit(rewriteSrc(p, st.global, st.proto ? st.globalPort : undefined));
    const known = this.dynamic.find((e) => e.insideLocal === p.src && (e.proto === null || (e.proto === f.proto && e.localPort === f.sport)));
    if (known) return this.hit(rewriteSrc(p, known.insideGlobal, known.proto ? known.globalPort : undefined));
    const t = target(p);
    if (!t) return null;
    this.misses += 1;
    const entry = t.overload
      ? { proto: f.proto, insideLocal: p.src, insideGlobal: t.global, localPort: f.sport, globalPort: this.freePort(f.proto, t.global, f.sport), outside: p.dst, outsidePort: f.dport, static: false }
      : { proto: null, insideLocal: p.src, insideGlobal: t.global, static: false };
    this.dynamic = [...this.dynamic.slice(-(MAX_ENTRIES - 1)), entry];
    return rewriteSrc(p, entry.insideGlobal, entry.proto ? entry.globalPort : undefined);
  }

  /** Outside → inside: translates the destination, or returns null when nothing maps it. */
  outside(p: IpPacket, statics: readonly StaticNat[]): IpPacket | null {
    const f = flowOf(p);
    const known = this.dynamic.find((e) => e.insideGlobal === p.dst && (e.proto === null || (e.proto === f.proto && e.globalPort === f.dport)));
    if (known) return this.hit(rewriteDst(p, known.insideLocal, known.proto ? known.localPort : undefined));
    const st = statics.find((s) => s.proto !== undefined && staticMatchesIn(s, p, f)) ?? statics.find((s) => s.proto === undefined && staticMatchesIn(s, p, f));
    return st ? this.hit(rewriteDst(p, st.local, st.proto ? st.localPort : undefined)) : null;
  }

  /** Is this global address (and pool member) taken by a 1:1 dynamic translation? */
  globalInUse(global: number): boolean {
    return this.dynamic.some((e) => e.proto === null && e.insideGlobal === global);
  }

  entries(): readonly NatEntry[] {
    return this.dynamic;
  }

  clear(): void {
    this.dynamic = [];
  }

  private hit(p: IpPacket): IpPacket {
    this.hits += 1;
    return p;
  }

  private freePort(proto: NatProto, global: number, wanted: number): number {
    const used = new Set(this.dynamic.filter((e) => e.proto === proto && e.insideGlobal === global).map((e) => e.globalPort));
    if (!used.has(wanted) && wanted > 0) return wanted;
    for (let port = FIRST_PAT_PORT; port <= LAST_PORT; port++) if (!used.has(port)) return port;
    return wanted;
  }
}
