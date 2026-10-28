/** Parameter expansion ${…}: every operator of bash 5.3 except nested arithmetic in subscripts (delegated). */
import type { Value, Vars } from './vars.ts';
import { arrayKeys, arrayValues, scalarOf } from './vars.ts';
import { matchPattern, trimPattern, replacePattern } from './glob.ts';
import { decodeAnsi } from './wordparse.ts';

export class ExpansionError extends Error {
  /** ${x:?}, ${x?} and set -u: a non-interactive shell exits; other errors discard the line. */
  readonly exits: boolean;
  constructor(message: string, exits = false) {
    super(message);
    this.exits = exits;
  }
}

export interface ParamApi {
  readonly vars: Vars;
  /** $? $# $@ $* $- $$ $! $0 $1… and dynamic variables; undefined when not special. */
  special(name: string): string | readonly string[] | undefined;
  positional(): readonly string[];
  arith(expr: string): bigint;
  /** Expands the word of ${x:-word} (tilde, parameters, substitutions, quote removal). */
  operand(raw: string): string;
  /** Pattern text with quoted characters escaped with backslashes. */
  pattern(raw: string): string;
  promptExpand(s: string): string;
  readonly nounset: boolean;
  readonly patsubReplacement: boolean;
}

export interface ParamResult {
  readonly values: readonly string[];
  /** "$@"-like: each value is a separate field even inside double quotes. */
  readonly multi: boolean;
  /** `*`-form: when quoted, join with the first IFS character. */
  readonly star: boolean;
}

interface Target {
  readonly name: string;
  readonly sub?: string;
  readonly text: string;
}

const SPECIALS = new Set(['@', '*', '#', '?', '-', '$', '!', '0']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

function parseTarget(body: string): { target: Target; rest: string } | null {
  if (/^[0-9]+/.test(body)) {
    const m = /^[0-9]+/.exec(body)?.[0] ?? '';
    return { target: { name: m, text: m }, rest: body.slice(m.length) };
  }
  if (SPECIALS.has(body[0] ?? '')) return { target: { name: body[0] ?? '', text: body[0] ?? '' }, rest: body.slice(1) };
  const id = IDENT.exec(body)?.[0];
  if (!id) return null;
  let rest = body.slice(id.length);
  if (!rest.startsWith('[')) return { target: { name: id, text: id }, rest };
  let depth = 0;
  let j = 0;
  for (; j < rest.length; j++) {
    if (rest[j] === '[') depth++;
    else if (rest[j] === ']' && --depth === 0) break;
  }
  if (j >= rest.length) return null;
  const sub = rest.slice(1, j);
  rest = rest.slice(j + 1);
  return { target: { name: id, sub, text: `${id}[${sub}]` }, rest };
}

export function quoteForReuse(s: string): string {
  if (s === '') return "''";
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function bad(body: string): never {
  throw new ExpansionError(`\${${body}}: bad substitution`);
}

export class ParamExpander {
  private readonly api: ParamApi;

  constructor(api: ParamApi) {
    this.api = api;
  }

  expand(body: string): ParamResult {
    if (body === '#') return single(String(this.api.positional().length));
    if (body.startsWith('#') && body.length > 1) return this.length(body);
    if (body.startsWith('!') && body.length > 1) return this.indirect(body);
    const parsed = parseTarget(body);
    if (!parsed) bad(body);
    return this.withOperator(parsed.target, parsed.rest, body);
  }

  // ------------------------------------------------------------ lookups

  /** Raw values of a target and whether it is an "@"/"*" multi-value reference. */
  private lookup(t: Target): { values: string[] | undefined; multi: boolean; star: boolean } {
    if (t.sub === '@' || t.sub === '*') {
      const v = this.api.vars.get(t.name)?.value;
      return { values: v ? arrayValues(v) : undefined, multi: true, star: t.sub === '*' };
    }
    const sp = this.api.special(t.name);
    if (sp !== undefined && t.sub === undefined) {
      if (typeof sp === 'string') return { values: [sp], multi: false, star: false };
      return { values: [...sp], multi: true, star: t.name === '*' };
    }
    if (/^[0-9]+$/.test(t.name)) {
      const p = this.api.positional()[Number(t.name) - 1];
      return { values: p === undefined ? undefined : [p], multi: false, star: false };
    }
    const v = this.api.vars.get(t.name)?.value;
    const one = t.sub === undefined ? scalarOf(v) : this.element(v, t);
    return { values: one === undefined ? undefined : [one], multi: false, star: false };
  }

  element(v: Value | undefined, t: Target): string | undefined {
    if (!v) return undefined;
    if (v.t === 'assoc') return v.v.get(this.api.operand(t.sub ?? ''));
    let i = Number(this.api.arith(t.sub ?? '0'));
    if (v.t === 'str') return i === 0 || i === -1 ? v.v : undefined;
    if (i < 0) i = Math.max(-1, ...v.v.keys()) + 1 + i;
    return v.v.get(i);
  }

  private require(t: Target, values: string[] | undefined): string[] {
    if (values === undefined && this.api.nounset && !['@', '*'].includes(t.name) && t.sub !== '@' && t.sub !== '*') throw new ExpansionError(`${t.text}: unbound variable`, true);
    return values ?? [];
  }

  // ------------------------------------------------------------ ${#…} ${!…}

  private length(body: string): ParamResult {
    const parsed = parseTarget(body.slice(1));
    if (!parsed || parsed.rest !== '') bad(body);
    const t = parsed.target;
    const r = this.lookup(t);
    const values = this.require(t, r.values);
    if (r.multi) return single(String(values.length));
    return single(String(Array.from(values[0] ?? '').length));
  }

  private indirect(body: string): ParamResult {
    const inner = body.slice(1);
    const keys = /^([A-Za-z_][A-Za-z0-9_]*)\[([@*])\]$/.exec(inner);
    if (keys) return { values: arrayKeys(this.api.vars.get(keys[1] ?? '')?.value), multi: true, star: keys[2] === '*' };
    const prefix = /^([A-Za-z_][A-Za-z0-9_]*)([@*])$/.exec(inner);
    if (prefix) {
      const names = this.api.vars.visible().map(([k]) => k).filter((k) => k.startsWith(prefix[1] ?? ''));
      return { values: names, multi: true, star: prefix[2] === '*' };
    }
    const parsed = parseTarget(inner);
    if (!parsed) bad(body);
    const own = this.api.vars.get(parsed.target.name);
    if (own?.attrs.has('n') && parsed.rest === '' && !parsed.target.sub) return single(scalarOf(this.api.vars.get(parsed.target.name)?.value) === undefined ? '' : this.api.vars.resolveName(parsed.target.name));
    const ref = this.lookup(parsed.target).values?.[0];
    if (ref === undefined || ref === '') {
      if (parsed.rest === '') throw new ExpansionError(`${parsed.target.text}: invalid indirect expansion`);
      return this.withOperator({ name: '', text: '' }, parsed.rest, body);
    }
    const target = parseTarget(ref);
    if (!target || target.rest !== '') throw new ExpansionError(`${ref}: invalid variable name`);
    return this.withOperator(target.target, parsed.rest, body);
  }

  // ------------------------------------------------------------ operators

  private withOperator(t: Target, op: string, body: string): ParamResult {
    const r = this.lookup(t);
    const make = (values: readonly string[]): ParamResult => ({ values, multi: r.multi, star: r.star });
    if (op === '') return make(this.require(t, r.values));
    const dflt = /^(:?)([-=?+])([\s\S]*)$/.exec(op);
    if (dflt) return this.defaults(t, r, dflt[1] === ':', dflt[2] ?? '-', dflt[3] ?? '', make);
    const values = this.require(t, r.values);
    if (op.startsWith(':')) return make(this.substring(t, values, r.multi, op.slice(1)));
    if (op.startsWith('#') || op.startsWith('%')) {
      const longest = op[1] === op[0];
      const pat = this.api.pattern(op.slice(longest ? 2 : 1));
      return make(values.map((v) => trimPattern(v, pat, op[0] === '#' ? 'prefix' : 'suffix', longest)));
    }
    if (op.startsWith('/')) return make(this.replace(values, op.slice(1)));
    if (/^[\^,~]/.test(op)) return make(values.map((v) => caseModify(v, op, this.api)));
    if (op.startsWith('@') && op.length === 2) return make(this.transform(t, values, op[1] ?? '', r.multi));
    return bad(body);
  }

  private defaults(t: Target, r: { values: string[] | undefined; multi: boolean }, colon: boolean, kind: string, word: string, make: (v: readonly string[]) => ParamResult): ParamResult {
    const unset = r.values === undefined;
    const empty = unset || r.values?.length === 0 || (colon && r.values?.every((v) => v === '') === true);
    const missing = colon ? empty : unset;
    if (kind === '+') return missing ? single('') : single(this.api.operand(word));
    if (!missing) return make(r.values ?? []);
    if (kind === '-') return single(this.api.operand(word));
    if (kind === '=') {
      if (/^[0-9@*#?$!-]/.test(t.name) || !t.name) throw new ExpansionError(`$${t.name}: cannot assign in this way`);
      const value = this.api.operand(word);
      if (t.sub !== undefined) this.api.vars.setElement(t.name, t.sub, value);
      else this.api.vars.set(t.name, value);
      return single(value);
    }
    const msg = word ? this.api.operand(word) : colon ? 'parameter null or not set' : 'parameter not set';
    throw new ExpansionError(`${t.text}: ${msg}`, true);
  }

  private substring(t: Target, values: readonly string[], multi: boolean, spec: string): string[] {
    const [offText, lenText] = splitTopColon(spec);
    const off = Number(this.api.arith(offText));
    const len = lenText === undefined ? undefined : Number(this.api.arith(lenText));
    if (multi) {
      const isPositional = t.name === '@' || t.name === '*';
      const list = isPositional ? [this.api.special('0') as string, ...values] : values;
      const start = off < 0 ? Math.max(0, list.length + off) : off;
      if (len !== undefined && len < 0) throw new ExpansionError(`${lenText}: substring expression < 0`);
      return list.slice(start, len === undefined ? undefined : start + len);
    }
    const chars = Array.from(values[0] ?? '');
    const start = off < 0 ? Math.max(0, chars.length + off) : Math.min(off, chars.length);
    if (off < 0 && chars.length + off < 0) return [''];
    let end = chars.length;
    if (len !== undefined) {
      end = len < 0 ? chars.length + len : start + len;
      if (end < start) throw new ExpansionError(`${lenText}: substring expression < 0`);
    }
    return [chars.slice(start, end).join('')];
  }

  private replace(values: readonly string[], spec: string): string[] {
    const mode = spec.startsWith('/') ? 'all' : spec.startsWith('#') ? 'start' : spec.startsWith('%') ? 'end' : 'first';
    const body = mode === 'first' ? spec : spec.slice(1);
    const slash = topSlash(body);
    const pat = this.api.pattern(slash < 0 ? body : body.slice(0, slash));
    const rawRep = slash < 0 ? '' : body.slice(slash + 1);
    return values.map((v) => {
      const rep = this.api.operand(rawRep);
      if (!this.api.patsubReplacement || !/(?<!\\)&/.test(rawRep)) return replacePattern(v, pat, rep.replace(/\\&/g, '&'), mode);
      return replaceWithMatch(v, pat, rawRep, mode, (s) => this.api.operand(s));
    });
  }

  private transform(t: Target, values: readonly string[], op: string, multi: boolean): string[] {
    const v = this.api.vars.get(t.name);
    switch (op) {
      case 'Q': return values.map(quoteForReuse);
      case 'E': return values.map(decodeAnsi);
      case 'P': return values.map((s) => this.api.promptExpand(s));
      case 'U': return values.map((s) => s.toUpperCase());
      case 'u': return values.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
      case 'L': return values.map((s) => s.toLowerCase());
      case 'a': return values.map(() => attrString(v?.attrs, v?.value));
      case 'A': return multi ? [declareLine(t.name, v?.attrs, v?.value, multi)] : [elementAssignment(t.name, attrString(v?.attrs, v?.value), values[0])];
      case 'K': case 'k': return multi ? keyValues(v?.value, op === 'k') : values.map(quoteForReuse);
      default: throw new ExpansionError(`\${${t.text}@${op}}: bad substitution`);
    }
  }
}

function single(v: string): ParamResult {
  return { values: [v], multi: false, star: false };
}

function splitTopColon(spec: string): [string, string | undefined] {
  let depth = 0;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '?') depth++;
    else if (c === ':' && depth > 0) depth--;
    else if (c === ':' && depth === 0) return [spec.slice(0, i), spec.slice(i + 1)];
  }
  return [spec, undefined];
}

function topSlash(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === "'") i = s.indexOf("'", i + 1) < 0 ? s.length : s.indexOf("'", i + 1);
    else if (s[i] === '/') return i;
  }
  return -1;
}

/** bash 5.2+ patsub_replacement: an unquoted & in the replacement stands for the matched text. */
function replaceWithMatch(v: string, pat: string, rawRep: string, mode: 'first' | 'all' | 'start' | 'end', operand: (s: string) => string): string {
  const marker = '\uE000MATCH\uE001';
  const template = operand(rawRep.replace(/(?<!\\)&/g, marker)).replace(/\\&/g, '&');
  const chars = Array.from(v);
  let out = '';
  let i = 0;
  let done = false;
  while (i <= chars.length) {
    let len = -1;
    if (!done && (mode !== 'start' || i === 0)) {
      for (let l = chars.length - i; l >= 1; l--) {
        if (mode === 'end' && i + l !== chars.length) continue;
        if (matchPattern(pat, chars.slice(i, i + l).join(''))) { len = l; break; }
      }
    }
    if (len > 0) {
      out += template.split(marker).join(chars.slice(i, i + len).join(''));
      i += len;
      if (mode !== 'all') done = true;
      continue;
    }
    if (i < chars.length) out += chars[i];
    i++;
  }
  return out;
}

function caseModify(v: string, op: string, api: ParamApi): string {
  const double = op[1] === op[0];
  const pat = api.pattern(op.slice(double ? 2 : 1)) || '?';
  const chars = Array.from(v);
  const conv = (c: string): string => (op[0] === '^' ? c.toUpperCase() : op[0] === ',' ? c.toLowerCase() : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());
  return chars.map((c, i) => ((double || i === 0) && matchPattern(pat, c) ? conv(c) : c)).join('');
}

const ATTR_ORDER = ['a', 'A', 'i', 'l', 'n', 'r', 't', 'u', 'x'] as const;

export function attrString(attrs: ReadonlySet<string> | undefined, value?: Value): string {
  const set = new Set(attrs ?? []);
  if (value?.t === 'arr') set.add('a');
  if (value?.t === 'assoc') set.add('A');
  return ATTR_ORDER.filter((a) => set.has(a)).join('');
}

/** A key of an associative array as declare -p writes it: in double quotes when it has shell metacharacters. */
const subscript = (k: string): string => (/[\s'"\\|&;()<>!{}*[\]?^$`]|^[~#]/.test(k) ? dq(k) : k);

function arrayLiteral(value: Value): string {
  const keys = arrayKeys(value);
  const vals = arrayValues(value);
  const key = (k: string): string => (value.t === 'assoc' ? subscript(k) : k);
  return `(${keys.map((k, i) => `[${key(k)}]=${dq(vals[i] ?? '')}`).join(' ')}${keys.length && value.t === 'assoc' ? ' ' : ''})`;
}

function dq(s: string): string {
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** `declare -x NAME="value"` as printed by declare -p and ${x@A}. */
export function declareLine(name: string, attrs: ReadonlySet<string> | undefined, value: Value | undefined, multi = false): string {
  const flags = attrString(attrs, value) || '-';
  if (!value) return `declare -${flags.replace(/^-$/, '-')} ${name}`.replace('declare --- ', 'declare -- ');
  if (value.t === 'str' && !multi) return `declare -${flags === '-' ? '-' : flags} ${name}=${dq(value.v)}`.replace('declare --- ', 'declare -- ');
  return `declare -${flags} ${name}=${value.t === 'str' ? dq(value.v) : arrayLiteral(value)}`;
}

/** ${v@A} without [@]: an assignment for one element (`v='x'`, `declare -i n='7'`, `declare -A b` when unset). */
function elementAssignment(name: string, flags: string, value: string | undefined): string {
  if (value === undefined) return flags ? `declare -${flags} ${name}` : '';
  return flags ? `declare -${flags} ${name}=${quoteForReuse(value)}` : `${name}=${quoteForReuse(value)}`;
}

function keyValues(value: Value | undefined, separate: boolean): string[] {
  if (!value) return [];
  const keys = arrayKeys(value);
  const vals = arrayValues(value);
  if (separate) return keys.flatMap((k, i) => [k, vals[i] ?? '']);
  return [keys.map((k, i) => `${k} ${dq(vals[i] ?? '')}`).join(' ')];
}
