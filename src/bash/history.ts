/** History expansion (`set -o histexpand`, on in interactive shells). */
import { Lexer } from './lexer.ts';

export class HistoryError extends Error {}

function words(line: string): string[] {
  try {
    const lex = new Lexer(line);
    const out: string[] = [];
    for (let t = lex.next(); t.kind !== 'eof'; t = lex.next()) {
      if (t.kind === 'word') out.push(t.raw);
      else if (t.kind === 'op') out.push(t.op);
    }
    return out;
  } catch {
    return line.trim().split(/\s+/);
  }
}

function findEvent(spec: string, lines: readonly string[], base: number): string {
  let found: string | undefined;
  if (spec === '!' || spec === '') found = lines[lines.length - 1];
  else if (/^-?\d+$/.test(spec)) {
    const n = Number(spec);
    found = n < 0 ? lines[lines.length + n] : lines[n - base];
  } else if (spec.startsWith('?')) {
    const s = spec.slice(1).replace(/\?$/, '');
    found = [...lines].reverse().find((l) => l.includes(s));
  } else found = [...lines].reverse().find((l) => l.startsWith(spec));
  if (found === undefined) throw new HistoryError(`!${spec}: event not found`);
  return found;
}

function designate(event: string, desig: string): string {
  if (!desig) return event;
  const w = words(event);
  const idx = (s: string): number => (s === '$' ? w.length - 1 : s === '^' ? 1 : Number(s));
  if (desig === '*') return w.slice(1).join(' ');
  const range = /^(\d+|\^|\$)?(?:(-)(\d+|\$)?)?(\*)?$/.exec(desig);
  if (!range) return event;
  const a = range[1] === undefined ? 0 : idx(range[1]);
  if (range[4]) return w.slice(a).join(' ');
  if (!range[2]) {
    if (a >= w.length) throw new HistoryError(`:${desig}: bad word specifier`);
    return w[a] ?? '';
  }
  const b = range[3] === undefined ? w.length - 2 : idx(range[3]);
  return w.slice(a, b + 1).join(' ');
}

function modify(text: string, mods: string): { text: string; print: boolean } {
  let out = text;
  let print = false;
  const re = /:([htrepqx]|g?s(.)(.*?)\2(.*?)(?:\2|$))/g;
  for (const m of mods.matchAll(re)) {
    const op = m[1] ?? '';
    if (op === 'h') out = out.includes('/') ? out.slice(0, out.lastIndexOf('/')) : out;
    else if (op === 't') out = out.slice(out.lastIndexOf('/') + 1);
    else if (op === 'r') out = out.replace(/\.[^./]*$/, '');
    else if (op === 'e') out = /\.[^./]*$/.exec(out)?.[0].slice(1) ?? '';
    else if (op === 'p') print = true;
    else if (op === 'q') out = `'${out.replace(/'/g, "'\\''")}'`;
    else if (op.startsWith('s') || op.startsWith('gs')) out = op.startsWith('g') ? out.split(m[3] ?? '').join(m[4] ?? '') : out.replace(m[3] ?? '', m[4] ?? '');
  }
  return { text: out, print };
}

/** Returns the expanded line, or null if it has no history references. Lines starting with "!" being printed are marked by a leading "\u0000p". */
export function expandHistory(line: string, lines: readonly string[], base: number): string | null {
  if (line.startsWith('^')) {
    const m = /^\^([^^]*)\^([^^]*)\^?(.*)$/.exec(line);
    if (!m) return null;
    const prev = findEvent('!', lines, base);
    if (!prev.includes(m[1] ?? '')) throw new HistoryError(':s^' + (m[1] ?? '') + '^' + (m[2] ?? '') + ': substitution failed');
    return prev.replace(m[1] ?? '', m[2] ?? '') + (m[3] ?? '');
  }
  if (!line.includes('!')) return null;
  let out = '';
  let changed = false;
  let print = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? '';
    if (c === "'" ) inSingle = !inSingle;
    if (c === '\\' && line[i + 1] === '!') { out += '!'; i++; changed = true; continue; }
    const next = line[i + 1] ?? '';
    if (c !== '!' || inSingle || next === '' || /[\s=(]/.test(next) || (next === '"' )) { out += c; continue; }
    const m = /^!(!|-?\d+|\?[^?\n]*\??|[$^*]|[^\s:$^*!?"'=(]+)?(?::?([$^*]|\d+(?:-(?:\d+|\$)?)?|-\d+|\d+\*))?((?::(?:[htrepqx]|g?s(.)[^\n]*?\4[^\n]*?(?:\4|(?=\s|$))))*)/.exec(line.slice(i));
    if (!m) { out += c; continue; }
    const eventSpec = m[1] ?? '';
    const shorthand = /^[$^*]$/.test(eventSpec);
    const event = findEvent(shorthand ? '!' : eventSpec, lines, base);
    const text = designate(event, shorthand ? eventSpec : m[2] ?? '');
    const mod = modify(text, m[3] ?? '');
    print = print || mod.print;
    out += mod.text;
    i += m[0].length - 1;
    changed = true;
  }
  if (!changed) return null;
  return print ? `\u0000p${out}` : out;
}
