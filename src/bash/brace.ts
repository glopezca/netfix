/** Brace expansion on raw word text: {a,b,c}, {1..10}, {01..10..2}, {a..z}. Quotes are respected. */
import { skipDollar, skipDouble, skipSingle } from './lexer.ts';

const MAX_RESULTS = 100_000;

interface Group {
  readonly open: number;
  readonly close: number;
  readonly items: readonly string[];
}

/** Index after a quoted or $-expansion at i, or i + 1 for ordinary characters. */
function step(s: string, i: number): number {
  const c = s[i];
  if (c === '\\') return i + 2;
  if (c === "'") return safe(() => skipSingle(s, i + 1), s.length);
  if (c === '"') return safe(() => skipDouble(s, i + 1), s.length);
  if (c === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) return safe(() => skipDollar(s, i), s.length);
  return i + 1;
}

function safe(fn: () => number, fallback: number): number {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function sequence(body: string): string[] | null {
  const num = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body);
  if (num) {
    const [a, b] = [Number(num[1]), Number(num[2])];
    const inc = Math.abs(Number(num[3] ?? 1)) || 1;
    const width = [num[1] ?? '', num[2] ?? ''].some((x) => /^-?0\d/.test(x)) ? Math.max((num[1] ?? '').length, (num[2] ?? '').length) : 0;
    const out: string[] = [];
    for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? inc : -inc) {
      if (out.length >= MAX_RESULTS) break;
      const text = String(Math.abs(v)).padStart(width - (v < 0 ? 1 : 0), '0');
      out.push(v < 0 ? `-${text}` : text);
    }
    return out;
  }
  const chr = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(body);
  if (!chr) return null;
  const [a, b] = [(chr[1] ?? 'a').charCodeAt(0), (chr[2] ?? 'a').charCodeAt(0)];
  const inc = Math.abs(Number(chr[3] ?? 1)) || 1;
  const out: string[] = [];
  for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? inc : -inc) out.push(String.fromCharCode(v));
  return out;
}

/** Splits the inside of a brace group at top-level commas. */
function commaItems(s: string, open: number, close: number): string[] | null {
  const items: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i = step(s, i)) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) {
      items.push(s.slice(from, i));
      from = i + 1;
    }
  }
  if (!items.length) return null;
  items.push(s.slice(from, close));
  return items;
}

function findGroup(s: string, from: number): Group | null {
  for (let i = from; i < s.length; i = step(s, i)) {
    if (s[i] !== '{' || s[i - 1] === '$') continue;
    let depth = 0;
    for (let j = i; j < s.length; j = step(s, j)) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) {
        const items = commaItems(s, i, j) ?? sequence(s.slice(i + 1, j));
        if (items) return { open: i, close: j, items };
        break;
      }
    }
  }
  return null;
}

export function braceExpand(word: string, from = 0): string[] {
  if (!word.includes('{')) return [word];
  const g = findGroup(word, from);
  if (!g) return [word];
  const prefix = word.slice(0, g.open);
  const suffix = word.slice(g.close + 1);
  const out: string[] = [];
  for (const item of g.items) {
    for (const r of braceExpand(prefix + item + suffix, prefix.length)) {
      if (out.length >= MAX_RESULTS) return out;
      out.push(r);
    }
  }
  return out;
}
