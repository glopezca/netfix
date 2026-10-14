/**
 * Connection tracking (nf_conntrack) for netfilter: 5-tuples in both directions, the NAT applied to
 * the connection, its state (new / established / related / invalid) and timeouts on the simulated clock.
 * A connection is indexed under the tuples it shows at every NAT stage, so any hook finds it.
 */
import type { IpPacket } from './packets.ts';
import type { CtState } from './nft/eval.ts';

export type CtProto = 'tcp' | 'udp' | 'icmp';

export interface Tuple {
  readonly proto: CtProto;
  readonly src: number;
  readonly dst: number;
  /** Ports; ICMP echo uses its identifier for both. */
  readonly sport: number;
  readonly dport: number;
}

export interface NatTo {
  readonly ip: number;
  readonly port?: number;
}

export interface CtEntry {
  readonly orig: Tuple;
  dnat?: NatTo;
  snat?: NatTo;
  seenReply: boolean;
  confirmed: boolean;
  closing: boolean;
  lastSeen: number;
  packets: number;
}

export type Direction = 'orig' | 'reply';

export const CT_MAX = 4096;
const TIMEOUT_MS: Readonly<Record<CtProto, number>> = { tcp: 7_200_000, udp: 120_000, icmp: 30_000 };
const UNREPLIED_MS = 30_000;
const CLOSING_MS = 10_000;

export function tupleOf(p: IpPacket): Tuple | null {
  if (p.tcp) return { proto: 'tcp', src: p.src, dst: p.dst, sport: p.tcp.sport, dport: p.tcp.dport };
  if (p.udp) return { proto: 'udp', src: p.src, dst: p.dst, sport: p.udp.sport, dport: p.udp.dport };
  if (p.icmp && (p.icmp.type === 'echo-request' || p.icmp.type === 'echo-reply')) return { proto: 'icmp', src: p.src, dst: p.dst, sport: p.icmp.id, dport: p.icmp.id };
  return null;
}

const key = (t: Tuple): string => `${t.proto}|${t.src}|${t.sport}|${t.dst}|${t.dport}`;
const swap = (t: Tuple): Tuple => ({ ...t, src: t.dst, dst: t.src, sport: t.dport, dport: t.sport });

/** The tuples a connection shows in the original direction, after DNAT, and after DNAT + SNAT. */
export function origStages(e: CtEntry): Tuple[] {
  const afterDnat = e.dnat ? { ...e.orig, dst: e.dnat.ip, dport: e.dnat.port ?? e.orig.dport } : e.orig;
  const afterAll = e.snat ? { ...afterDnat, src: e.snat.ip, sport: e.snat.port ?? afterDnat.sport } : afterDnat;
  return [e.orig, afterDnat, afterAll];
}

/** Reply tuples: as it arrives (swap of the final original), after undoing SNAT, after undoing both. */
export function replyStages(e: CtEntry): Tuple[] {
  const [, afterDnat, afterAll] = origStages(e) as [Tuple, Tuple, Tuple];
  const arrives = swap(afterAll);
  return [arrives, { ...arrives, dst: e.orig.src, dport: e.orig.sport }, swap(e.orig), swap(afterDnat)];
}

export class Conntrack {
  private readonly index = new Map<string, { entry: CtEntry; dir: Direction }>();
  private readonly entries = new Set<CtEntry>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  list(): readonly CtEntry[] {
    this.expire();
    return [...this.entries];
  }

  lookup(p: IpPacket): { entry: CtEntry; dir: Direction } | null {
    const t = tupleOf(p);
    const hit = t ? this.index.get(key(t)) : undefined;
    if (!hit || this.expired(hit.entry)) return null;
    return hit;
  }

  /** State of `p` and the connection it belongs to (a new, unconfirmed one when unknown). */
  classify(p: IpPacket): { state: CtState; entry: CtEntry | null; dir: Direction } {
    const hit = this.lookup(p);
    if (hit) {
      const established = hit.dir === 'reply' || hit.entry.seenReply;
      return { state: established ? 'established' : 'new', entry: hit.entry, dir: hit.dir };
    }
    if (p.icmp && (p.icmp.type === 'unreachable' || p.icmp.type === 'ttl-exceeded')) return { state: this.related(p) ? 'related' : 'invalid', entry: null, dir: 'orig' };
    const t = tupleOf(p);
    if (!t) return { state: 'untracked', entry: null, dir: 'orig' };
    if (t.proto === 'tcp' && !p.tcp?.flags.includes('SYN')) return { state: 'invalid', entry: null, dir: 'orig' };
    if (p.icmp?.type === 'echo-reply') return { state: 'invalid', entry: null, dir: 'orig' };
    return { state: 'new', entry: { orig: t, seenReply: false, confirmed: false, closing: false, lastSeen: this.now(), packets: 0 }, dir: 'orig' };
  }

  /** An ICMP error about a known connection between the same hosts. */
  private related(p: IpPacket): boolean {
    for (const e of this.entries) {
      if ([...origStages(e), ...replyStages(e)].some((t) => t.src === p.dst || t.dst === p.dst)) return true;
    }
    return false;
  }

  /** Records a packet of `entry` (and confirms a new connection); false when the table is full. */
  see(entry: CtEntry, dir: Direction, p: IpPacket): boolean {
    if (!entry.confirmed) {
      this.expire();
      if (this.entries.size >= CT_MAX) return false;
      entry.confirmed = true;
      this.entries.add(entry);
    }
    if (dir === 'reply') entry.seenReply = true;
    if (p.tcp?.flags.includes('FIN') || p.tcp?.flags.includes('RST')) entry.closing = true;
    entry.lastSeen = this.now();
    entry.packets += 1;
    this.reindex(entry);
    return true;
  }

  /** (Re)indexes all the tuples of a confirmed connection, e.g. after NAT was decided. */
  reindex(entry: CtEntry): void {
    if (!entry.confirmed) return;
    for (const t of origStages(entry)) this.index.set(key(t), { entry, dir: 'orig' });
    for (const t of replyStages(entry)) this.index.set(key(t), { entry, dir: 'reply' });
  }

  /** Is a translated tuple (in the reply direction) already used by another connection? */
  replyTaken(t: Tuple): boolean {
    const hit = this.index.get(key(swap(t)));
    return hit !== undefined && !this.expired(hit.entry);
  }

  flush(): void {
    this.index.clear();
    this.entries.clear();
  }

  private expired(e: CtEntry): boolean {
    const limit = e.closing ? CLOSING_MS : e.seenReply ? TIMEOUT_MS[e.orig.proto] : Math.min(UNREPLIED_MS, TIMEOUT_MS[e.orig.proto]);
    return this.now() - e.lastSeen > limit;
  }

  /** Drops expired connections: one pass over the entries and one over the index. */
  private expire(): void {
    const gone = new Set<CtEntry>();
    for (const e of this.entries) if (this.expired(e)) gone.add(e);
    if (!gone.size) return;
    for (const e of gone) this.entries.delete(e);
    for (const [k, v] of this.index) if (gone.has(v.entry)) this.index.delete(k);
  }
}
