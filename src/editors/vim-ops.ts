/** vim operators on the text buffer: delete / yank / change ranges, put, join, replace and case toggling. */
import type { TextBuffer } from './buffer.ts';
import type { Motion, Pos } from './vim-motion.ts';
import { span } from './vim-motion.ts';

export interface Register {
  readonly text: string;
  readonly linewise: boolean;
}

function textBetween(b: TextBuffer, start: Pos, end: Pos): string {
  if (start.row === end.row) return (b.lines[start.row] ?? '').slice(start.col, end.col);
  const first = (b.lines[start.row] ?? '').slice(start.col);
  const middle = b.lines.slice(start.row + 1, end.row);
  const last = (b.lines[end.row] ?? '').slice(0, end.col);
  return [first, ...middle, last].join('\n');
}

function removeBetween(b: TextBuffer, start: Pos, end: Pos): void {
  const head = (b.lines[start.row] ?? '').slice(0, start.col);
  const tail = (b.lines[end.row] ?? '').slice(end.col);
  b.lines.splice(start.row, end.row - start.row + 1, head + tail);
  b.modified = true;
  b.row = start.row;
  b.col = start.col;
}

function lineRange(b: TextBuffer, to: Motion): [number, number] {
  return [Math.min(b.row, to.row), Math.max(b.row, to.row)];
}

/** Yanks the text a motion covers (cursor goes to the start, like vim). */
export function yank(b: TextBuffer, to: Motion): Register {
  if (to.linewise) {
    const [a, z] = lineRange(b, to);
    b.row = a;
    return { text: b.lines.slice(a, z + 1).join('\n'), linewise: true };
  }
  const { start, end } = span({ row: b.row, col: b.col }, to);
  b.row = start.row;
  b.col = start.col;
  return { text: textBetween(b, start, end), linewise: false };
}

/** Deletes what a motion covers; `change` keeps an empty line for linewise changes (cc). */
export function remove(b: TextBuffer, to: Motion, change = false): Register {
  if (to.linewise) {
    const [a, z] = lineRange(b, to);
    const text = b.lines.slice(a, z + 1).join('\n');
    b.lines.splice(a, z - a + 1, ...(change ? [''] : []));
    if (!b.lines.length) b.lines.push('');
    b.modified = true;
    b.row = Math.min(a, b.lines.length - 1);
    b.col = change ? 0 : /\S/.exec(b.line)?.index ?? 0;
    return { text, linewise: true };
  }
  const { start, end } = span({ row: b.row, col: b.col }, to);
  const text = textBetween(b, start, end);
  removeBetween(b, start, end);
  return { text, linewise: false };
}

/** p (after) / P (before), `count` times. */
export function put(b: TextBuffer, reg: Register, after: boolean, count: number): void {
  const text = Array.from({ length: Math.max(1, count) }, () => reg.text).join(reg.linewise ? '\n' : '');
  if (reg.linewise) {
    const at = after ? b.row + 1 : b.row;
    b.insertLines(at, text.split('\n'));
    b.row = at;
    b.col = /\S/.exec(b.line)?.index ?? 0;
    return;
  }
  if (after && b.line.length > 0) b.col++;
  const startRow = b.row;
  const startCol = b.col;
  b.insert(text);
  if (text.includes('\n')) { b.row = startRow; b.col = startCol; } else b.col = Math.max(0, b.col - 1);
}

/** J: joins `count` lines (at least two) with one space, removing leading blanks. */
export function join(b: TextBuffer, count: number): boolean {
  const n = Math.max(2, count);
  if (b.row + 1 >= b.lines.length) return false;
  for (let i = 1; i < n && b.row + 1 < b.lines.length; i++) {
    const cur = b.line.replace(/\s+$/, '');
    const next = (b.lines[b.row + 1] ?? '').replace(/^\s+/, '');
    const sep = cur === '' || next === '' || next.startsWith(')') ? '' : ' ';
    b.lines.splice(b.row, 2, cur + sep + next);
    b.col = cur.length;
  }
  b.modified = true;
  return true;
}

/** r{c}: replaces `count` characters (fails when the line is too short). */
export function replaceChars(b: TextBuffer, c: string, count: number): boolean {
  if (b.col + count > b.line.length) return false;
  b.setLine(b.row, b.line.slice(0, b.col) + c.repeat(count) + b.line.slice(b.col + count));
  b.col += count - 1;
  return true;
}

export function toggleCase(b: TextBuffer, count: number): void {
  const end = Math.min(b.line.length, b.col + count);
  const swapped = [...b.line.slice(b.col, end)].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('');
  b.setLine(b.row, b.line.slice(0, b.col) + swapped + b.line.slice(end));
  b.col = Math.min(end, Math.max(0, b.line.length - 1));
}
