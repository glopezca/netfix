/** Text buffer shared by the nano and vim engines: lines, cursor, undo snapshots and display helpers. */

export interface KeyInput {
  /** KeyboardEvent.key: "a", "Enter", "ArrowUp", "Backspace"… */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

export type SpanStyle = 'inverse' | 'bold' | 'dim' | 'accent' | 'error'
  /** Midnight Commander skin. */
  | 'panel' | 'panelHead' | 'cursor' | 'marked' | 'dir' | 'exec' | 'link' | 'menu' | 'keynum' | 'keylabel' | 'dialog' | 'dialogFocus' | 'viewer';

export interface Span {
  readonly text: string;
  readonly style?: SpanStyle;
}

/** What the terminal draws: one array of spans per screen row and the cursor cell. */
export interface Frame {
  readonly rows: readonly (readonly Span[])[];
  readonly cursor: { readonly row: number; readonly col: number } | null;
}

/** Writes the buffer; returns an error message or null. */
export interface EditorIO {
  save(path: string, content: string): string | null;
}

export interface Editor {
  key(k: KeyInput): void;
  frame(width: number, height: number): Frame;
  /** The editor was closed: the terminal returns to the shell. */
  readonly closed: boolean;
}

export const TAB_WIDTH = 8;
const MAX_UNDO = 200;

export function splitContent(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Display width of the first `col` characters (tabs expand to the next tab stop). */
export function displayCol(line: string, col: number): number {
  let w = 0;
  for (let i = 0; i < col && i < line.length; i++) w = line[i] === '\t' ? w + TAB_WIDTH - (w % TAB_WIDTH) : w + 1;
  return w;
}

export function expandTabs(line: string): string {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : ch;
  return out;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A row padded or cut to the screen width. */
export function fit(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

interface Snapshot {
  readonly lines: readonly string[];
  readonly row: number;
  readonly col: number;
}

export class TextBuffer {
  lines: string[];
  row = 0;
  col = 0;
  modified = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** `keepLastLine`: nano's "magic" empty line after the final newline is part of the buffer. */
  constructor(content: string, keepLastLine = false) {
    this.lines = keepLastLine ? content.split('\n') : splitContent(content);
  }

  get line(): string {
    return this.lines[this.row] ?? '';
  }

  text(): string {
    return `${this.lines.join('\n')}\n`;
  }

  /** Saves the state before a change (one undo step). */
  checkpoint(): void {
    this.undoStack.push({ lines: [...this.lines], row: this.row, col: this.col });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    return this.swap(this.undoStack, this.redoStack);
  }

  redo(): boolean {
    return this.swap(this.redoStack, this.undoStack);
  }

  private swap(from: Snapshot[], to: Snapshot[]): boolean {
    const s = from.pop();
    if (!s) return false;
    to.push({ lines: [...this.lines], row: this.row, col: this.col });
    this.lines = [...s.lines];
    this.row = s.row;
    this.col = s.col;
    this.modified = true;
    return true;
  }

  clamp(allowEnd = true): void {
    this.row = Math.max(0, Math.min(this.row, this.lines.length - 1));
    const max = allowEnd ? this.line.length : Math.max(0, this.line.length - 1);
    this.col = Math.max(0, Math.min(this.col, max));
  }

  setLine(row: number, text: string): void {
    this.lines[row] = text;
    this.modified = true;
  }

  insert(text: string): void {
    const parts = text.split('\n');
    const before = this.line.slice(0, this.col);
    const after = this.line.slice(this.col);
    if (parts.length === 1) {
      this.setLine(this.row, before + text + after);
      this.col += text.length;
      return;
    }
    const last = parts[parts.length - 1] ?? '';
    const middle = parts.slice(1, -1);
    this.lines.splice(this.row, 1, before + (parts[0] ?? ''), ...middle, last + after);
    this.row += parts.length - 1;
    this.col = last.length;
    this.modified = true;
  }

  newline(): void {
    this.insert('\n');
  }

  /** Deletes the character before the cursor (joins lines at column 0). */
  backspace(): void {
    if (this.col > 0) {
      this.setLine(this.row, this.line.slice(0, this.col - 1) + this.line.slice(this.col));
      this.col--;
    } else if (this.row > 0) {
      const prev = this.lines[this.row - 1] ?? '';
      this.lines.splice(this.row - 1, 2, prev + this.line);
      this.row--;
      this.col = prev.length;
      this.modified = true;
    }
  }

  /** Deletes the character under the cursor (joins with the next line at the end). */
  deleteChar(): void {
    if (this.col < this.line.length) this.setLine(this.row, this.line.slice(0, this.col) + this.line.slice(this.col + 1));
    else if (this.row < this.lines.length - 1) {
      this.lines.splice(this.row, 2, this.line + (this.lines[this.row + 1] ?? ''));
      this.modified = true;
    }
  }

  /** Removes `count` lines from the cursor row and returns them. */
  removeLines(count: number): string[] {
    const removed = this.lines.splice(this.row, Math.max(1, count));
    if (!this.lines.length) this.lines.push('');
    this.modified = true;
    this.clamp();
    return removed;
  }

  insertLines(at: number, lines: readonly string[]): void {
    this.lines.splice(at, 0, ...lines);
    this.modified = true;
  }

  /** Finds `needle` after (or before) the cursor, wrapping around the buffer. */
  find(needle: string, forward: boolean, here = false): { row: number; col: number; wrapped: boolean } | null {
    if (!needle) return null;
    const n = this.lines.length;
    for (let i = 0; i <= n; i++) {
      const r = forward ? (this.row + i) % n : (this.row - i + 2 * n) % n;
      const text = this.lines[r] ?? '';
      let col: number;
      if (i === 0) col = forward ? text.indexOf(needle, this.col + (here ? 0 : 1)) : this.col > 0 ? text.lastIndexOf(needle, this.col - 1) : -1;
      else col = forward ? text.indexOf(needle) : text.lastIndexOf(needle);
      if (col >= 0) return { row: r, col, wrapped: i === n || (forward ? r < this.row : r > this.row) };
    }
    return null;
  }
}
