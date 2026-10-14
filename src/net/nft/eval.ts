/**
 * Ruleset evaluation at a netfilter hook: base chains of every ip/inet table, by priority; `accept` ends
 * a base chain and the packet goes on to the next one, `drop`/`reject` are final; jump/goto/return;
 * counters and log; nat chains return the first NAT statement that matches.
 */
import type { Chain, Hook, Match, Rule, Ruleset, Table, Value, Verdict } from './model.ts';
import { NFT_LIMITS, findChain } from './model.ts';
import type { Counter } from './format.ts';
import type { IpPacket } from '../packets.ts';
import { inSubnet } from '../../core/ip.ts';

export type CtState = 'new' | 'established' | 'related' | 'invalid' | 'untracked';

export interface PacketMeta {
  readonly iif?: string;
  readonly oif?: string;
  readonly ct: CtState;
}

export type FilterResult = { readonly verdict: 'accept' } | { readonly verdict: 'drop' } | { readonly verdict: 'reject'; readonly with?: string };
export type NatDecision = Extract<Verdict, { kind: 'masquerade' | 'snat' | 'dnat' }> | null;

export interface EvalEnv {
  readonly counters: Map<number, Counter>;
  log?(prefix: string, p: IpPacket, meta: PacketMeta): void;
}

const ICMP_NAMES: Readonly<Record<string, string>> = { 'echo-request': 'echo-request', 'echo-reply': 'echo-reply', unreachable: 'destination-unreachable', 'ttl-exceeded': 'time-exceeded' };
const PACKET_OVERHEAD = 40;

function ports(p: IpPacket): { sport?: number; dport?: number } {
  const l4 = p.tcp ?? p.udp;
  return l4 ? { sport: l4.sport, dport: l4.dport } : {};
}

function fieldValue(m: Match, p: IpPacket, meta: PacketMeta): number | string | undefined {
  const pt = ports(p);
  switch (m.field) {
    case 'ip saddr': return p.src;
    case 'ip daddr': return p.dst;
    case 'ip protocol': case 'meta l4proto': return p.protocol;
    case 'tcp dport': return p.tcp?.dport;
    case 'tcp sport': return p.tcp?.sport;
    case 'udp dport': return p.udp?.dport;
    case 'udp sport': return p.udp?.sport;
    case 'th dport': return pt.dport;
    case 'th sport': return pt.sport;
    case 'ct state': return meta.ct;
    case 'iif': case 'iifname': return meta.iif;
    case 'oif': case 'oifname': return meta.oif;
    case 'icmp type': return p.icmp ? ICMP_NAMES[p.icmp.type] : undefined;
  }
}

function valueMatches(v: Value, x: number | string): boolean {
  switch (v.kind) {
    case 'addr': return typeof x === 'number' && inSubnet(x, v.ip, v.prefix);
    case 'num': return x === v.n;
    case 'range': return typeof x === 'number' && x >= v.from && x <= v.to;
    case 'word': return x === v.w;
    case 'set': return v.items.some((i) => valueMatches(i, x));
  }
}

/** A match on a field the packet does not have (tcp dport on UDP) never matches, even negated. */
function matches(m: Match, p: IpPacket, meta: PacketMeta): boolean {
  const x = fieldValue(m, p, meta);
  if (x === undefined) return false;
  return valueMatches(m.value, x) !== m.negate;
}

type Outcome = { kind: 'continue' } | { kind: 'return' } | { kind: 'final'; verdict: Verdict };

function count(env: EvalEnv, r: Rule): void {
  if (!r.counter) return;
  const c = env.counters.get(r.handle) ?? { packets: 0, bytes: 0 };
  c.packets += 1;
  c.bytes += PACKET_OVERHEAD;
  env.counters.set(r.handle, c);
}

function runChain(t: Table, ch: Chain, p: IpPacket, meta: PacketMeta, env: EvalEnv, depth: number): Outcome {
  if (depth > NFT_LIMITS.jumpDepth) return { kind: 'final', verdict: { kind: 'drop' } };
  for (const r of ch.rules) {
    if (!r.matches.every((m) => matches(m, p, meta))) continue;
    count(env, r);
    if (r.log !== undefined) env.log?.(r.log, p, meta);
    const v = r.verdict;
    if (!v) continue;
    if (v.kind === 'return') return { kind: 'return' };
    if (v.kind === 'jump' || v.kind === 'goto') {
      const target = findChain(t, v.chain);
      const sub = target ? runChain(t, target, p, meta, env, depth + 1) : { kind: 'continue' as const };
      if (sub.kind === 'final') return sub;
      if (v.kind === 'goto') return { kind: 'return' };
      continue;
    }
    return { kind: 'final', verdict: v };
  }
  return { kind: 'continue' };
}

function baseChains(rs: Ruleset, hook: Hook, type: 'filter' | 'nat'): { table: Table; chain: Chain }[] {
  return rs.tables
    .flatMap((table) => table.chains.filter((c) => c.base?.hook === hook && c.base.type === type).map((chain) => ({ table, chain })))
    .sort((a, b) => (a.chain.base?.priority ?? 0) - (b.chain.base?.priority ?? 0));
}

/** Filter chains of `hook`: accept, drop or reject. */
export function filterHook(rs: Ruleset, hook: Hook, p: IpPacket, meta: PacketMeta, env: EvalEnv): FilterResult {
  for (const { table, chain } of baseChains(rs, hook, 'filter')) {
    const o = runChain(table, chain, p, meta, env, 0);
    const v = o.kind === 'final' ? o.verdict : { kind: chain.base?.policy ?? 'accept' };
    if (v.kind === 'drop') return { verdict: 'drop' };
    if (v.kind === 'reject') return { verdict: 'reject', with: v.with };
  }
  return { verdict: 'accept' };
}

/** NAT chains of `hook` (only for the first packet of a connection): the translation, if any. */
export function natHook(rs: Ruleset, hook: Hook, p: IpPacket, meta: PacketMeta, env: EvalEnv): NatDecision | 'drop' {
  for (const { table, chain } of baseChains(rs, hook, 'nat')) {
    const o = runChain(table, chain, p, meta, env, 0);
    if (o.kind !== 'final') {
      if (chain.base?.policy === 'drop') return 'drop';
      continue;
    }
    const v = o.verdict;
    if (v.kind === 'masquerade' || v.kind === 'snat' || v.kind === 'dnat') return v;
    if (v.kind === 'drop' || v.kind === 'reject') return 'drop';
    if (v.kind === 'accept') return null;
  }
  return null;
}

/** Hooks that have at least one base chain (to skip work when the ruleset is empty). */
export function activeHooks(rs: Ruleset): ReadonlySet<Hook> {
  return new Set(rs.tables.flatMap((t) => t.chains.flatMap((c) => (c.base ? [c.base.hook] : []))));
}
