/**
 * nft commands (`nft add rule inet filter input tcp dport 22 accept`) and rule files (`nft -f`):
 * `table inet filter { chain input { type filter hook input priority filter; policy drop; … } }`,
 * `flush ruleset`, `define NAME = value` / `$NAME` and `include "file"`.
 */
import type { BaseChain, ChainType, Family, Hook, Policy, Rule } from './model.ts';
import { PRIORITY_NAMES } from './model.ts';
import { lex } from './lexer.ts';
import type { Token } from './lexer.ts';
import { Cursor, NftSyntaxError, parseRuleBody } from './parse-rule.ts';

export interface Target {
  readonly family: Family;
  readonly table: string;
  readonly chain?: string;
  /** Token of the table (or chain) name, for "No such file or directory" marks. */
  readonly at: Token;
}

export type RuleBody = Omit<Rule, 'handle'>;

export type Command =
  | { readonly op: 'flush-ruleset' }
  | { readonly op: 'add-table'; readonly target: Target; readonly create?: boolean }
  | { readonly op: 'delete-table' | 'flush-table'; readonly target: Target }
  | { readonly op: 'add-chain'; readonly target: Target; readonly base?: BaseChain; readonly create?: boolean }
  | { readonly op: 'delete-chain' | 'flush-chain'; readonly target: Target }
  | { readonly op: 'add-rule' | 'insert-rule'; readonly target: Target; readonly rule: RuleBody; readonly position?: number; readonly index?: number }
  | { readonly op: 'replace-rule'; readonly target: Target; readonly rule: RuleBody; readonly handle: number }
  | { readonly op: 'delete-rule'; readonly target: Target; readonly handle: number }
  | { readonly op: 'list'; readonly what: 'ruleset' | 'tables' | 'table' | 'chain' | 'chains'; readonly target?: Target }
  | { readonly op: 'include'; readonly path: string; readonly at: Token };

export type ParseResult = { ok: true; commands: Command[] } | { ok: false; error: string; line: number; col: number; len: number };

const FAMILIES = new Set(['ip', 'inet']);
const HOOKS = new Set(['prerouting', 'input', 'forward', 'output', 'postrouting']);
const MAX_DEFINES = 64;

function word(c: Cursor): Token {
  const t = c.next();
  if (!t || t.kind === 'newline' || t.kind === 'punct') throw new NftSyntaxError(`Error: syntax error, unexpected ${t?.kind === 'newline' || !t ? 'newline' : t.text}`, t);
  return t;
}

function target(c: Cursor, withChain: boolean): Target {
  const first = c.peek();
  const family: Family = first && FAMILIES.has(first.text) && c.peek(1) && c.peek(1)?.kind === 'word' ? (c.next(), first.text as Family) : 'ip';
  if (first && ['ip6', 'arp', 'bridge', 'netdev'].includes(first.text)) throw new NftSyntaxError(`Error: Could not process rule: Operation not supported (familia ${first.text} no disponible en Netfix)`, first);
  const t = word(c);
  if (!withChain) return { family, table: t.text, at: t };
  const ch = word(c);
  return { family, table: t.text, chain: ch.text, at: t };
}

function priority(c: Cursor): number {
  const t = word(c);
  const base = /^-?\d+$/.test(t.text) ? Number(t.text) : PRIORITY_NAMES[t.text];
  if (base === undefined) throw new NftSyntaxError(`Error: '${t.text}' is not a valid priority in this context`, t);
  const op = c.peek()?.text;
  if (op !== '+' && op !== '-') return base;
  c.next();
  const n = Number(word(c).text);
  return op === '+' ? base + n : base - n;
}

/** `type filter hook input priority 0; policy drop;` inside a chain block. */
function chainSpec(c: Cursor, spec: { base?: BaseChain }): boolean {
  if (c.eat('type')) {
    const type = word(c);
    if (type.text !== 'filter' && type.text !== 'nat') throw new NftSyntaxError(`Error: unknown chain type`, type);
    if (!c.eat('hook')) throw new NftSyntaxError('Error: syntax error, unexpected newline, expecting hook', c.peek());
    const hook = word(c);
    if (!HOOKS.has(hook.text)) throw new NftSyntaxError(`Error: unknown chain hook`, hook);
    if (!c.eat('priority')) throw new NftSyntaxError('Error: syntax error, expecting priority', c.peek());
    const prio = priority(c);
    spec.base = { type: type.text as ChainType, hook: hook.text as Hook, priority: prio, policy: spec.base?.policy ?? 'accept' };
    return true;
  }
  if (c.eat('policy')) {
    const p = word(c);
    if (p.text !== 'accept' && p.text !== 'drop') throw new NftSyntaxError(`Error: syntax error, unexpected ${p.text}`, p);
    if (!spec.base) throw new NftSyntaxError('Error: policy requires a base chain', p);
    spec.base = { ...spec.base, policy: p.text as Policy };
    return true;
  }
  return false;
}

function separators(c: Cursor): void {
  while (c.peek()?.kind === 'newline' || c.peek()?.text === ';') c.next();
}

function chainBlock(c: Cursor, t: Target, out: Command[]): void {
  const spec: { base?: BaseChain } = {};
  const rules: RuleBody[] = [];
  separators(c);
  while (!c.eat('}')) {
    if (!c.peek()) throw new NftSyntaxError('Error: syntax error, unexpected end of file', undefined);
    if (!chainSpec(c, spec)) rules.push(parseRuleBody(c));
    separators(c);
  }
  out.push({ op: 'add-chain', target: t, base: spec.base });
  for (const rule of rules) out.push({ op: 'add-rule', target: t, rule });
}

function tableBlock(c: Cursor, t: Target, out: Command[]): void {
  out.push({ op: 'add-table', target: t });
  separators(c);
  while (!c.eat('}')) {
    const kw = word(c);
    if (kw.text === 'flags' || kw.text === 'comment') { c.next(); separators(c); continue; }
    if (kw.text !== 'chain') throw new NftSyntaxError(`Error: syntax error, unexpected ${kw.text}`, kw);
    const name = word(c);
    if (!c.eat('{')) throw new NftSyntaxError('Error: syntax error, expecting {', c.peek());
    chainBlock(c, { ...t, chain: name.text }, out);
    separators(c);
  }
}

function ruleOp(c: Cursor, op: 'add' | 'insert' | 'replace' | 'delete'): Command {
  const t = target(c, true);
  if (op === 'delete' || op === 'replace') {
    if (!c.eat('handle')) throw new NftSyntaxError('Error: syntax error, expecting handle', c.peek());
    const h = Number(word(c).text);
    if (op === 'delete') return { op: 'delete-rule', target: t, handle: h };
    return { op: 'replace-rule', target: t, handle: h, rule: parseRuleBody(c) };
  }
  let position: number | undefined;
  let index: number | undefined;
  if (c.eat('position') || c.eat('handle')) position = Number(word(c).text);
  else if (c.eat('index')) index = Number(word(c).text);
  return { op: op === 'add' ? 'add-rule' : 'insert-rule', target: t, rule: parseRuleBody(c), position, index };
}

function objectOp(c: Cursor, verb: string, out: Command[]): void {
  const what = word(c);
  if (what.text === 'ruleset' && verb === 'flush') { out.push({ op: 'flush-ruleset' }); return; }
  if (what.text === 'table') {
    const t = target(c, false);
    if (verb === 'add' || verb === 'create') {
      if (c.eat('{')) tableBlock(c, t, out);
      else out.push({ op: 'add-table', target: t, create: verb === 'create' });
    } else if (verb === 'delete' || verb === 'destroy' || verb === 'flush') out.push(verb === 'flush' ? { op: 'flush-table', target: t } : { op: 'delete-table', target: t });
    else throw new NftSyntaxError(`Error: syntax error, unexpected ${verb}`, what);
    return;
  }
  if (what.text === 'chain') {
    const t = target(c, true);
    if (verb === 'add' || verb === 'create') {
      if (c.eat('{')) { chainBlock(c, t, out); return; }
      out.push({ op: 'add-chain', target: t, create: verb === 'create' });
    } else if (verb === 'delete' || verb === 'flush') out.push({ op: verb === 'flush' ? 'flush-chain' : 'delete-chain', target: t });
    else throw new NftSyntaxError(`Error: syntax error, unexpected ${verb}`, what);
    return;
  }
  if (what.text === 'rule' && (verb === 'add' || verb === 'insert' || verb === 'replace' || verb === 'delete')) { out.push(ruleOp(c, verb)); return; }
  throw new NftSyntaxError(`Error: syntax error, unexpected ${what.text}`, what);
}

function listOp(c: Cursor, out: Command[]): void {
  const what = word(c);
  if (what.text === 'ruleset' || what.text === 'tables' || what.text === 'chains') {
    if (what.text !== 'chains' && c.peek() && FAMILIES.has(c.peek()?.text ?? '')) c.next();
    out.push({ op: 'list', what: what.text });
    return;
  }
  if (what.text === 'table') { out.push({ op: 'list', what: 'table', target: target(c, false) }); return; }
  if (what.text === 'chain') { out.push({ op: 'list', what: 'chain', target: target(c, true) }); return; }
  throw new NftSyntaxError(`Error: syntax error, unexpected ${what.text}`, what);
}

function statement(c: Cursor, out: Command[]): void {
  const t = word(c);
  const w = t.text;
  if (w === 'table') {
    const tg = target(c, false);
    if (!c.eat('{')) throw new NftSyntaxError('Error: syntax error, expecting {', c.peek());
    tableBlock(c, tg, out);
  } else if (w === 'include') {
    const p = c.next();
    if (!p || p.kind !== 'string') throw new NftSyntaxError('Error: syntax error, expecting string', p);
    out.push({ op: 'include', path: p.text, at: p });
  } else if (w === 'list') listOp(c, out);
  else if (['add', 'create', 'insert', 'replace', 'delete', 'destroy', 'flush'].includes(w)) objectOp(c, w, out);
  else throw new NftSyntaxError(`Error: syntax error, unexpected ${w}`, t);
}

/** Replaces `$NAME` tokens with the tokens of its definition (definitions must come first). */
function expand(tokens: readonly Token[]): Token[] {
  const vars = new Map<string, Token[]>();
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.text === 'define' && tokens[i + 2]?.text === '=') {
      const end = tokens.findIndex((x, j) => j > i && (x.kind === 'newline' || x.text === ';'));
      const stop = end < 0 ? tokens.length : end;
      if (vars.size >= MAX_DEFINES) throw new NftSyntaxError('Error: too many definitions', t);
      vars.set(tokens[i + 1]?.text ?? '', expand(tokens.slice(i + 3, stop)).map((x) => ({ ...x, col: t.col, line: t.line })));
      i = stop;
      continue;
    }
    if (t.kind === 'word' && t.text.startsWith('$')) {
      const v = vars.get(t.text.slice(1));
      if (!v) throw new NftSyntaxError(`Error: unknown identifier '${t.text.slice(1)}'`, t);
      out.push(...v.map((x) => ({ ...x, col: t.col, line: t.line })));
    } else out.push(t);
  }
  return out;
}

/** Parses nft source (one command line or a whole file). */
export function parseNft(src: string): ParseResult {
  const lexed = lex(src);
  if (!lexed.ok) return lexed;
  try {
    const c = new Cursor(expand(lexed.tokens));
    const out: Command[] = [];
    separators(c);
    while (c.peek()) {
      statement(c, out);
      if (c.peek() && c.peek()?.kind !== 'newline' && c.peek()?.text !== ';') throw new NftSyntaxError(`Error: syntax error, unexpected ${c.peek()?.text}`, c.peek());
      separators(c);
    }
    return { ok: true, commands: out };
  } catch (e) {
    if (!(e instanceof NftSyntaxError)) throw e;
    const t = e.token;
    return { ok: false, error: e.message, line: t?.line ?? 1, col: t?.col ?? src.length, len: t ? Math.max(1, t.text.length + (t.kind === 'string' ? 2 : 0)) : 1 };
  }
}
