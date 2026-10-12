/** vim motions (h j k l w b e 0 ^ $ G gg f F t T…) and the text ranges operators act on. */
import type { TextBuffer } from './buffer.ts';

export interface Pos {
  readonly row: number;
  readonly col: number;
}

export interface Motion extends Pos {
  /** dd / dj / dG… act on whole lines. */
  readonly linewise: boolean;
  /** e, $, f include the target character. */
  readonly inclusive: boolean;
}

const isWord = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);
const isBlank = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
const cls = (c: string | undefined): number => (isBlank(c) ? 0 : isWord(c) ? 1 : 2);

function firstNonBlank(line: string): number {
  const m = /\S/.exec(line);
  return m ? m.index : Math.max(0, line.length - 1);
}

/** Next start of word (w), crossing lines; an empty line counts as a word. */
function wordForward(b: TextBuffer, p: Pos): Pos {
  let { row, col } = p;
  const line = (): string => b.lines[row] ?? '';
  const start = cls(line()[col]);
  while (col < line().length && cls(line()[col]) === start && start !== 0) col++;
  for (;;) {
    while (col < line().length && isBlank(line()[col])) col++;
    if (col < line().length) return { row, col };
    if (row >= b.lines.length - 1) return { row, col: Math.max(0, line().length) };
    row++;
    col = 0;
    if (line() === '') return { row, col };
  }
}

function wordBackward(b: TextBuffer, p: Pos): Pos {
  let { row, col } = p;
  const line = (): string => b.lines[row] ?? '';
  col--;
  for (;;) {
    while (col >= 0 && isBlank(line()[col])) col--;
    if (col >= 0) break;
    if (row === 0) return { row: 0, col: 0 };
    row--;
    col = line().length - 1;
    if (line() === '') return { row, col: 0 };
  }
  const k = cls(line()[col]);
  while (col > 0 && cls(line()[col - 1]) === k) col--;
  return { row, col };
}

function wordEnd(b: TextBuffer, p: Pos): Pos {
  let { row, col } = p;
  const line = (): string => b.lines[row] ?? '';
  col++;
  for (;;) {
    while (col < line().length && isBlank(line()[col])) col++;
    if (col < line().length) break;
    if (row >= b.lines.length - 1) return { row, col: Math.max(0, line().length - 1) };
    row++;
    col = 0;
  }
  const k = cls(line()[col]);
  while (col < line().length - 1 && cls(line()[col + 1]) === k) col++;
  return { row, col };
}

function repeat(n: number, p: Pos, step: (p: Pos) => Pos): Pos {
  let cur = p;
  for (let i = 0; i < n; i++) cur = step(cur);
  return cur;
}

/** Resolves a motion key (with an optional character argument for f/F/t/T). `count` is undefined when not typed. */
export function motion(b: TextBuffer, key: string, count: number | undefined, arg?: string): Motion | null {
  const n = count ?? 1;
  const here: Pos = { row: b.row, col: b.col };
  const line = b.line;
  const chars = (p: Pos, inclusive = false): Motion => ({ ...p, linewise: false, inclusive });
  const lines = (row: number, col?: number): Motion => {
    const r = Math.max(0, Math.min(b.lines.length - 1, row));
    return { row: r, col: col ?? firstNonBlank(b.lines[r] ?? ''), linewise: true, inclusive: false };
  };
  switch (key) {
    case 'h': case 'ArrowLeft': case 'Backspace': return chars({ row: b.row, col: Math.max(0, b.col - n) });
    case 'l': case 'ArrowRight': case ' ': return chars({ row: b.row, col: Math.min(Math.max(0, line.length), b.col + n) });
    case 'j': case 'ArrowDown': return lines(b.row + n, b.col);
    case 'k': case 'ArrowUp': return lines(b.row - n, b.col);
    case '+': case 'Enter': return lines(b.row + n);
    case '-': return lines(b.row - n);
    case '0': case 'Home': return chars({ row: b.row, col: 0 });
    case '^': return chars({ row: b.row, col: firstNonBlank(line) });
    case '$': case 'End': return { ...chars({ row: Math.min(b.lines.length - 1, b.row + n - 1), col: Math.max(0, (b.lines[b.row + n - 1] ?? line).length - 1) }, true) };
    case 'w': case 'W': return chars(repeat(n, here, (p) => wordForward(b, p)));
    case 'b': case 'B': return chars(repeat(n, here, (p) => wordBackward(b, p)));
    case 'e': case 'E': return chars(repeat(n, here, (p) => wordEnd(b, p)), true);
    case 'G': return lines(count === undefined ? b.lines.length - 1 : n - 1);
    case 'gg': return lines(n - 1);
    case 'f': case 't': case 'F': case 'T': return findChar(b, key, n, arg ?? '');
    default: return null;
  }
}

function findChar(b: TextBuffer, key: string, n: number, c: string): Motion | null {
  const line = b.line;
  let col = b.col;
  const forward = key === 'f' || key === 't';
  for (let i = 0; i < n; i++) {
    col = forward ? line.indexOf(c, col + 1) : line.lastIndexOf(c, col - 1);
    if (col < 0) return null;
  }
  if (key === 't') col--;
  if (key === 'T') col++;
  return { row: b.row, col, linewise: false, inclusive: forward };
}

/** Text between the cursor and a motion target: [start, end) in buffer coordinates. */
export function span(from: Pos, to: Motion): { start: Pos; end: Pos } {
  const before = to.row < from.row || (to.row === from.row && to.col < from.col);
  const start = before ? { row: to.row, col: to.col } : from;
  const last = before ? from : to;
  const end = { row: last.row, col: last.col + (to.inclusive && !before ? 1 : 0) };
  return { start, end };
}
