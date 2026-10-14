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
  /** Index of the dynamic rule that created it (show ip nat statistics refcount). */
  readonly rule?: number;
}

/** Where a dynamic rule translates an inside source to: null = no rule matches, 'exhausted' = drop. */
export type DynamicTarget = { readonly global: number; readonly overload: boolean; readonly rule?: number } | null | 'exhausted';

/** Result of an inside → outside translation: a packet, null (no rule: forward untranslated) or 'drop'. */
export type InsideResult = IpPacket | null | 'drop';

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

  /** Inside → outside: translates the source; null when no rule applies, 'drop' when the rule cannot. */
  inside(p: IpPacket, statics: readonly StaticNat[], target: (p: IpPacket) => DynamicTarget): InsideResult {
    if (p.protocol === 'esp') return this.insideEsp(p, statics, target);
    const f = flowOf(p);
    const st = statics.find((s) => staticMatchesOut(s, p, f));
    if (st) return this.hit(rewriteSrc(p, st.global, st.proto ? st.globalPort : undefined));
    const known = this.dynamic.find((e) => e.insideLocal === p.src && (e.proto === null || (e.proto === f.proto && e.localPort === f.sport)));
    if (known) return this.hit(rewriteSrc(p, known.insideGlobal, known.proto ? known.globalPort : undefined));
    const t = target(p);
    if (!t) return null;
    this.misses += 1;
    if (t === 'exhausted') return 'drop';
    const reserved = new Set(statics.filter((s) => s.global === t.global && s.proto === f.proto).map((s) => s.globalPort));
    const port = t.overload ? this.freePort(f.proto, t.global, f.sport, reserved) : 0;
    if (port === null) return 'drop';
    const entry: NatEntry = t.overload
      ? { proto: f.proto, insideLocal: p.src, insideGlobal: t.global, localPort: f.sport, globalPort: port, outside: p.dst, outsidePort: f.dport, static: false, rule: t.rule }
      : { proto: null, insideLocal: p.src, insideGlobal: t.global, static: false, rule: t.rule };
    this.dynamic = [...this.dynamic.slice(-(MAX_ENTRIES - 1)), entry];
    return rewriteSrc(p, entry.insideGlobal, entry.proto ? entry.globalPort : undefined);
  }

  /**
   * ESP has no ports: a 1:1 translation (static, or a dynamic one without overload) can carry it; PAT
   * cannot, so the packet is dropped (that is why IPsec behind a NAT needs NAT-T or public addresses).
   */
  private insideEsp(p: IpPacket, statics: readonly StaticNat[], target: (p: IpPacket) => DynamicTarget): InsideResult {
    const st = statics.find((s) => s.local === p.src && s.proto === undefined);
    if (st) return this.hit({ ...p, src: st.global });
    const known = this.dynamic.find((e) => e.insideLocal === p.src && e.proto === null);
    if (known) return this.hit({ ...p, src: known.insideGlobal });
    const t = target(p);
    if (!t) return null;
    if (t === 'exhausted' || t.overload) return 'drop';
    const entry: NatEntry = { proto: null, insideLocal: p.src, insideGlobal: t.global, static: false, rule: t.rule };
    this.dynamic = [...this.dynamic.slice(-(MAX_ENTRIES - 1)), entry];
    return { ...p, src: t.global };
  }

  /** Outside → inside: translates the destination, or returns null when nothing maps it. */
  outside(p: IpPacket, statics: readonly StaticNat[]): IpPacket | null {
    if (p.protocol === 'esp') {
      const whole = statics.find((s) => s.global === p.dst && s.proto === undefined) ?? this.dynamic.find((e) => e.proto === null && e.insideGlobal === p.dst);
      return whole ? this.hit({ ...p, dst: 'local' in whole ? whole.local : whole.insideLocal }) : null;
    }
    const f = flowOf(p);
    const port = statics.find((s) => s.proto !== undefined && staticMatchesIn(s, p, f));
    if (port) return this.hit(rewriteDst(p, port.local, port.localPort));
    const known = this.dynamic.find((e) => e.insideGlobal === p.dst && (e.proto === null || (e.proto === f.proto && e.globalPort === f.dport)));
    if (known) return this.hit(rewriteDst(p, known.insideLocal, known.proto ? known.localPort : undefined));
    const whole = statics.find((s) => s.proto === undefined && staticMatchesIn(s, p, f));
    return whole ? this.hit(rewriteDst(p, whole.local)) : null;
  }

  /** Is this global address (and pool member) taken by a 1:1 dynamic translation? */
  globalInUse(global: number): boolean {
    return this.dynamic.some((e) => e.proto === null && e.insideGlobal === global);
  }

  entries(): readonly NatEntry[] {
    return this.dynamic;
  }

  /** clear ip nat translation * (statistics are kept, like IOS). */
  clear(): void {
    this.dynamic = [];
  }

  /** Factory state (reload): no translations and zeroed statistics. */
  reset(): void {
    this.dynamic = [];
    this.hits = 0;
    this.misses = 0;
  }

  private hit(p: IpPacket): IpPacket {
    this.hits += 1;
    return p;
  }

  /** The inside port itself when free, else the first free one; null when every port is taken. */
  private freePort(proto: NatProto, global: number, wanted: number, reserved: ReadonlySet<number | undefined>): number | null {
    const used = new Set(this.dynamic.filter((e) => e.proto === proto && e.insideGlobal === global).map((e) => e.globalPort));
    const free = (port: number): boolean => !used.has(port) && !reserved.has(port);
    if (wanted > 0 && free(wanted)) return wanted;
    for (let port = FIRST_PAT_PORT; port <= LAST_PORT; port++) if (free(port)) return port;
    return null;
  }
}
