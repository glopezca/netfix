/** Parser of vim normal-mode key sequences: [count] command, [count] operator [count] motion, r{c}, gg, ZZ… */
import type { KeyInput } from './buffer.ts';

export type Parsed =
  | { readonly kind: 'more' }
  | { readonly kind: 'bad' }
  | { readonly kind: 'motion'; readonly count?: number; readonly key: string; readonly arg?: string }
  | { readonly kind: 'operator'; readonly op: string; readonly count?: number; readonly motion: string; readonly arg?: string }
  | { readonly kind: 'command'; readonly count?: number; readonly key: string; readonly arg?: string };

const OPERATORS = new Set(['d', 'c', 'y']);
const MOTIONS = new Set(['h', 'j', 'k', 'l', 'w', 'b', 'e', 'W', 'B', 'E', '0', '^', '$', 'G', '+', '-', 'Enter', 'Backspace', ' ',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const CHAR_ARG = new Set(['f', 'F', 't', 'T']);
const COMMANDS = new Set(['x', 'X', 'D', 'C', 'S', 's', 'Y', 'p', 'P', 'u', '<C-r>', 'J', '~', 'i', 'a', 'I', 'A', 'o', 'O', '.', 'n', 'N', '*', '#',
  ':', '/', '?', '<C-f>', '<C-b>', '<C-d>', '<C-u>', '<C-g>', '<C-l>', 'v', 'V', 'R', 'Delete', 'PageUp', 'PageDown', 'Insert']);
const MORE: Parsed = { kind: 'more' };
const BAD: Parsed = { kind: 'bad' };

/** Normalises a key: printable characters as themselves, Ctrl+x as <C-x>, other keys by name. */
export function token(k: KeyInput): string | null {
  if (k.ctrl) return k.key.length === 1 ? `<C-${k.key.toLowerCase()}>` : null;
  if (k.alt) return null;
  return k.key;
}

function times(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 1) * (b ?? 1);
}

class Reader {
  private i = 0;
  private readonly tokens: readonly string[];

  constructor(tokens: readonly string[]) {
    this.tokens = tokens;
  }

  next(): string | undefined {
    return this.tokens[this.i++];
  }

  count(): number | undefined {
    let digits = '';
    for (let t = this.tokens[this.i]; t !== undefined && /^[0-9]$/.test(t) && !(digits === '' && t === '0'); t = this.tokens[this.i]) {
      digits += t;
      this.i++;
    }
    return digits ? Number(digits) : undefined;
  }
}

/** A motion and its argument: `{ key }`, 'more' when incomplete, null when invalid. */
function readMotion(r: Reader, first: string): { key: string; arg?: string } | 'more' | null {
  if (first === 'g') {
    const second = r.next();
    if (second === undefined) return 'more';
    return second === 'g' ? { key: 'gg' } : null;
  }
  if (CHAR_ARG.has(first)) {
    const arg = r.next();
    if (arg === undefined) return 'more';
    return arg.length === 1 ? { key: first, arg } : null;
  }
  return MOTIONS.has(first) ? { key: first } : null;
}

export function parseNormal(tokens: readonly string[]): Parsed {
  const r = new Reader(tokens);
  const count = r.count();
  const first = r.next();
  if (first === undefined) return MORE;
  if (OPERATORS.has(first)) {
    const count2 = r.count();
    const second = r.next();
    if (second === undefined) return MORE;
    const total = times(count, count2);
    if (second === first) return { kind: 'operator', op: first, count: total, motion: first };
    const m = readMotion(r, second);
    if (m === 'more') return MORE;
    return m ? { kind: 'operator', op: first, count: total, motion: m.key, arg: m.arg } : BAD;
  }
  if (first === 'r' || first === 'Z') {
    const arg = r.next();
    if (arg === undefined) return MORE;
    return arg.length === 1 ? { kind: 'command', count, key: first, arg } : BAD;
  }
  const m = readMotion(r, first);
  if (m === 'more') return MORE;
  if (m) return { kind: 'motion', count, key: m.key, arg: m.arg };
  return COMMANDS.has(first) ? { kind: 'command', count, key: first } : BAD;
}
