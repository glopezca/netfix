/**
 * IOS-style command grammar: syntax strings are expanded into variants and merged into a
 * trie that supports keyword abbreviation, typed parameters, `?` help and Tab completion.
 *
 * Syntax DSL:  keyword  <TYPE:name>  [optional]  {alt-a | alt-b}  <TYPE...:name> (1-8 repeats)
 * TYPE: A.B.C.D, MASK, WORD, LINE, H.H.H, HEX, HWTYPE, IFACE, n-m (integer range)
 */
import { parseIp, parseMask } from '../core/ip.ts';
import { parseMac, parseHexId } from '../core/mac.ts';

export type HelpMap = Readonly<Record<string, string>>;

export interface CommandDef<C> {
  readonly syntax: string;
  readonly help?: HelpMap;
  readonly run: (ctx: C, m: Match) => void;
  readonly noRun?: (ctx: C, m: Match) => void;
  /** Hidden commands are accepted but not listed by `?`. */
  readonly hidden?: boolean;
}

export interface Spec {
  readonly kind: 'kw' | 'param';
  readonly text: string;
  readonly name: string;
  readonly repeat: boolean;
  readonly min?: number;
  readonly max?: number;
}

interface Terminal<C> {
  readonly def: CommandDef<C>;
  readonly specs: readonly Spec[];
}

interface Edge<C> {
  readonly spec: Spec;
  readonly help: string;
  readonly hidden: boolean;
  readonly node: TrieNode<C>;
}

export interface TrieNode<C> {
  readonly edges: Edge<C>[];
  terminal: Terminal<C> | null;
}

export interface Token {
  readonly text: string;
  readonly start: number;
}

export class Match {
  private readonly values: ReadonlyMap<string, readonly string[]>;
  private readonly keywords: ReadonlySet<string>;

  constructor(values: ReadonlyMap<string, readonly string[]>, keywords: ReadonlySet<string>) {
    this.values = values;
    this.keywords = keywords;
  }
  get(name: string): string | undefined {
    return this.values.get(name)?.[0];
  }
  all(name: string): readonly string[] {
    return this.values.get(name) ?? [];
  }
  has(keyword: string): boolean {
    return this.keywords.has(keyword);
  }
}

export type MatchResult<C> =
  | { kind: 'ok'; def: CommandDef<C>; match: Match }
  | { kind: 'invalid'; position: number }
  | { kind: 'ambiguous' }
  | { kind: 'incomplete' }
  | { kind: 'empty' };

const MAX_REPEAT = 8;
const HW_TYPES = ['ethernet', 'ieee802'];
const MAX_HW_TYPE = 255;

const DEFAULT_PARAM_HELP: HelpMap = {
  'A.B.C.D': 'IP address',
  MASK: 'Network mask or prefix length',
  WORD: 'WORD',
  LINE: 'LINE',
  'H.H.H': 'MAC address',
  HEX: 'Hex string',
  HWTYPE: 'Hardware type',
  IFACE: 'Interface name',
};

const PARAM_DISPLAY: HelpMap = {
  MASK: '/nn or A.B.C.D',
  HEX: 'H.H.H',
  HWTYPE: '<0-255>',
};

// ---------------------------------------------------------------- syntax expansion

type Element = { type: 'tok'; text: string } | { type: 'opt'; body: Element[] } | { type: 'alt'; options: Element[][] };

function lexSyntax(syntax: string): string[] {
  return syntax.replace(/([[\]{}|])/g, ' $1 ').trim().split(/\s+/);
}

function parseSeq(tokens: string[], pos: { i: number }, stops: ReadonlySet<string>): Element[] {
  const seq: Element[] = [];
  while (pos.i < tokens.length && !stops.has(tokens[pos.i] ?? '')) {
    const tok = tokens[pos.i++] ?? '';
    if (tok === '[') {
      seq.push({ type: 'opt', body: parseSeq(tokens, pos, new Set([']'])) });
      pos.i++;
    } else if (tok === '{') {
      const options: Element[][] = [];
      do {
        options.push(parseSeq(tokens, pos, new Set(['|', '}'])));
      } while (tokens[pos.i++] === '|');
      seq.push({ type: 'alt', options });
    } else {
      seq.push({ type: 'tok', text: tok });
    }
  }
  return seq;
}

function expandElements(elements: readonly Element[]): string[][] {
  let results: string[][] = [[]];
  for (const el of elements) {
    let tails: string[][];
    if (el.type === 'tok') tails = expandToken(el.text);
    else if (el.type === 'opt') tails = [[], ...expandElements(el.body)];
    else tails = el.options.flatMap((opt) => expandElements(opt));
    results = results.flatMap((head) => tails.map((tail) => [...head, ...tail]));
  }
  return results;
}

function expandToken(text: string): string[][] {
  if (!text.includes('...')) return [[text]];
  return Array.from({ length: MAX_REPEAT }, (_, n) => Array.from({ length: n + 1 }, () => text));
}

export function expandSyntax(syntax: string): string[][] {
  return expandElements(parseSeq(lexSyntax(syntax), { i: 0 }, new Set()));
}

function toSpec(token: string): Spec {
  const param = /^<([^:>]+?)(\.\.\.)?:([^>]+)>$/.exec(token);
  if (!param) return { kind: 'kw', text: token.toLowerCase(), name: token.toLowerCase(), repeat: false };
  const type = param[1] ?? 'WORD';
  const range = /^(\d+)-(\d+)$/.exec(type);
  const base = { kind: 'param' as const, text: type, name: param[3] ?? type, repeat: Boolean(param[2]) };
  return range ? { ...base, min: Number(range[1]), max: Number(range[2]) } : base;
}

// ---------------------------------------------------------------- trie construction

function sameSpec(a: Spec, b: Spec): boolean {
  return a.kind === b.kind && a.text === b.text;
}

function newNode<C>(): TrieNode<C> {
  return { edges: [], terminal: null };
}

function specHelp(spec: Spec, help: HelpMap): string {
  if (spec.kind === 'kw') return help[spec.text] ?? '';
  return help[spec.name] ?? DEFAULT_PARAM_HELP[spec.text] ?? '';
}

function insert<C>(root: TrieNode<C>, specs: readonly Spec[], def: CommandDef<C>, help: HelpMap): void {
  let node = root;
  for (const spec of specs) {
    let edge = node.edges.find((e) => sameSpec(e.spec, spec));
    if (!edge) {
      edge = { spec, help: specHelp(spec, help), hidden: Boolean(def.hidden), node: newNode<C>() };
      node.edges.push(edge);
    }
    node = edge.node;
  }
  node.terminal = { def, specs };
}

/** `no` forms accept the keyword prefix and any longer prefix of the full syntax. */
function noVariants(variants: readonly Spec[][]): Spec[][] {
  const out: Spec[][] = [];
  for (const v of variants) {
    const firstParam = v.findIndex((s) => s.kind === 'param');
    const start = firstParam === -1 ? v.length : Math.max(firstParam, 1);
    for (let len = start; len <= v.length; len++) out.push(v.slice(0, len));
  }
  return out;
}

export function buildTrie<C>(defs: readonly CommandDef<C>[], help: HelpMap, noForm = false): TrieNode<C> {
  const root = newNode<C>();
  for (const def of defs) {
    if (noForm && !def.noRun) continue;
    const merged = { ...help, ...def.help };
    const variants = expandSyntax(def.syntax).map((v) => v.map(toSpec));
    const all = noForm ? noVariants(variants) : variants;
    for (const specs of all) insert(root, specs, def, merged);
  }
  return root;
}

// ---------------------------------------------------------------- matching

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) tokens.push({ text: m[0], start: m.index });
  return tokens;
}

function paramAccepts(spec: Spec, text: string): boolean {
  switch (spec.text) {
    case 'A.B.C.D': return parseIp(text) !== null;
    case 'MASK': return parseMask(text) !== null;
    case 'H.H.H': return parseMac(text) !== null;
    case 'HEX': return parseHexId(text) !== null;
    case 'HWTYPE': return acceptsHwType(text);
    case 'IFACE': return /^[a-z]+[\d/.:]*$/i.test(text);
    case 'WORD': case 'LINE': return true;
    default: return acceptsRange(spec, text);
  }
}

function acceptsHwType(text: string): boolean {
  const lower = text.toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) <= MAX_HW_TYPE;
  return HW_TYPES.some((t) => t.startsWith(lower));
}

function acceptsRange(spec: Spec, text: string): boolean {
  if (spec.min === undefined || spec.max === undefined || !/^\d+$/.test(text)) return false;
  const n = Number(text);
  return n >= spec.min && n <= spec.max;
}

type Step<C> = { edge: Edge<C> } | { error: 'invalid' | 'ambiguous' };

function stepToken<C>(node: TrieNode<C>, text: string, includeHidden = true): Step<C> {
  const lower = text.toLowerCase();
  const edges = includeHidden ? node.edges : node.edges.filter((e) => !e.hidden);
  const kws = edges.filter((e) => e.spec.kind === 'kw' && e.spec.text.startsWith(lower));
  const exact = kws.find((e) => e.spec.text === lower);
  if (exact) return { edge: exact };
  if (kws.length === 1 && kws[0]) return { edge: kws[0] };
  const param = edges.find((e) => e.spec.kind === 'param' && paramAccepts(e.spec, text));
  if (param) return { edge: param };
  return { error: kws.length > 1 ? 'ambiguous' : 'invalid' };
}

interface Walk<C> {
  readonly node: TrieNode<C>;
  readonly path: readonly { spec: Spec; value: string }[];
}

type WalkResult<C> = { ok: Walk<C> } | { error: 'invalid' | 'ambiguous'; position: number };

function walk<C>(root: TrieNode<C>, line: string, tokens: readonly Token[]): WalkResult<C> {
  let node = root;
  const path: { spec: Spec; value: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) break;
    const step = stepToken(node, tok.text);
    if ('error' in step) return { error: step.error, position: tok.start };
    const { spec } = step.edge;
    if (spec.text === 'LINE') {
      path.push({ spec, value: line.slice(tok.start).trimEnd() });
      return { ok: { node: step.edge.node, path } };
    }
    path.push({ spec, value: spec.kind === 'kw' ? spec.text : tok.text });
    node = step.edge.node;
  }
  return { ok: { node, path } };
}

function buildMatch(terminal: Terminal<unknown>, path: readonly { spec: Spec; value: string }[]): Match {
  const values = new Map<string, string[]>();
  const keywords = new Set<string>();
  path.forEach((step, i) => {
    const spec = terminal.specs[i] ?? step.spec;
    if (spec.kind === 'kw') {
      keywords.add(spec.text);
      return;
    }
    values.set(spec.name, [...(values.get(spec.name) ?? []), step.value]);
  });
  return new Match(values, keywords);
}

export function matchLine<C>(root: TrieNode<C>, line: string, _strict: boolean): MatchResult<C> {
  const tokens = tokenize(line);
  if (tokens.length === 0) return { kind: 'empty' };
  const result = walk(root, line, tokens);
  if ('error' in result) {
    return result.error === 'ambiguous' ? { kind: 'ambiguous' } : { kind: 'invalid', position: result.position };
  }
  const terminal = result.ok.node.terminal;
  if (!terminal) return { kind: 'incomplete' };
  return { kind: 'ok', def: terminal.def, match: buildMatch(terminal as Terminal<unknown>, result.ok.path) };
}

// ---------------------------------------------------------------- help & completion

function edgeLabel(spec: Spec): string {
  if (spec.kind === 'kw') return spec.text;
  if (spec.min !== undefined) return `<${spec.min}-${spec.max}>`;
  return PARAM_DISPLAY[spec.text] ?? spec.text;
}

function formatHelpRows(rows: readonly [string, string][]): string[] {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, help]) => `  ${label.padEnd(width)}  ${help}`.trimEnd());
}

/** Output for a line ending in `?`. `line` is the text before the `?`. */
export function helpFor<C>(root: TrieNode<C>, line: string): string[] {
  const tokens = tokenize(line);
  const partial = line.length > 0 && !/\s$/.test(line) ? tokens.pop() : undefined;
  const result = walk(root, line, tokens);
  if ('error' in result) return ['% Unrecognized command'];
  const { node } = result.ok;
  const visible = node.edges.filter((e) => !e.hidden);
  if (partial) {
    const lower = partial.text.toLowerCase();
    const words = visible.filter((e) => e.spec.kind === 'kw' && e.spec.text.startsWith(lower)).map((e) => e.spec.text).sort();
    return words.length > 0 ? [words.join('  ')] : ['% Unrecognized command'];
  }
  const params = visible.filter((e) => e.spec.kind === 'param');
  const kws = visible.filter((e) => e.spec.kind === 'kw').sort((a, b) => a.spec.text.localeCompare(b.spec.text));
  const rows: [string, string][] = [...params, ...kws].map((e) => [edgeLabel(e.spec), e.help]);
  if (node.terminal) rows.push(['<cr>', '']);
  return rows.length > 0 ? formatHelpRows(rows) : ['% Unrecognized command'];
}

/** Tab completion: returns the completed line or null when the prefix is not unique. */
export function completeToken<C>(root: TrieNode<C>, line: string): string | null {
  const tokens = tokenize(line);
  const last = tokens.pop();
  if (!last || /\s$/.test(line)) return null;
  const result = walk(root, line, tokens);
  if ('error' in result) return null;
  const lower = last.text.toLowerCase();
  const kws = result.ok.node.edges.filter((e) => e.spec.kind === 'kw' && !e.hidden && e.spec.text.startsWith(lower));
  const exact = kws.find((e) => e.spec.text === lower);
  const pick = exact ?? (kws.length === 1 ? kws[0] : undefined);
  return pick ? `${line.slice(0, last.start)}${pick.spec.text} ` : null;
}

/** Expands abbreviated keywords of a valid line to their full names (used by `show run`). */
export function canonicalKeyword<C>(root: TrieNode<C>, word: string): string | null {
  const step = stepToken(root, word, false);
  return 'edge' in step && step.edge.spec.kind === 'kw' ? step.edge.spec.text : null;
}
