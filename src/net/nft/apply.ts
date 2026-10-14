/**
 * Applies nft commands to a ruleset. Atomic like `nft -f`: on any error the ruleset is left as it was.
 * Also checks what the kernel refuses: missing tables/chains, NAT statements outside nat chains, jumps
 * to unknown chains, deleting non-empty chains, and the size limits.
 */
import type { Chain, Rule, Ruleset, Table, Verdict } from './model.ts';
import { NFT_LIMITS, findChain, findTable, withChain, withTable } from './model.ts';
import type { Command, RuleBody, Target } from './parse.ts';
import { parseNft } from './parse.ts';
import { errorBlock } from './lexer.ts';
import type { Token } from './lexer.ts';
import type { FormatOptions } from './format.ts';
import { rulesetText, singleChainText, tableText } from './format.ts';

const MAX_INCLUDE_DEPTH = 8;
/** Files read in one run (a file that includes itself many times would otherwise fan out exponentially). */
const MAX_INCLUDES = 64;

export type ApplyResult = { ok: true; ruleset: Ruleset; output: string[] } | { ok: false; error: string };

export interface ApplyEnv {
  /** Reads an included file (absolute path); null when it does not exist. */
  read?(path: string): string | null;
  readonly format?: FormatOptions;
  /** Includes read so far in this run (set by runNft). */
  readonly includes?: { n: number };
}

class ApplyError extends Error {
  readonly at: Token | undefined;

  constructor(message: string, at?: Token) {
    super(message);
    this.at = at;
  }
}

const notFound = (at: Token): ApplyError => new ApplyError('Error: Could not process rule: No such file or directory', at);

function table(rs: Ruleset, t: Target): Table {
  const found = findTable(rs, t.family, t.table);
  if (!found) throw notFound(t.at);
  return found;
}

function chainOf(tb: Table, t: Target): Chain {
  const found = findChain(tb, t.chain ?? '');
  if (!found) throw notFound(t.at);
  return found;
}

/** NAT statements only in nat chains, at the hooks where the kernel accepts them. */
function checkVerdict(tb: Table, ch: Chain, v: Verdict | undefined, at: Token): void {
  if (!v) return;
  const hook = ch.base?.hook;
  const natOk = (hooks: readonly string[]): boolean => !ch.base || (ch.base.type === 'nat' && hooks.includes(hook ?? ''));
  if ((v.kind === 'masquerade' || v.kind === 'snat') && !natOk(['postrouting', 'input'])) throw new ApplyError('Error: Could not process rule: Operation not supported', at);
  if (v.kind === 'dnat' && !natOk(['prerouting', 'output'])) throw new ApplyError('Error: Could not process rule: Operation not supported', at);
  if ((v.kind === 'jump' || v.kind === 'goto') && !findChain(tb, v.chain)) throw notFound(at);
}

function addRule(rs: Ruleset, c: Extract<Command, { op: 'add-rule' | 'insert-rule' }>): Ruleset {
  const tb = table(rs, c.target);
  const ch = chainOf(tb, c.target);
  if (ch.rules.length >= NFT_LIMITS.rulesPerChain) throw new ApplyError('Error: Could not process rule: Too many rules (límite de Netfix)', c.target.at);
  checkVerdict(tb, ch, c.rule.verdict, c.target.at);
  const rule: Rule = { ...c.rule, handle: rs.nextHandle };
  const rules = [...ch.rules];
  let at = c.op === 'insert-rule' ? 0 : rules.length;
  if (c.position !== undefined) {
    const i = rules.findIndex((r) => r.handle === c.position);
    if (i < 0) throw notFound(c.target.at);
    at = c.op === 'insert-rule' ? i : i + 1;
  } else if (c.index !== undefined) {
    if (c.index < 0 || c.index > rules.length) throw notFound(c.target.at);
    at = c.op === 'insert-rule' ? c.index : c.index + 1;
  }
  rules.splice(at, 0, rule);
  return { ...withTable(rs, withChain(tb, { ...ch, rules })), nextHandle: rs.nextHandle + 1 };
}

function changeRule(rs: Ruleset, t: Target, handle: number, body: RuleBody | null): Ruleset {
  const tb = table(rs, t);
  const ch = chainOf(tb, t);
  if (!ch.rules.some((r) => r.handle === handle)) throw notFound(t.at);
  if (body) checkVerdict(tb, ch, body.verdict, t.at);
  const rules = body ? ch.rules.map((r) => (r.handle === handle ? { ...body, handle } : r)) : ch.rules.filter((r) => r.handle !== handle);
  return withTable(rs, withChain(tb, { ...ch, rules }));
}

function addTable(rs: Ruleset, c: Extract<Command, { op: 'add-table' }>): Ruleset {
  if (findTable(rs, c.target.family, c.target.table)) {
    if (c.create) throw new ApplyError('Error: Could not process rule: File exists', c.target.at);
    return rs;
  }
  if (rs.tables.length >= NFT_LIMITS.tables) throw new ApplyError('Error: Could not process rule: Too many tables (límite de Netfix)', c.target.at);
  return { tables: [...rs.tables, { family: c.target.family, name: c.target.table, handle: rs.nextHandle, chains: [] }], nextHandle: rs.nextHandle + 1 };
}

function addChain(rs: Ruleset, c: Extract<Command, { op: 'add-chain' }>): Ruleset {
  const tb = table(rs, c.target);
  const existing = findChain(tb, c.target.chain ?? '');
  if (existing) {
    if (c.create) throw new ApplyError('Error: Could not process rule: File exists', c.target.at);
    if (c.base && existing.base && (c.base.hook !== existing.base.hook || c.base.type !== existing.base.type)) throw new ApplyError('Error: Could not process rule: Operation not supported', c.target.at);
    return c.base ? withTable(rs, withChain(tb, { ...existing, base: c.base })) : rs;
  }
  if (tb.chains.length >= NFT_LIMITS.chainsPerTable) throw new ApplyError('Error: Could not process rule: Too many chains (límite de Netfix)', c.target.at);
  const chain: Chain = { name: c.target.chain ?? '', handle: rs.nextHandle, base: c.base, rules: [] };
  return { ...withTable(rs, withChain(tb, chain)), nextHandle: rs.nextHandle + 1 };
}

function deleteChain(rs: Ruleset, t: Target): Ruleset {
  const tb = table(rs, t);
  const ch = chainOf(tb, t);
  const referenced = tb.chains.some((x) => x.rules.some((r) => (r.verdict?.kind === 'jump' || r.verdict?.kind === 'goto') && r.verdict.chain === ch.name));
  if (ch.rules.length > 0 || referenced) throw new ApplyError('Error: Could not process rule: Device or resource busy', t.at);
  return withTable(rs, { ...tb, chains: tb.chains.filter((x) => x !== ch) });
}

function list(rs: Ruleset, c: Extract<Command, { op: 'list' }>, o: FormatOptions): string[] {
  if (c.what === 'ruleset') return rulesetText(rs, o);
  if (c.what === 'tables') return rs.tables.map((t) => `table ${t.family} ${t.name}`);
  if (c.what === 'chains') return rs.tables.flatMap((t) => [`table ${t.family} ${t.name} {`, ...t.chains.flatMap((ch) => [`\tchain ${ch.name} {`, ...(ch.base ? [`\t\ttype ${ch.base.type} hook ${ch.base.hook} priority ${ch.base.priority}; policy ${ch.base.policy};`] : []), '\t}']), '}']);
  const t = c.target as Target;
  const tb = table(rs, t);
  return c.what === 'table' ? tableText(tb, o) : singleChainText(tb, chainOf(tb, t), o);
}

function step(rs: Ruleset, c: Command, out: string[], env: ApplyEnv, depth: number): Ruleset {
  switch (c.op) {
    case 'flush-ruleset': return { tables: [], nextHandle: rs.nextHandle };
    case 'add-table': return addTable(rs, c);
    case 'delete-table': { table(rs, c.target); return { ...rs, tables: rs.tables.filter((t) => !(t.family === c.target.family && t.name === c.target.table)) }; }
    case 'flush-table': { const tb = table(rs, c.target); return withTable(rs, { ...tb, chains: tb.chains.map((ch) => ({ ...ch, rules: [] })) }); }
    case 'add-chain': return addChain(rs, c);
    case 'delete-chain': return deleteChain(rs, c.target);
    case 'flush-chain': { const tb = table(rs, c.target); return withTable(rs, withChain(tb, { ...chainOf(tb, c.target), rules: [] })); }
    case 'add-rule': case 'insert-rule': return addRule(rs, c);
    case 'replace-rule': return changeRule(rs, c.target, c.handle, c.rule);
    case 'delete-rule': return changeRule(rs, c.target, c.handle, null);
    case 'list': out.push(...list(rs, c, env.format ?? {})); return rs;
    case 'include': return include(rs, c, out, env, depth);
  }
}

function include(rs: Ruleset, c: Extract<Command, { op: 'include' }>, out: string[], env: ApplyEnv, depth: number): Ruleset {
  if (depth >= MAX_INCLUDE_DEPTH) throw new ApplyError('Error: Include nested too deeply, max 8 levels', c.at);
  if (env.includes && ++env.includes.n > MAX_INCLUDES) throw new ApplyError(`Error: too many included files (max ${MAX_INCLUDES})`, c.at);
  const text = env.read?.(c.path) ?? null;
  if (text === null) throw new ApplyError(`Error: File not found: ${c.path}`, c.at);
  const parsed = parseNft(text);
  if (!parsed.ok) throw new ApplyError(`${parsed.error} (${c.path}:${parsed.line})`, c.at);
  return parsed.commands.reduce((acc, cmd) => step(acc, cmd, out, env, depth + 1), rs);
}

/** Parses and applies `src`; errors come as nft prints them (message, line, carets). */
export function runNft(rs: Ruleset, src: string, given: ApplyEnv = {}): ApplyResult {
  const env: ApplyEnv = { ...given, includes: { n: 0 } };
  const lines = src.split('\n');
  const parsed = parseNft(src);
  if (!parsed.ok) return { ok: false, error: errorBlock(parsed.error, lines[parsed.line - 1] ?? '', parsed.col, parsed.len) };
  const out: string[] = [];
  try {
    const next = parsed.commands.reduce((acc, c) => step(acc, c, out, env, 0), rs);
    return { ok: true, ruleset: next, output: out };
  } catch (e) {
    if (!(e instanceof ApplyError)) throw e;
    const at = e.at;
    return { ok: false, error: at ? errorBlock(e.message, lines[at.line - 1] ?? '', at.col, at.text.length) : e.message };
  }
}

/** The text `nft list ruleset` prints, also used to write /etc/nftables.conf from the GUI. */
export function rulesetFile(rs: Ruleset): string {
  return ['#!/usr/sbin/nft -f', '', 'flush ruleset', '', ...rulesetText(rs), ''].join('\n');
}
