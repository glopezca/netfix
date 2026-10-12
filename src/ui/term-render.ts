/** DOM rendering for the terminal: ANSI-coloured rows and full-screen editor frames (text only, via textContent). */
import { el } from './dom.ts';
import { parseAnsi } from '../core/ansi.ts';
import type { AnsiRun, AnsiStyle } from '../core/ansi.ts';
import type { Frame, KeyInput } from '../editors/index.ts';

const PALETTE_SIZE = 16;
const CUBE_START = 16;
const GRAY_START = 232;
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

/** xterm 256-colour palette entry (16-231 colour cube, 232-255 grey ramp) as #rrggbb, computed from the number. */
export function xterm256(n: number): string {
  const hex = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  if (n >= GRAY_START) {
    const g = 8 + (Math.min(n, 255) - GRAY_START) * 10;
    return `#${hex(g)}${hex(g)}${hex(g)}`;
  }
  const i = Math.max(0, n - CUBE_START);
  const level = (k: number): number => CUBE_LEVELS[k] ?? 0;
  return `#${hex(level(Math.floor(i / 36) % 6))}${hex(level(Math.floor(i / 6) % 6))}${hex(level(i % 6))}`;
}

function runClasses(r: AnsiStyle): string {
  const c: string[] = [];
  const fg = r.inverse ? r.bg ?? 'bg' : r.fg;
  const bg = r.inverse ? r.fg ?? 'fg' : r.bg;
  if (fg !== undefined) c.push(typeof fg === 'number' ? (fg < PALETTE_SIZE ? `ansi-fg${fg}` : 'ansi-fgx') : 'ansi-fg-bg');
  if (bg !== undefined) c.push(typeof bg === 'number' ? (bg < PALETTE_SIZE ? `ansi-bg${bg}` : 'ansi-bgx') : 'ansi-bg-fg');
  if (r.bold) c.push('ansi-bold');
  if (r.dim) c.push('ansi-dim');
  if (r.italic) c.push('ansi-italic');
  if (r.underline) c.push('ansi-underline');
  return c.join(' ');
}

function runNode(r: AnsiRun): Node {
  const cls = runClasses(r);
  const fg = r.inverse ? r.bg : r.fg;
  const bg = r.inverse ? r.fg : r.bg;
  const style = [fg !== undefined && fg >= PALETTE_SIZE ? `color:${xterm256(fg)}` : '', bg !== undefined && bg >= PALETTE_SIZE ? `background:${xterm256(bg)}` : ''].filter(Boolean).join(';');
  if (!cls && !style) return document.createTextNode(r.text);
  return el('span', { class: cls || undefined, style: style || undefined }, r.text);
}

/** One output row; returns the SGR state for the next row (colours may span lines). */
export function ansiRow(text: string, style: AnsiStyle, className: string): { row: HTMLElement; style: AnsiStyle } {
  const parsed = parseAnsi(text, style);
  const row = el('div', { class: className });
  if (!parsed.runs.some((r) => r.text !== '')) row.textContent = ' ';
  else for (const r of parsed.runs) row.appendChild(runNode(r));
  return { row, style: parsed.style };
}

/** Prompt text (may contain colours) inside an existing element. */
export function fillAnsi(target: HTMLElement, text: string): void {
  target.textContent = '';
  for (const r of parseAnsi(text).runs) target.appendChild(runNode(r));
}

/** Draws an editor frame; the character under the cursor gets the `ed-cursor` class. */
export function drawFrame(target: HTMLElement, f: Frame): void {
  target.textContent = '';
  f.rows.forEach((spans, i) => {
    const row = el('div', { class: 'ed-row' });
    let col = 0;
    for (const s of spans) {
      const cls = s.style ? `ed-${s.style}` : '';
      const cursorHere = f.cursor?.row === i && f.cursor.col >= col && f.cursor.col < col + s.text.length;
      if (cursorHere && f.cursor) {
        const at = f.cursor.col - col;
        row.append(el('span', { class: cls || undefined }, s.text.slice(0, at)), el('span', { class: `ed-cursor ${cls}`.trim() }, s.text[at] ?? ' '), el('span', { class: cls || undefined }, s.text.slice(at + 1)));
      } else row.appendChild(cls ? el('span', { class: cls }, s.text) : document.createTextNode(s.text));
      col += s.text.length;
    }
    if (f.cursor?.row === i && f.cursor.col >= col) row.append(' '.repeat(f.cursor.col - col), el('span', { class: 'ed-cursor' }, ' '));
    target.appendChild(row);
  });
}

/** KeyboardEvent → editor key (null for modifier-only presses). */
export function editorKey(e: KeyboardEvent): KeyInput | null {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return null;
  return { key: e.key, ctrl: e.ctrlKey, alt: e.altKey || e.metaKey, shift: e.shiftKey };
}

/** Lays out completion candidates in columns, like bash after a second Tab. */
export function columns(items: readonly string[], width = 80): string[] {
  const w = Math.max(...items.map((s) => s.length)) + 2;
  const per = Math.max(1, Math.floor(width / w));
  const rows = Math.ceil(items.length / per);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: per }, (_, c) => items[c * rows + r] ?? '').map((s, c, a) => (c === a.length - 1 ? s : s.padEnd(w))).join('').trimEnd());
}
