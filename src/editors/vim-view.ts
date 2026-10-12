/** Screen of vim: wrapped text lines, `~` filler rows, optional line numbers, the message/mode line and the ruler. */
import type { Frame, Span } from './buffer.ts';
import { displayCol, expandTabs, fit } from './buffer.ts';

export interface VimView {
  readonly lines: readonly string[];
  readonly row: number;
  readonly col: number;
  readonly number: boolean;
  /** First buffer line shown (updated to keep the cursor visible). */
  top: number;
}

const NUMBER_WIDTH = 4;
const RULER_WIDTH = 18;

function rowsOf(line: string, width: number): number {
  return Math.max(1, Math.ceil(expandTabs(line).length / width));
}

/** Scrolls so that the cursor line is fully visible. */
export function scrollTo(v: VimView, width: number, textRows: number): void {
  if (v.row < v.top) v.top = v.row;
  const used = (): number => v.lines.slice(v.top, v.row + 1).reduce((n, l) => n + rowsOf(l, width), 0);
  while (v.top < v.row && used() > textRows) v.top++;
}

/** `12,5` / `0-1` on an empty line / `3,2-9` after a tab, followed by All, Top, Bot or a percentage. */
export function ruler(v: VimView, textRows: number): string {
  const line = v.lines[v.row] ?? '';
  const dc = displayCol(line, v.col) + 1;
  const col = line === '' ? '0-1' : dc === v.col + 1 ? String(v.col + 1) : `${v.col + 1}-${dc}`;
  const empty = v.lines.length === 1 && line === '';
  const shown = v.lines.length <= textRows;
  const where = shown ? 'All' : v.top === 0 ? 'Top' : v.top + textRows >= v.lines.length ? 'Bot' : `${Math.floor((v.top * 100) / (v.lines.length - textRows))}%`;
  return `${`${empty ? 0 : v.row + 1},${col}`.padEnd(14)}${where}`;
}

export function textRows(v: VimView, width: number, height: number): { rows: Span[][]; cursor: Frame['cursor'] } {
  const gutter = v.number ? NUMBER_WIDTH : 0;
  const w = Math.max(1, width - gutter);
  scrollTo(v, w, height);
  const rows: Span[][] = [];
  let cursor: Frame['cursor'] = null;
  for (let r = v.top; r < v.lines.length && rows.length < height; r++) {
    const line = v.lines[r] ?? '';
    const text = expandTabs(line);
    const pieces = rowsOf(line, w);
    if (rows.length + pieces > height && r !== v.top) {
      while (rows.length < height) rows.push([{ text: fit('@', width), style: 'accent' }]);
      break;
    }
    if (r === v.row) {
      const dc = displayCol(line, v.col);
      cursor = { row: rows.length + Math.floor(dc / w), col: gutter + (dc % w) };
    }
    for (let i = 0; i < pieces && rows.length < height; i++) {
      const num = v.number ? (i === 0 ? `${String(r + 1).padStart(NUMBER_WIDTH - 1)} ` : ' '.repeat(NUMBER_WIDTH)) : '';
      rows.push([...(num ? [{ text: num, style: 'accent' as const }] : []), { text: fit(text.slice(i * w, (i + 1) * w), w) }]);
    }
  }
  while (rows.length < height) rows.push([{ text: '~', style: 'accent' }, { text: ' '.repeat(Math.max(0, width - 1)) }]);
  return { rows, cursor };
}

/** Last screen line: message or mode on the left, ruler on the right. */
export function statusLine(left: Span | null, rulerText: string | null, width: number): Span[] {
  const rulerAt = Math.max(0, width - RULER_WIDTH);
  const leftText = left?.text ?? '';
  if (!rulerText || leftText.length >= rulerAt) return [{ text: fit(leftText, width), style: left?.style }];
  return [{ text: leftText, style: left?.style }, { text: ' '.repeat(rulerAt - leftText.length) }, { text: fit(rulerText, width - rulerAt) }];
}
