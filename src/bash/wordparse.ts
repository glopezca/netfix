/** Splits the raw text of a word into literal, quoted and expansion parts. */
import { skipBacktick, skipDollar, skipDouble, skipParen, skipSingle } from './lexer.ts';

export type Part =
  | { readonly t: 'lit'; readonly v: string }
  | { readonly t: 'q'; readonly v: string }
  | { readonly t: 'dq'; readonly parts: readonly Part[] }
  | { readonly t: 'param'; readonly body: string }
  | { readonly t: 'cmd'; readonly src: string; readonly mode: 'sub' | 'cur' | 'val' }
  | { readonly t: 'arith'; readonly expr: string }
  | { readonly t: 'proc'; readonly dir: '<' | '>'; readonly src: string };

const SPECIAL = new Set(['@', '*', '#', '?', '-', '$', '!']);
const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const ANSI: Readonly<Record<string, string>> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/** Decodes the body of $'…'. */
export function decodeAnsi(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (c !== '\\') { out += c; continue; }
    const n = s[i + 1] ?? '';
    const simple = ANSI[n];
    if (simple !== undefined) { out += simple; i++; continue; }
    const m = /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c(.))/.exec(s.slice(i + 1));
    if (!m) { out += c; continue; }
    i += m[0].length;
    if (m[5] !== undefined) out += String.fromCharCode(m[5].toUpperCase().charCodeAt(0) & 0x1f);
    else out += String.fromCodePoint(parseInt(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '0', m[4] !== undefined ? 8 : 16));
  }
  return out;
}

/** Removes the backslashes that protect $ ` \ inside backquotes. */
function unBacktick(s: string): string {
  return s.replace(/\\([$`\\])/g, '$1');
}

function dollarPart(raw: string, i: number): { part: Part; end: number } {
  const n = raw[i + 1] ?? '';
  if (n === '(') {
    const end = skipDollar(raw, i);
    const inner = raw.slice(i + 2, end - 1);
    if (inner.startsWith('(') && inner.endsWith(')')) return { part: { t: 'arith', expr: inner.slice(1, -1) }, end };
    return { part: { t: 'cmd', src: inner, mode: 'sub' }, end };
  }
  if (n === '{') {
    const end = skipDollar(raw, i);
    const body = raw.slice(i + 2, end - 1);
    if (/^[ \t\n]/.test(body)) return { part: { t: 'cmd', src: body, mode: 'cur' }, end };
    if (body.startsWith('|')) return { part: { t: 'cmd', src: body.slice(1), mode: 'val' }, end };
    return { part: { t: 'param', body }, end };
  }
  if (n === "'") {
    const end = skipDollar(raw, i);
    return { part: { t: 'q', v: decodeAnsi(raw.slice(i + 2, end - 1)) }, end };
  }
  if (n === '"') {
    const end = skipDollar(raw, i);
    return { part: { t: 'dq', parts: parseDouble(raw.slice(i + 2, end - 1)) }, end };
  }
  if (SPECIAL.has(n) || /[0-9]/.test(n)) return { part: { t: 'param', body: n }, end: i + 2 };
  if (NAME_START.test(n)) {
    let j = i + 2;
    while (j < raw.length && NAME_CHAR.test(raw[j] ?? '')) j++;
    return { part: { t: 'param', body: raw.slice(i + 1, j) }, end: j };
  }
  return { part: { t: 'lit', v: '$' }, end: i + 1 };
}

/** Parts inside double quotes (no word splitting or globbing applies to them). */
export function parseDouble(s: string): Part[] {
  const parts: Part[] = [];
  let text = '';
  const flush = (): void => {
    if (text) parts.push({ t: 'q', v: text });
    text = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1] ?? '';
      if ('$`"\\'.includes(n)) text += n;
      else if (n !== '\n') text += `\\${n}`;
      i++;
    } else if (c === '$' && i + 1 < s.length && s[i + 1] !== '"' && s[i + 1] !== "'") {
      const { part, end } = dollarPart(s, i);
      if (part.t === 'lit') { text += part.v; continue; }
      flush();
      parts.push(part);
      i = end - 1;
    } else if (c === '`') {
      const end = skipBacktick(s, i + 1);
      flush();
      parts.push({ t: 'cmd', src: unBacktick(s.slice(i + 1, end - 1)), mode: 'sub' });
      i = end - 1;
    } else text += c;
  }
  flush();
  return parts;
}

/** Parts of an unquoted word as written in the source. */
export function parseWord(raw: string): Part[] {
  const parts: Part[] = [];
  let text = '';
  const flush = (): void => {
    if (text) parts.push({ t: 'lit', v: text });
    text = '';
  };
  const push = (p: Part): void => {
    flush();
    parts.push(p);
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] ?? '';
    if (c === '\\') {
      if (raw[i + 1] !== '\n' && i + 1 < raw.length) push({ t: 'q', v: raw[i + 1] ?? '' });
      i++;
    } else if (c === "'") {
      const end = skipSingle(raw, i + 1);
      push({ t: 'q', v: raw.slice(i + 1, end - 1) });
      i = end - 1;
    } else if (c === '"') {
      const end = skipDouble(raw, i + 1);
      push({ t: 'dq', parts: parseDouble(raw.slice(i + 1, end - 1)) });
      i = end - 1;
    } else if (c === '`') {
      const end = skipBacktick(raw, i + 1);
      push({ t: 'cmd', src: unBacktick(raw.slice(i + 1, end - 1)), mode: 'sub' });
      i = end - 1;
    } else if (c === '$' && i + 1 < raw.length) {
      const { part, end } = dollarPart(raw, i);
      if (part.t === 'lit') text += part.v;
      else push(part);
      i = end - 1;
    } else if ((c === '<' || c === '>') && raw[i + 1] === '(' && i === 0) {
      const end = skipParen(raw, i + 2);
      push({ t: 'proc', dir: c, src: raw.slice(i + 2, end - 1) });
      i = end - 1;
    } else text += c;
  }
  flush();
  return parts;
}

/** True when the word has no quotes or expansions (used for reserved words and aliases). */
export function isPlainWord(raw: string): boolean {
  return !/[\\'"$`]/.test(raw);
}
