/**
 * cmd.exe's input and output, without running anything: | pipes, < input, the filters at a pipe's end (find, findstr,
 * sort, more) with their exit codes, and for /f's options and tokens.
 */
import { batchArgs, closingParen } from './win-cmd-parse.ts';

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

/** Splits a command at single | outside quotes and parentheses (|| is a chain, split before this). */
export function splitPipe(text: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '^') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === '|' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

/** `< file` outside quotes: the command without it and the file (null: none). */
export function takeInput(text: string): { text: string; path: string | null } {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '^') i++;
    else if (ch === '<') {
      const m = /^\s*("[^"]*"|[^\s"]+)/.exec(text.slice(i + 1));
      if (!m) return { text, path: null };
      return { text: text.slice(0, i) + text.slice(i + 1 + m[0].length), path: unquote(m[1] ?? '') };
    }
  }
  return { text, path: null };
}

// ------------------------------------------------------------ filters

export interface Filtered {
  readonly out: string[];
  /** The errorlevel it leaves: 0 found, 1 nothing found, 2 a usage error (as find and findstr). */
  readonly code: number;
}

/** A file a filter names: its lines, or null when it cannot be read. */
export type ReadLines = (name: string) => string[] | null;

export const FILTERS: ReadonlySet<string> = new Set(['find', 'findstr', 'sort', 'more']);

/** find, findstr, sort or more, reading `input` (a pipe or <) or the files it names; null for any other command. */
export function runFilter(name: string, argText: string, input: readonly string[] | null, read: ReadLines): Filtered | null {
  const args = batchArgs(argText);
  switch (name) {
    case 'find': return find(args, input, read);
    case 'findstr': return findstr(args, input, read);
    case 'sort': return sortLines(args, input, read);
    case 'more': return passOn(args, input, read);
    default: return null;
  }
}

function flags(args: readonly string[]): { on: Set<string>; literal: string | undefined; rest: string[] } {
  const on = new Set<string>();
  let literal: string | undefined;
  const rest: string[] = [];
  for (const a of args) {
    if (/^\/c:/i.test(a)) literal = unquote(a.slice(3));
    else if (/^\/[a-z]+$/i.test(a)) for (const c of a.slice(1).toLowerCase()) on.add(c);
    else rest.push(a);
  }
  return { on, literal, rest };
}

function find(args: readonly string[], input: readonly string[] | null, read: ReadLines): Filtered {
  const { on, rest } = flags(args);
  const [needle, ...files] = rest;
  if (!needle || needle.length < 2 || !needle.startsWith('"') || !needle.endsWith('"')) return { out: ['FIND: Parameter format not correct'], code: 2 };
  const s = on.has('i') ? unquote(needle).toLowerCase() : unquote(needle);
  const hit = (l: string): boolean => (on.has('i') ? l.toLowerCase() : l).includes(s) !== on.has('v');
  const pick = (lines: readonly string[]): string[] => lines.flatMap((l, i) => (hit(l) ? [on.has('n') ? `[${i + 1}]${l}` : l] : []));
  if (!files.length) {
    const found = pick(input ?? []);
    return { out: on.has('c') ? [String(found.length)] : found, code: found.length ? 0 : 1 };
  }
  const out: string[] = [];
  let any = false;
  for (const f of files) {
    const name = unquote(f).toUpperCase();
    const lines = read(unquote(f));
    if (lines === null) { out.push(`File not found - ${name}`); continue; }
    const found = pick(lines);
    any ||= found.length > 0;
    out.push(...(on.has('c') ? ['', `---------- ${name}: ${found.length}`] : ['', `---------- ${name}`, ...found]));
  }
  return { out, code: any ? 0 : 1 };
}

/** A findstr regular expression (. * ^ $ [class] and \x) as a JavaScript one; anything else is literal. */
function findstrRegex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? '';
    const end = ch === '[' ? s.indexOf(']', i + 1) : -1;
    if (ch === '\\' && i + 1 < s.length) out += escapeRe(s[++i] ?? '');
    else if (end > i) { out += `[${s.slice(i + 1, end).replace(/[\\\]]/g, '\\$&')}]`; i = end; }
    // A * with nothing before it to repeat is a plain *, as findstr reads it.
    else if (ch === '*' && /(^|\^|\*)$/.test(out)) out += '\\*';
    else if (ch === '.' || ch === '*' || (ch === '^' && i === 0) || (ch === '$' && i === s.length - 1)) out += ch;
    else out += escapeRe(ch);
  }
  return out;
}

function findstr(args: readonly string[], input: readonly string[] | null, read: ReadLines): Filtered {
  const { on, literal, rest } = flags(args);
  const words = literal !== undefined ? [literal] : unquote(rest.shift() ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return { out: ['FINDSTR: Bad command line'], code: 2 };
  const regex = on.has('r') || (!on.has('l') && literal === undefined);
  let res: RegExp[];
  try {
    res = words.map((w) => {
      const body = regex ? findstrRegex(w) : escapeRe(w);
      return new RegExp(on.has('x') ? `^(?:${body})$` : on.has('b') ? `^(?:${body})` : on.has('e') ? `(?:${body})$` : body, on.has('i') ? 'i' : '');
    });
  } catch {
    return { out: ['FINDSTR: Bad command line'], code: 2 }; // e.g. a class like [z-a]
  }
  const pick = (lines: readonly string[], prefix: string): string[] =>
    lines.flatMap((l, i) => (res.some((re) => re.test(l)) !== on.has('v') ? [`${prefix}${on.has('n') ? `${i + 1}:` : ''}${l}`] : []));
  if (!rest.length) {
    const found = pick(input ?? [], '');
    return { out: found, code: found.length ? 0 : 1 };
  }
  const out: string[] = [];
  let any = false;
  for (const f of rest) {
    const lines = read(unquote(f));
    if (lines === null) { out.push(`FINDSTR: Cannot open ${unquote(f)}`); continue; }
    const found = pick(lines, rest.length > 1 ? `${unquote(f)}:` : '');
    any ||= found.length > 0;
    out.push(...found);
  }
  return { out, code: any ? 0 : 1 };
}

/** The lines of the file named, else the input; or the error sort and more give. */
function source(rest: readonly string[], input: readonly string[] | null, read: ReadLines): string[] | Filtered {
  const [f] = rest;
  if (f === undefined) return [...(input ?? [])];
  return read(unquote(f)) ?? { out: ['The system cannot find the file specified.'], code: 1 };
}

function sortLines(args: readonly string[], input: readonly string[] | null, read: ReadLines): Filtered {
  const { on, rest } = flags(args);
  const lines = source(rest, input, read);
  if (!Array.isArray(lines)) return lines;
  const key = (s: string): string => s.toLowerCase();
  const sorted = lines.map((l, i) => [l, i] as const).sort(([a, i], [b, j]) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : i - j)).map(([l]) => l);
  return { out: on.has('r') ? sorted.reverse() : sorted, code: 0 };
}

/** more: the whole text at once (the terminal scrolls; there is no -- More -- page). */
function passOn(args: readonly string[], input: readonly string[] | null, read: ReadLines): Filtered {
  const lines = source(flags(args).rest, input, read);
  return Array.isArray(lines) ? { out: lines, code: 0 } : lines;
}

// ------------------------------------------------------------ for /f

export interface ForF {
  /** The token numbers wanted (1-based, sorted) and whether * takes the rest of the line after the last. */
  readonly tokens: readonly number[];
  readonly star: boolean;
  readonly delims: string;
  readonly skip: number;
  readonly eol: string;
  readonly usebackq: boolean;
}

const MAX_TOKEN = 31;

function tokenSpec(spec: string): { tokens: number[]; star: boolean } | null {
  const nums = new Set<number>();
  for (const part of spec.replace(/\*$/, '').split(',').filter(Boolean)) {
    const [a = 0, b = a] = part.split('-').map(Number);
    if (!(a >= 1 && b >= a && b <= MAX_TOKEN)) return null;
    for (let n = a; n <= b; n++) nums.add(n);
  }
  const star = spec.endsWith('*');
  return nums.size || star ? { tokens: [...nums].sort((x, y) => x - y), star } : null;
}

/** The options between quotes after for /f (tokens= delims= skip= eol= usebackq), or cmd's message. */
export function forFOptions(text: string): ForF | string {
  const o = { tokens: [1] as readonly number[], star: false, delims: ' \t', skip: 0, eol: ';', usebackq: false };
  let s = text.trim();
  while (s) {
    let m: RegExpExecArray | null;
    // delims= written last may hold a space (delims=, ;).
    if ((m = /^delims=([^]*)$/i.exec(s)) && !/\s(tokens|skip|eol|usebackq)\b/i.test(m[1] ?? '')) { o.delims = m[1] ?? ''; break; }
    if ((m = /^delims=(\S*)\s*/i.exec(s))) o.delims = m[1] ?? '';
    else if ((m = /^usebackq\s*/i.exec(s))) o.usebackq = true;
    else if ((m = /^skip=(\d+)\s*/i.exec(s))) o.skip = Number(m[1]);
    else if ((m = /^eol=(.)\s*/i.exec(s))) o.eol = m[1] ?? '';
    else if ((m = /^tokens=(\S+)\s*/i.exec(s))) {
      const t = tokenSpec(m[1] ?? '');
      if (!t) return `tokens=${m[1] ?? ''}" was unexpected at this time.`;
      o.tokens = t.tokens;
      o.star = t.star;
    } else return `${s.split(/\s/)[0] ?? s}" was unexpected at this time.`;
    s = s.slice(m[0].length);
  }
  return o;
}

/** for /f ["options"] %v in (source) do body: its parts, or cmd's message. */
export function forFHeader(text: string): { options: ForF; variable: string; source: string; body: string } | string[] {
  const m = /^\/f\s+(?:"([^"]*)"\s+)?%(\w)\s+in\s*\(/is.exec(text);
  const close = m ? closingParen(text, m[0].length - 1) : -1;
  const body = m && close > 0 ? /^\s*do\s+(.+)$/is.exec(text.slice(close + 1))?.[1] : undefined;
  if (!m || !body) return ['The syntax of the command is incorrect.'];
  const options = forFOptions(m[1] ?? '');
  return typeof options === 'string' ? [options] : { options, variable: m[2] ?? 'a', source: text.slice(m[0].length, close).trim(), body };
}

/** The values each line gives the loop's variables (numbered tokens first, then *), lines skipped as cmd does. */
export function forFLines(lines: readonly string[], o: ForF): string[][] {
  const out: string[][] = [];
  let skip = o.skip;
  for (const line of lines) {
    if (skip > 0) { skip--; continue; }
    if (!line || (o.eol && line.startsWith(o.eol))) continue;
    const spans = tokenSpans(line, o.delims);
    if (!spans.length) continue;
    const vals = o.tokens.map((n) => { const sp = spans[n - 1]; return sp ? line.slice(sp[0], sp[1]) : ''; });
    if (o.star) {
      const from = spans[o.tokens.at(-1) ?? 0];
      vals.push(from ? line.slice(from[0]).replace(new RegExp(`[${escapeClass(o.delims)}]+$`), '') : '');
    }
    out.push(vals);
  }
  return out;
}

const escapeClass = (s: string): string => s.replace(/[\\\]^-]/g, '\\$&');

function tokenSpans(line: string, delims: string): [number, number][] {
  if (!delims) return [[0, line.length]];
  const spans: [number, number][] = [];
  const re = new RegExp(`[^${escapeClass(delims)}]+`, 'g');
  for (let m = re.exec(line); m; m = re.exec(line)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
