/** GNU nano engine: editing keys, Write Out / Exit / Where Is / Replace / Go To Line prompts, cut & paste, undo. */
import type { EditSpec } from '../bash/types.ts';
import type { Editor, EditorIO, Frame, KeyInput, Span } from './buffer.ts';
import { TextBuffer, fit } from './buffer.ts';
import {
  HELP_KEYS, HELP_TEXT, MAIN_KEYS, PROMPT_KEYS, REPLACE_KEYS, WRITE_KEYS, YES_NO_KEYS,
  shortcutRows, statusRow, textArea, titleBar,
} from './nano-view.ts';
import type { Shortcut } from './nano-view.ts';

type PromptPurpose = 'write' | 'exit-write' | 'search' | 'replace' | 'replace-with' | 'goto';

type Mode =
  | { readonly kind: 'edit' }
  | { readonly kind: 'prompt'; readonly purpose: PromptPurpose; readonly label: string; value: string }
  | { readonly kind: 'save-modified' }
  | { readonly kind: 'replace-this'; readonly needle: string; readonly with: string; count: number; readonly start: { row: number; col: number }; wrapped: boolean }
  | { readonly kind: 'help'; top: number };

const CHROME_ROWS = 4;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export class NanoEditor implements Editor {
  closed = false;
  private readonly buf: TextBuffer;
  private readonly io: EditorIO;
  private path: string;
  private mode: Mode = { kind: 'edit' };
  private message: string | null;
  private top = 0;
  private height = 24;
  private cut: string[] = [];
  private lastCutRow = -1;
  private typing = false;
  private lastSearch = '';

  constructor(spec: EditSpec, io: EditorIO) {
    this.buf = new TextBuffer(spec.content, true);
    this.io = io;
    this.path = spec.path;
    if (spec.line !== undefined) this.buf.row = spec.line - 1;
    this.buf.clamp();
    const lines = this.lineCount();
    this.message = !spec.path ? null : !spec.exists ? 'New File' : spec.readOnly ? `File '${spec.path}' is unwritable` : `Read ${plural(lines, 'line')}`;
  }

  // ------------------------------------------------------------ keys

  key(k: KeyInput): void {
    const keepMessage = this.mode.kind !== 'edit';
    if (!keepMessage) this.message = null;
    switch (this.mode.kind) {
      case 'edit': this.editKey(k); break;
      case 'prompt': this.promptKey(this.mode, k); break;
      case 'save-modified': this.saveModifiedKey(k); break;
      case 'replace-this': this.replaceKey(this.mode, k); break;
      case 'help': this.helpKey(this.mode, k); break;
    }
    if (k.key !== 'k' || !k.ctrl) this.lastCutRow = -1;
  }

  private editKey(k: KeyInput): void {
    if (k.ctrl) { this.typing = false; this.ctrlKey(k.key.toLowerCase()); return; }
    if (k.alt) { this.typing = false; this.altKey(k.key.toLowerCase()); return; }
    if (this.moveKey(k.key)) { this.typing = false; return; }
    const b = this.buf;
    const text = k.key === 'Enter' ? '\n' : k.key === 'Tab' ? '\t' : k.key.length === 1 ? k.key : null;
    if (text !== null) {
      if (!this.typing || text === '\n') b.checkpoint();
      this.typing = text !== '\n';
      b.insert(text);
    } else if (k.key === 'Backspace' || k.key === 'Delete') {
      b.checkpoint();
      this.typing = false;
      if (k.key === 'Backspace') b.backspace(); else b.deleteChar();
    }
  }

  private moveKey(key: string): boolean {
    const b = this.buf;
    const page = Math.max(1, this.height - CHROME_ROWS - 2);
    switch (key) {
      case 'ArrowLeft':
        if (b.col > 0) b.col--; else if (b.row > 0) { b.row--; b.col = b.line.length; }
        return true;
      case 'ArrowRight':
        if (b.col < b.line.length) b.col++; else if (b.row < b.lines.length - 1) { b.row++; b.col = 0; }
        return true;
      case 'ArrowUp': b.row--; b.clamp(); return true;
      case 'ArrowDown': b.row++; b.clamp(); return true;
      case 'Home': b.col = 0; return true;
      case 'End': b.col = b.line.length; return true;
      case 'PageUp': b.row -= page; this.top = Math.max(0, this.top - page); b.clamp(); return true;
      case 'PageDown': b.row += page; this.top += page; b.clamp(); return true;
      default: return false;
    }
  }

  private ctrlKey(c: string): void {
    const b = this.buf;
    switch (c) {
      case 'a': b.col = 0; break;
      case 'e': b.col = b.line.length; break;
      case 'y': this.moveKey('PageUp'); break;
      case 'v': this.moveKey('PageDown'); break;
      case 'd': b.checkpoint(); b.deleteChar(); break;
      case 'h': b.checkpoint(); b.backspace(); break;
      case 'o': this.ask('write', 'File Name to Write', this.path); break;
      case 's': if (this.path) this.write(this.path); else this.ask('write', 'File Name to Write', ''); break;
      case 'x': this.exit(); break;
      case 'k': this.cutLine(); break;
      case 'u': this.paste(); break;
      case 'f': case 'w': this.ask('search', this.lastSearch ? `Search [${this.lastSearch}]` : 'Search', ''); break;
      case '\\': this.ask('replace', this.lastSearch ? `Search (to replace) [${this.lastSearch}]` : 'Search (to replace)', ''); break;
      case 'c': this.message = this.location(); break;
      case 'g': this.mode = { kind: 'help', top: 0 }; break;
      case '/': case '_': this.ask('goto', 'Enter line number, column number', ''); break;
      case 't': this.message = 'Execute Command is not available in Netfix'; break;
      case 'j': this.message = 'Justify is not available in Netfix'; break;
      case 'r': this.message = 'Read File is not available in Netfix'; break;
      default: this.message = 'Unknown command';
    }
  }

  private altKey(c: string): void {
    const b = this.buf;
    if (c === 'u') this.message = b.undo() ? null : 'Nothing to undo';
    else if (c === 'e') this.message = b.redo() ? null : 'Nothing to redo';
    else if (c === 'w') this.search(this.lastSearch);
    else if (c === '\\') { b.row = 0; b.col = 0; }
    else if (c === '/') { b.row = b.lines.length - 1; b.col = b.line.length; }
    else this.message = 'Unknown command';
  }

  private ask(purpose: PromptPurpose, label: string, value: string): void {
    this.mode = { kind: 'prompt', purpose, label, value };
  }

  private promptKey(p: Extract<Mode, { kind: 'prompt' }>, k: KeyInput): void {
    if (k.ctrl && k.key.toLowerCase() === 'c') { this.mode = { kind: 'edit' }; this.message = 'Cancelled'; return; }
    if (k.key === 'Backspace') { p.value = p.value.slice(0, -1); return; }
    if (k.key.length === 1 && !k.ctrl && !k.alt) { p.value += k.key; return; }
    if (k.key !== 'Enter') return;
    this.mode = { kind: 'edit' };
    this.answer(p.purpose, p.value);
  }

  private answer(purpose: PromptPurpose, value: string): void {
    if (purpose === 'write' || purpose === 'exit-write') {
      if (!value) { this.message = 'Cancelled'; return; }
      if (this.write(value) && purpose === 'exit-write') this.closed = true;
      return;
    }
    if (purpose === 'search') { this.search(value || this.lastSearch); return; }
    if (purpose === 'replace') {
      const needle = value || this.lastSearch;
      if (!needle) { this.message = 'Cancelled'; return; }
      this.lastSearch = needle;
      this.ask('replace-with', 'Replace with', '');
      return;
    }
    if (purpose === 'replace-with') { this.startReplace(this.lastSearch, value); return; }
    this.goTo(value);
  }

  // ------------------------------------------------------------ commands

  /** Lines ended by a newline (the final empty line is nano's magic line). */
  private lineCount(): number {
    const l = this.buf.lines;
    return l[l.length - 1] === '' ? l.length - 1 : l.length;
  }

  private content(): string {
    const text = this.buf.lines.join('\n');
    return text === '' || text.endsWith('\n') ? text : `${text}\n`;
  }

  private write(path: string): boolean {
    const error = this.io.save(path, this.content());
    if (error) { this.message = `Error writing ${path}: ${error}`; return false; }
    this.path = path;
    this.buf.modified = false;
    this.message = `Wrote ${plural(this.lineCount(), 'line')}`;
    if (this.buf.lines[this.buf.lines.length - 1] !== '') this.buf.lines.push('');
    return true;
  }

  private exit(): void {
    if (this.buf.modified) this.mode = { kind: 'save-modified' };
    else this.closed = true;
  }

  private saveModifiedKey(k: KeyInput): void {
    const c = k.key.toLowerCase();
    if (k.ctrl && c === 'c') { this.mode = { kind: 'edit' }; this.message = 'Cancelled'; return; }
    if (c === 'n') { this.closed = true; return; }
    if (c === 'y') this.ask('exit-write', 'File Name to Write', this.path);
  }

  private cutLine(): void {
    const b = this.buf;
    b.checkpoint();
    const consecutive = this.lastCutRow === b.row;
    const removed = b.lines.length === 1 && b.line === '' ? [] : b.removeLines(1);
    this.cut = consecutive ? [...this.cut, ...removed] : removed;
    b.col = 0;
    this.lastCutRow = b.row;
  }

  private paste(): void {
    if (!this.cut.length) return;
    const b = this.buf;
    b.checkpoint();
    b.insert(`${this.cut.join('\n')}\n`);
  }

  private search(needle: string): void {
    if (!needle) { this.message = 'No current search pattern'; return; }
    this.lastSearch = needle;
    const hit = this.buf.find(needle, true);
    if (!hit) { this.message = `"${needle}" not found`; return; }
    const same = hit.row === this.buf.row && hit.col === this.buf.col;
    this.buf.row = hit.row;
    this.buf.col = hit.col;
    this.message = same ? 'This is the only occurrence' : hit.wrapped ? 'Search Wrapped' : null;
  }

  private startReplace(needle: string, replacement: string): void {
    const hit = this.buf.find(needle, true, true);
    if (!hit) { this.message = `"${needle}" not found`; return; }
    this.buf.checkpoint();
    this.buf.row = hit.row;
    this.buf.col = hit.col;
    this.mode = { kind: 'replace-this', needle, with: replacement, count: 0, start: { row: hit.row, col: hit.col }, wrapped: false };
  }

  private replaceKey(m: Extract<Mode, { kind: 'replace-this' }>, k: KeyInput): void {
    const c = k.key.toLowerCase();
    if (k.ctrl && c === 'c') { this.endReplace(m.count); return; }
    if (!['y', 'n', 'a'].includes(c) || k.ctrl) return;
    if (c === 'a') {
      while (this.replaceAndAdvance(m, true));
      this.endReplace(m.count);
      return;
    }
    if (!this.replaceAndAdvance(m, c === 'y')) this.endReplace(m.count);
  }

  /** Replaces the match at the cursor (when asked) and moves to the next one; false at the end of the pass. */
  private replaceAndAdvance(m: Extract<Mode, { kind: 'replace-this' }>, replace: boolean): boolean {
    const b = this.buf;
    if (replace) {
      b.setLine(b.row, b.line.slice(0, b.col) + m.with + b.line.slice(b.col + m.needle.length));
      if (b.row === m.start.row && b.col < m.start.col) m.start.col += m.with.length - m.needle.length;
      b.col += Math.max(0, m.with.length - 1);
      m.count++;
    }
    const next = b.find(m.needle, true);
    if (!next) return false;
    if (next.wrapped) m.wrapped = true;
    const pastStart = next.row > m.start.row || (next.row === m.start.row && next.col >= m.start.col);
    if (m.wrapped && pastStart) return false;
    b.row = next.row;
    b.col = next.col;
    return true;
  }

  private endReplace(count: number): void {
    this.mode = { kind: 'edit' };
    this.message = `Replaced ${plural(count, 'occurrence')}`;
  }

  private goTo(value: string): void {
    const [line, col] = value.split(/[,\s]+/).map((n) => Number(n));
    if (!Number.isInteger(line) || line === undefined) { this.message = 'Invalid line or column number'; return; }
    const b = this.buf;
    b.row = line < 0 ? b.lines.length + line : line - 1;
    b.col = col !== undefined && Number.isInteger(col) ? col - 1 : 0;
    b.clamp();
  }

  private location(): string {
    const b = this.buf;
    const total = [...this.content()].length;
    const char = b.lines.slice(0, b.row).reduce((n, l) => n + l.length + 1, 0) + b.col;
    const pct = (a: number, z: number): number => (z ? Math.round((a * 100) / z) : 0);
    return `line ${b.row + 1}/${b.lines.length} (${pct(b.row + 1, b.lines.length)}%), col ${b.col + 1}/${b.line.length + 1} (${pct(b.col + 1, b.line.length + 1)}%), char ${char}/${total} (${pct(char, total)}%)`;
  }

  private helpKey(m: Extract<Mode, { kind: 'help' }>, k: KeyInput): void {
    const c = k.key.toLowerCase();
    if ((k.ctrl && (c === 'x' || c === 'c' || c === 'g')) || k.key === 'Escape' || c === 'q') this.mode = { kind: 'edit' };
    else if (k.key === 'ArrowDown' || k.key === 'PageDown' || (k.ctrl && c === 'v')) m.top = Math.min(HELP_TEXT.length - 1, m.top + (k.key === 'ArrowDown' ? 1 : 10));
    else if (k.key === 'ArrowUp' || k.key === 'PageUp' || (k.ctrl && c === 'y')) m.top = Math.max(0, m.top - (k.key === 'ArrowUp' ? 1 : 10));
  }

  // ------------------------------------------------------------ screen

  frame(width: number, height: number): Frame {
    this.height = height;
    const editRows = Math.max(1, height - CHROME_ROWS);
    const b = this.buf;
    if (b.row < this.top) this.top = b.row;
    if (b.row >= this.top + editRows) this.top = b.row - editRows + 1;
    const name = this.path ? this.path.split('/').pop() ?? this.path : 'New Buffer';
    if (this.mode.kind === 'help') {
      const text = HELP_TEXT.slice(this.mode.top, this.mode.top + editRows);
      const rows: Span[][] = Array.from({ length: editRows }, (_, i) => [{ text: fit(text[i] ?? '', width) }]);
      return { rows: [titleBar('Help', false, width), ...rows, statusRow(null, null, width), ...shortcutRows(HELP_KEYS, width)], cursor: null };
    }
    const area = textArea({ lines: b.lines, top: this.top, row: b.row, col: b.col }, width, editRows, 1);
    const { prompt, keys } = this.chrome();
    const cursor = prompt !== null ? { row: height - 3, col: Math.min(width - 1, prompt.length) } : area.cursor;
    return { rows: [titleBar(name, b.modified, width), ...area.rows, statusRow(this.message, prompt, width), ...shortcutRows(keys, width)], cursor };
  }

  private chrome(): { prompt: string | null; keys: readonly Shortcut[] } {
    const m = this.mode;
    if (m.kind === 'prompt') return { prompt: `${m.label}: ${m.value}`, keys: m.purpose.endsWith('write') ? WRITE_KEYS : PROMPT_KEYS };
    if (m.kind === 'save-modified') return { prompt: 'Save modified buffer? ', keys: YES_NO_KEYS };
    if (m.kind === 'replace-this') return { prompt: 'Replace this instance?', keys: REPLACE_KEYS };
    return { prompt: null, keys: MAIN_KEYS };
  }
}
