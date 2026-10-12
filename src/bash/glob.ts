/**
 * Shell patterns: * ? [...] [!...] [[:class:]] and extglob ?() *() +() @() !().
 * A backslash makes the next character literal (the expander escapes quoted text that way).
 */
import { isCatastrophic } from './regex-guard.ts';

export interface GlobOptions {
  readonly nocase?: boolean;
  /** Pathname matching: wildcards never match "/". */
  readonly pathname?: boolean;
}

const CLASSES: Readonly<Record<string, string>> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e',
};

const reEscape = (c: string): string => c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Index of the `)` closing an extglob group that starts after `(` at i. */
function closeParen(p: string, i: number): number {
  let depth = 1;
  for (let j = i; j < p.length; j++) {
    if (p[j] === '\\') j++;
    else if (p[j] === '(') depth++;
    else if (p[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

function splitAlternatives(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === '|' && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

/** Translates a bracket expression starting at i ("["); returns [regex, end] or null if unterminated. */
function bracket(p: string, i: number, pathname: boolean): [string, number] | null {
  let j = i + 1;
  let negate = false;
  if (p[j] === '!' || p[j] === '^') { negate = true; j++; }
  let body = '';
  let first = true;
  for (; j < p.length; j++) {
    const c = p[j] ?? '';
    if (c === ']' && !first) return [`[${negate ? '^' : ''}${body}${negate && pathname ? '/' : ''}]`, j + 1];
    first = false;
    const cls = /^\[:([a-z]+):\]/.exec(p.slice(j));
    if (cls) {
      body += CLASSES[cls[1] ?? ''] ?? '';
      j += cls[0].length - 1;
    } else if (c === '\\' && j + 1 < p.length) body += reEscape(p[++j] ?? '');
    else if (c === '-' && body && p[j + 1] !== ']') body += '-';
    else body += reEscape(c);
  }
  return null;
}

function translate(p: string, opts: GlobOptions): string {
  const any = opts.pathname ? '[^/]' : '[\\s\\S]';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i] ?? '';
    if ('?*+@!'.includes(c) && p[i + 1] === '(') {
      const end = closeParen(p, i + 2);
      if (end > 0) {
        const alts = splitAlternatives(p.slice(i + 2, end)).map((a) => translate(a, opts)).join('|');
        re += c === '?' ? `(?:${alts})?` : c === '*' ? `(?:${alts})*` : c === '+' ? `(?:${alts})+` : c === '@' ? `(?:${alts})` : `(?:(?!(?:${alts})$)${any}*)`;
        i = end;
        continue;
      }
    }
    if (c === '\\') re += i + 1 < p.length ? reEscape(p[++i] ?? '') : '\\\\';
    else if (c === '*') re += `${any}*`;
    else if (c === '?') re += any;
    else if (c === '[') {
      const b = bracket(p, i, Boolean(opts.pathname));
      if (b) { re += b[0]; i = b[1] - 1; } else re += '\\[';
    } else re += reEscape(c);
  }
  return re;
}

const cache = new Map<string, RegExp>();
const MAX_CACHE = 500;

export function patternRegex(pattern: string, opts: GlobOptions = {}, anchored = true): RegExp {
  const key = `${opts.nocase ? 'i' : ''}${opts.pathname ? 'p' : ''}${anchored ? 'a' : ''}:${pattern}`;
  let re = cache.get(key);
  if (!re) {
    const body = translate(pattern, opts);
    // an extglob such as +(a|aa) would backtrack exponentially: it matches nothing instead of freezing the page
    re = isCatastrophic(body) ? /(?!)/ : new RegExp(anchored ? `^(?:${body})$` : `(?:${body})`, opts.nocase ? 'i' : '');
    if (cache.size > MAX_CACHE) cache.clear();
    cache.set(key, re);
  }
  return re;
}

export function matchPattern(pattern: string, text: string, opts: GlobOptions = {}): boolean {
  try {
    return patternRegex(pattern, opts).test(text);
  } catch {
    return pattern === text;
  }
}

/** True when the pattern contains an unescaped wildcard. */
export function hasGlob(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') i++;
    else if (c === '*' || c === '?' || c === '[') return true;
    else if ((c === '+' || c === '@' || c === '!') && pattern[i + 1] === '(') return true;
  }
  return false;
}

/** Removes the backslashes of a pattern (the literal text it stands for). */
export function unescapePattern(pattern: string): string {
  return pattern.replace(/\\([\s\S])/g, '$1');
}

/**
 * Removes the shortest/longest prefix or suffix matching the pattern (${v#p} ${v##p} ${v%p} ${v%%p}).
 */
export function trimPattern(text: string, pattern: string, from: 'prefix' | 'suffix', longest: boolean): string {
  const chars = Array.from(text);
  const n = chars.length;
  const order = longest ? Array.from({ length: n + 1 }, (_, k) => n - k) : Array.from({ length: n + 1 }, (_, k) => k);
  for (const len of order) {
    const piece = from === 'prefix' ? chars.slice(0, len).join('') : chars.slice(n - len).join('');
    if (matchPattern(pattern, piece)) return from === 'prefix' ? chars.slice(len).join('') : chars.slice(0, n - len).join('');
  }
  return text;
}

/** ${v/p/s}: replaces the first (or every) longest match; `#`/`%` anchor at start/end. */
export function replacePattern(text: string, pattern: string, rep: string, mode: 'first' | 'all' | 'start' | 'end'): string {
  const chars = Array.from(text);
  if (pattern === '') return mode === 'start' ? rep + text : mode === 'end' ? text + rep : text;
  let out = '';
  let i = 0;
  let replaced = false;
  while (i <= chars.length) {
    const canHere = mode === 'start' ? i === 0 : !(mode === 'first' && replaced);
    let len = -1;
    if (canHere) {
      for (let l = chars.length - i; l >= 1; l--) {
        if (mode === 'end' && i + l !== chars.length) continue;
        if (matchPattern(pattern, chars.slice(i, i + l).join(''))) { len = l; break; }
      }
    }
    if (len > 0) {
      out += rep;
      i += len;
      replaced = true;
      if (mode !== 'all') return out + chars.slice(i).join('');
      continue;
    }
    if (i < chars.length) out += chars[i];
    i++;
  }
  return out;
}
