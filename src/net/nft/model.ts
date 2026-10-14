/**
 * nftables ruleset as immutable records: tables (family ip|inet) with chains, base chains with
 * type/hook/priority/policy, and rules made of matches and one statement list ending in a verdict.
 */

export type Family = 'ip' | 'inet';
export type Hook = 'prerouting' | 'input' | 'forward' | 'output' | 'postrouting';
export type ChainType = 'filter' | 'nat';
export type Policy = 'accept' | 'drop';

export interface BaseChain {
  readonly type: ChainType;
  readonly hook: Hook;
  readonly priority: number;
  readonly policy: Policy;
}

/** Values compared by a match: single values, ranges and anonymous sets. */
export type Value =
  | { readonly kind: 'addr'; readonly ip: number; readonly prefix: number }
  | { readonly kind: 'num'; readonly n: number }
  | { readonly kind: 'range'; readonly from: number; readonly to: number }
  | { readonly kind: 'word'; readonly w: string }
  | { readonly kind: 'set'; readonly items: readonly Value[] };

export type Field =
  | 'ip saddr' | 'ip daddr' | 'ip protocol' | 'meta l4proto'
  | 'tcp dport' | 'tcp sport' | 'udp dport' | 'udp sport' | 'th dport' | 'th sport'
  | 'ct state' | 'iif' | 'oif' | 'iifname' | 'oifname' | 'icmp type';

export interface Match {
  readonly field: Field;
  readonly negate: boolean;
  readonly value: Value;
}

export type Verdict =
  | { readonly kind: 'accept' }
  | { readonly kind: 'drop' }
  | { readonly kind: 'reject'; readonly with?: 'tcp reset' | 'icmp port-unreachable' | 'icmp host-unreachable' | 'icmp admin-prohibited' }
  | { readonly kind: 'jump' | 'goto'; readonly chain: string }
  | { readonly kind: 'return' }
  | { readonly kind: 'masquerade' }
  | { readonly kind: 'snat' | 'dnat'; readonly ip: number; readonly port?: number };

export interface Rule {
  readonly handle: number;
  readonly matches: readonly Match[];
  readonly counter: boolean;
  readonly log?: string;
  readonly verdict?: Verdict;
  readonly comment?: string;
}

export interface Chain {
  readonly name: string;
  readonly handle: number;
  readonly base?: BaseChain;
  readonly rules: readonly Rule[];
}

export interface Table {
  readonly family: Family;
  readonly name: string;
  readonly handle: number;
  readonly chains: readonly Chain[];
}

export interface Ruleset {
  readonly tables: readonly Table[];
  /** Next handle to assign (handles are unique per ruleset here; nft numbers them per table). */
  readonly nextHandle: number;
}

export const EMPTY_RULESET: Ruleset = { tables: [], nextHandle: 1 };

/** Standard priorities by name (nft prints the name when the value matches). */
export const PRIORITY_NAMES: Readonly<Record<string, number>> = {
  raw: -300, mangle: -150, dstnat: -100, filter: 0, security: 50, srcnat: 100,
};

/** Limits that protect the browser tab from huge rule files. */
export const NFT_LIMITS = { tables: 64, chainsPerTable: 64, rulesPerChain: 512, setItems: 256, jumpDepth: 16 } as const;

export function findTable(rs: Ruleset, family: Family, name: string): Table | undefined {
  return rs.tables.find((t) => t.family === family && t.name === name);
}

export function findChain(t: Table, name: string): Chain | undefined {
  return t.chains.find((c) => c.name === name);
}

/** Returns a ruleset where `table` is replaced (or added). */
export function withTable(rs: Ruleset, table: Table): Ruleset {
  const i = rs.tables.findIndex((t) => t.family === table.family && t.name === table.name);
  const tables = i < 0 ? [...rs.tables, table] : rs.tables.map((t, j) => (j === i ? table : t));
  return { ...rs, tables };
}

export function withChain(t: Table, chain: Chain): Table {
  const i = t.chains.findIndex((c) => c.name === chain.name);
  const chains = i < 0 ? [...t.chains, chain] : t.chains.map((c, j) => (j === i ? chain : c));
  return { ...t, chains };
}
