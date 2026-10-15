/**
 * The `edit` command of the Windows terminal (Microsoft Edit): menu bar, text area and status bar, with the keys of
 * a Windows editor: Ctrl+S save, Ctrl+Q or Esc exit (asks to save changes), Ctrl+Z / Ctrl+Y undo and redo, Ctrl+F find,
 * F3 find next and Ctrl+G go to line.
 */
import type { EditSpec } from '../bash/types.ts';
import type { Editor, EditorIO, Frame, KeyInput, Span } from './buffer.ts';
import { TextBuffer, fit } from './buffer.ts';
import { textArea } from './nano-view.ts';

type Mode =
  | { readonly kind: 'edit' }
  | { readonly kind: 'prompt'; readonly purpose: 'find' | 'goto'; readonly label: string; value: string }
  | { readonly kind: 'confirm-exit' };

const HINTS = 'Ctrl+S Save  Ctrl+Q/Esc Exit  Ctrl+F Find  Ctrl+G Go to line  Ctrl+Z Undo';
const CHROME_ROWS = 2;

export class MsEditEditor implements Editor {
  closed = false;
  private readonly buf: TextBuffer;
  private readonly io: EditorIO;
  private readonly spec: EditSpec;
  private mode: Mode = { kind: 'edit' };
  private message: string | null;
  private top = 0;
  private height = 24;
  private lastFind = '';

  constructor(spec: EditSpec, io: EditorIO) {
    this.spec = spec;
    this.io = io;
    // The text exactly as in the file: a final newline shows as an empty last line, and is kept when saving.
    this.buf = new TextBuffer(spec.content, true);
    this.message = spec.readOnly ? 'This file is read-only.' : null;
  }

  private get name(): string {
    return this.spec.path.split('/').pop() || 'Untitled-1.txt';
  }

  key(k: KeyInput): void {
    if (this.mode.kind === 'prompt') return this.promptKey(this.mode, k);
    if (this.mode.kind === 'confirm-exit') return this.confirmKey(k);
    this.message = this.spec.readOnly ? 'This file is read-only.' : null;
    if (k.ctrl) return this.ctrlKey(k.key.toLowerCase());
    if (k.key === 'F3') return this.find(this.lastFind);
    // Escape also exits: some browsers keep Ctrl+Q for themselves.
    if (k.key === 'Escape') return this.ctrlKey('q');
    if (this.moveKey(k.key)) return;
    this.typeKey(k);
  }

  private ctrlKey(c: string): void {
    const b = this.buf;
    switch (c) {
      case 's': this.save(); break;
      case 'q': if (b.modified && !this.spec.readOnly) this.mode = { kind: 'confirm-exit' }; else this.closed = true; break;
      case 'z': if (!this.spec.readOnly) this.message = b.undo() ? null : 'Nothing to undo.'; break;
      case 'y': if (!this.spec.readOnly) this.message = b.redo() ? null : 'Nothing to redo.'; break;
      case 'f': this.mode = { kind: 'prompt', purpose: 'find', label: 'Find: ', value: this.lastFind }; break;
      case 'g': this.mode = { kind: 'prompt', purpose: 'goto', label: 'Go to line: ', value: '' }; break;
      case 'home': b.row = 0; b.col = 0; break;
      case 'end': b.row = b.lines.length - 1; b.col = b.line.length; break;
      default: break;
    }
  }

  private moveKey(key: string): boolean {
    const b = this.buf;
    const page = Math.max(1, this.height - CHROME_ROWS - 1);
    switch (key) {
      case 'ArrowLeft': if (b.col > 0) b.col--; else if (b.row > 0) { b.row--; b.col = b.line.length; } return true;
      case 'ArrowRight': if (b.col < b.line.length) b.col++; else if (b.row < b.lines.length - 1) { b.row++; b.col = 0; } return true;
      case 'ArrowUp': b.row--; b.clamp(); return true;
      case 'ArrowDown': b.row++; b.clamp(); return true;
      case 'Home': b.col = 0; return true;
      case 'End': b.col = b.line.length; return true;
      case 'PageUp': b.row -= page; b.clamp(); return true;
      case 'PageDown': b.row += page; b.clamp(); return true;
      default: return false;
    }
  }

  private typeKey(k: KeyInput): void {
    const text = k.key === 'Enter' ? '\n' : k.key === 'Tab' ? '    ' : k.key.length === 1 && !k.alt ? k.key : null;
    const erase = k.key === 'Backspace' || k.key === 'Delete';
    if (text === null && !erase) return;
    if (this.spec.readOnly) return;
    const b = this.buf;
    b.checkpoint();
    if (text !== null) b.insert(text);
    else if (k.key === 'Backspace') b.backspace();
    else b.deleteChar();
  }

  private save(): boolean {
    if (this.spec.readOnly) {
      this.message = 'This file is read-only.';
      return false;
    }
    const err = this.io.save(this.spec.path, this.buf.lines.join('\n'));
    this.message = err ? `Could not save ${this.name}: ${err}` : `Saved ${this.name}`;
    if (!err) this.buf.modified = false;
    return !err;
  }

  private confirmKey(k: KeyInput): void {
    const c = k.key.toLowerCase();
    if (k.key === 'Escape' || (k.ctrl && c === 'c')) { this.mode = { kind: 'edit' }; return; }
    if (c === 'n') this.closed = true;
    else if (c === 'y' || k.key === 'Enter') {
      this.mode = { kind: 'edit' };
      if (this.save()) this.closed = true;
    }
  }

  private promptKey(p: Extract<Mode, { kind: 'prompt' }>, k: KeyInput): void {
    if (k.key === 'Escape' || (k.ctrl && k.key.toLowerCase() === 'c')) { this.mode = { kind: 'edit' }; return; }
    if (k.key === 'Backspace') { p.value = p.value.slice(0, -1); return; }
    if (k.key.length === 1 && !k.ctrl && !k.alt) { p.value += k.key; return; }
    if (k.key !== 'Enter') return;
    this.mode = { kind: 'edit' };
    if (p.purpose === 'find') {
      this.lastFind = p.value;
      this.find(p.value);
      return;
    }
    const line = Number(p.value);
    if (!Number.isInteger(line) || line < 1) { this.message = 'Invalid line number.'; return; }
    this.buf.row = line - 1;
    this.buf.col = 0;
    this.buf.clamp();
  }

  private find(needle: string): void {
    if (!needle) return;
    const hit = this.buf.find(needle, true);
    if (!hit) { this.message = `Cannot find "${needle}".`; return; }
    this.buf.row = hit.row;
    this.buf.col = hit.col;
  }

  // ------------------------------------------------------------ screen

  frame(width: number, height: number): Frame {
    this.height = height;
    const textRows = Math.max(1, height - CHROME_ROWS);
    const b = this.buf;
    if (b.row < this.top) this.top = b.row;
    if (b.row >= this.top + textRows) this.top = b.row - textRows + 1;
    const area = textArea({ lines: b.lines, top: this.top, row: b.row, col: b.col }, width, textRows, 1);
    const status = this.statusBar(width);
    return { rows: [this.menuBar(width), ...area.rows, status.row], cursor: status.cursor ?? area.cursor };
  }

  private menuBar(width: number): Span[] {
    const right = `${this.buf.modified ? '● ' : ''}${this.name} - Microsoft Edit `;
    const left = ' File  Edit  View  Help';
    return [{ text: fit(`${left}${' '.repeat(Math.max(1, width - left.length - right.length))}${right}`, width), style: 'inverse' }];
  }

  private statusBar(width: number): { row: Span[]; cursor: Frame['cursor'] } {
    const row = this.height - 1;
    if (this.mode.kind === 'prompt') {
      const text = `${this.mode.label}${this.mode.value}`;
      return { row: [{ text: fit(text, width), style: 'inverse' }], cursor: { row, col: Math.min(width - 1, text.length) } };
    }
    if (this.mode.kind === 'confirm-exit') {
      const text = `Do you want to save the changes to ${this.name}?  (Y)es  (N)o  (Esc) Cancel`;
      return { row: [{ text: fit(text, width), style: 'inverse' }], cursor: { row, col: Math.min(width - 1, text.length) } };
    }
    const pos = `Ln ${this.buf.row + 1}, Col ${this.buf.col + 1}  LF  UTF-8 `;
    const left = ` ${this.message ?? HINTS}`;
    return { row: [{ text: fit(`${fit(left, Math.max(0, width - pos.length))}${pos}`, width), style: 'inverse' }], cursor: null };
  }
}
