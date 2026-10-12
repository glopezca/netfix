/** Vim engine (normal, insert and command-line modes) with vim's messages, registers, undo and `.` repeat. */
import type { EditSpec } from '../bash/types.ts';
import type { Editor, EditorIO, Frame, KeyInput, Span } from './buffer.ts';
import { TextBuffer } from './buffer.ts';
import { motion } from './vim-motion.ts';
import type { Motion } from './vim-motion.ts';
import { join, put, remove, replaceChars, toggleCase, yank } from './vim-ops.ts';
import type { Register } from './vim-ops.ts';
import { parseNormal, token } from './vim-keys.ts';
import type { Parsed } from './vim-keys.ts';
import { fileInfo, runEx } from './vim-ex.ts';
import type { ExTarget } from './vim-ex.ts';
import { ruler, statusLine, textRows } from './vim-view.ts';
import type { VimView } from './vim-view.ts';

type Mode = { kind: 'normal' } | { kind: 'insert' } | { kind: 'cmdline'; prefix: ':' | '/' | '?'; text: string };

const SCROLL_HALF = 12;

export class VimEditor implements Editor, ExTarget {
  readonly buf: TextBuffer;
  readonly original: string;
  path: string;
  readOnly: boolean;
  isNew: boolean;
  number = false;
  closed = false;
  private readonly io: EditorIO;
  private mode: Mode = { kind: 'normal' };
  private pending: string[] = [];
  private msg: Span | null;
  private register: Register = { text: '', linewise: false };
  private search: { pattern: string; forward: boolean } | null = null;
  private view: VimView;
  private height = 24;
  private changes = 0;
  private warnedReadOnly = false;
  private recording: KeyInput[] = [];
  private lastChange: KeyInput[] = [];
  private replaying = false;
  private desiredCol = 0;

  constructor(spec: EditSpec, io: EditorIO) {
    this.buf = new TextBuffer(spec.content);
    this.original = spec.content;
    this.io = io;
    this.path = spec.path;
    this.readOnly = spec.readOnly;
    this.isNew = !spec.exists;
    if (spec.line !== undefined) { this.buf.row = spec.line - 1; this.buf.clamp(false); }
    this.view = { lines: this.buf.lines, row: 0, col: 0, number: false, top: 0 };
    const tag = spec.readOnly && spec.exists ? ' [readonly]' : '';
    this.msg = !spec.path ? null : spec.exists ? { text: fileInfo(this, tag) } : { text: `"${spec.path}" [New]` };
  }

  save(path: string, content: string): string | null {
    return this.io.save(path, content);
  }

  message(text: string, error = false): void {
    this.msg = { text, style: error ? 'error' : undefined };
  }

  // ------------------------------------------------------------ keys

  key(k: KeyInput): void {
    if (!this.replaying) this.recording.push(k);
    if (this.mode.kind === 'insert') this.insertKey(k);
    else if (this.mode.kind === 'cmdline') this.cmdlineKey(this.mode, k);
    else this.normalKey(k);
  }

  private insertKey(k: KeyInput): void {
    const b = this.buf;
    if (k.key === 'Escape' || (k.ctrl && k.key === '[') || (k.ctrl && k.key.toLowerCase() === 'c')) {
      this.mode = { kind: 'normal' };
      if (b.col > 0) b.col--;
      this.desiredCol = b.col;
      this.msg = null;
      this.finishChange(true);
      return;
    }
    if (k.ctrl && k.key.toLowerCase() === 'w') { const start = b.line.slice(0, b.col).search(/\S*\s*$/); b.setLine(b.row, b.line.slice(0, start) + b.line.slice(b.col)); b.col = start; return; }
    if (k.ctrl && k.key.toLowerCase() === 'u') { b.setLine(b.row, b.line.slice(b.col)); b.col = 0; return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k.key)) {
      const m = motion(b, k.key, undefined);
      if (m) { b.row = m.row; b.col = k.key === 'End' ? b.lines[m.row]?.length ?? 0 : m.col; b.clamp(); }
      return;
    }
    const text = k.key === 'Enter' ? '\n' : k.key === 'Tab' ? '\t' : k.key.length === 1 && !k.ctrl && !k.alt ? k.key : null;
    if (text !== null) { this.touch(); b.insert(text); return; }
    if (k.key === 'Backspace') { this.touch(); b.backspace(); }
    else if (k.key === 'Delete') { this.touch(); b.deleteChar(); }
  }

  private cmdlineKey(m: Extract<Mode, { kind: 'cmdline' }>, k: KeyInput): void {
    if (k.key === 'Escape' || (k.ctrl && k.key.toLowerCase() === 'c')) { this.mode = { kind: 'normal' }; this.msg = null; return; }
    if (k.key === 'Backspace') {
      if (m.text === '') { this.mode = { kind: 'normal' }; this.msg = null; } else m.text = m.text.slice(0, -1);
      return;
    }
    if (k.key.length === 1 && !k.ctrl && !k.alt) { m.text += k.key; return; }
    if (k.key !== 'Enter') return;
    this.mode = { kind: 'normal' };
    this.msg = null;
    if (m.prefix === ':') {
      const before = this.buf.text();
      runEx(this, m.text);
      if (this.buf.text() !== before) this.changes++;
      this.buf.clamp(false);
    } else {
      this.search = { pattern: m.text || this.search?.pattern || '', forward: m.prefix === '/' };
      this.msg = { text: `${m.prefix}${this.search.pattern}` };
      this.findNext(true, 1);
    }
  }

  private normalKey(k: KeyInput): void {
    if (k.key === 'Escape') { this.pending = []; this.recording = []; return; }
    const t = token(k);
    if (t === null) { this.recording = []; return; }
    this.pending.push(t);
    const p = parseNormal(this.pending);
    if (p.kind === 'more') return;
    this.pending = [];
    if (p.kind === 'bad') { this.recording = []; return; }
    const changed = this.execute(p);
    if (this.mode.kind !== 'insert') this.finishChange(changed);
    this.buf.clamp(this.mode.kind === 'insert');
    if (p.kind !== 'motion') this.desiredCol = this.buf.col;
  }

  /** Remembers the keys of the last change for `.`. */
  private finishChange(changed: boolean): void {
    if (changed && !this.replaying) { this.lastChange = this.recording; this.changes++; }
    if (!this.replaying) this.recording = [];
  }

  private touch(): void {
    if (this.readOnly && !this.warnedReadOnly) {
      this.warnedReadOnly = true;
      this.message('W10: Warning: Changing a readonly file', true);
    }
  }

  // ------------------------------------------------------------ normal commands

  private execute(p: Exclude<Parsed, { kind: 'more' | 'bad' }>): boolean {
    const b = this.buf;
    if (p.kind === 'motion') {
      const m = motion(b, p.key, p.count, p.arg);
      if (!m) return false;
      const vertical = ['j', 'k', 'ArrowUp', 'ArrowDown'].includes(p.key);
      b.row = m.row;
      b.col = vertical ? this.desiredCol : m.col;
      b.clamp(false);
      if (!vertical) this.desiredCol = p.key === '$' ? Number.MAX_SAFE_INTEGER : b.col;
      return false;
    }
    if (p.kind === 'operator') return this.operate(p.op, p.motion, p.count, p.arg);
    return this.command(p.key, p.count, p.arg);
  }

  private operate(op: string, key: string, count: number | undefined, arg?: string): boolean {
    const b = this.buf;
    const n = count ?? 1;
    let m: Motion | null = key === op ? { row: b.row + n - 1, col: 0, linewise: true, inclusive: false } : motion(b, op === 'c' && key === 'w' ? 'e' : key, count, arg);
    if (!m) return false;
    if (m.linewise && m.row >= b.lines.length) m = { ...m, row: b.lines.length - 1 };
    if (op === 'y') { this.register = yank(b, m); return false; }
    b.checkpoint();
    this.touch();
    this.register = remove(b, m, op === 'c');
    if (op === 'c') { this.mode = { kind: 'insert' }; return true; }
    b.clamp(false);
    return true;
  }

  private enterInsert(where: 'i' | 'a' | 'I' | 'A' | 'o' | 'O'): boolean {
    const b = this.buf;
    b.checkpoint();
    if (where === 'a' && b.line.length > 0) b.col++;
    if (where === 'I') b.col = /\S/.exec(b.line)?.index ?? 0;
    if (where === 'A') b.col = b.line.length;
    if (where === 'o' || where === 'O') {
      this.touch();
      b.insertLines(where === 'o' ? b.row + 1 : b.row, ['']);
      if (where === 'o') b.row++;
      b.col = 0;
    }
    this.mode = { kind: 'insert' };
    this.msg = null;
    return true;
  }

  private command(key: string, count: number | undefined, arg?: string): boolean {
    const b = this.buf;
    const n = count ?? 1;
    const edit = (fn: () => void): boolean => { b.checkpoint(); this.touch(); fn(); return true; };
    switch (key) {
      case 'i': case 'a': case 'I': case 'A': case 'o': case 'O': case 'Insert': return this.enterInsert(key === 'Insert' ? 'i' : key);
      case 'x': case 'Delete': return b.line ? this.operate('d', 'l', n) : false;
      case 'X': return b.col > 0 ? this.operate('d', 'h', n) : false;
      case 'D': return this.operate('d', '$', count);
      case 'C': return this.operate('c', '$', count);
      case 's': return b.line ? this.operate('c', 'l', n) : this.enterInsert('i');
      case 'S': return this.operate('c', 'c', n);
      case 'Y': this.operate('y', 'y', n); return false;
      case 'p': case 'P': return this.register.text === '' && !this.register.linewise ? false : edit(() => put(b, this.register, key === 'p', n));
      case 'J': return b.row + 1 < b.lines.length ? edit(() => join(b, n)) : false;
      case 'r': return b.col + n <= b.line.length ? edit(() => replaceChars(b, arg ?? '', n)) : false;
      case '~': return edit(() => toggleCase(b, n));
      case 'u': this.undo(); return false;
      case '<C-r>': this.redo(); return false;
      case '.': this.repeat(); return false;
      case 'n': case 'N': this.findNext(key === 'n', n); return false;
      case '*': case '#': this.searchWord(key === '*'); return false;
      case ':': case '/': case '?': this.mode = { kind: 'cmdline', prefix: key, text: '' }; return false;
      case 'Z': runEx(this, arg === 'Z' ? 'x' : arg === 'Q' ? 'q!' : ''); return false;
      default: this.scroll(key); return false;
    }
  }

  private scroll(key: string): void {
    const b = this.buf;
    const page = Math.max(1, this.height - 3);
    const delta: Record<string, number> = { '<C-f>': page, PageDown: page, '<C-b>': -page, PageUp: -page, '<C-d>': SCROLL_HALF, '<C-u>': -SCROLL_HALF };
    if (key in delta) { b.row += delta[key] ?? 0; b.clamp(false); this.view.top = Math.max(0, this.view.top + (delta[key] ?? 0)); return; }
    if (key === '<C-g>') this.message(`${fileInfo(this, b.modified ? ' [Modified]' : '')} --${Math.round(((b.row + 1) * 100) / b.lines.length)}%--`);
    if (key === 'v' || key === 'V' || key === 'R') this.message('-- VISUAL / REPLACE no disponibles en Netfix --', true);
  }

  private undo(): void {
    if (!this.buf.undo()) { this.message('Already at oldest change'); return; }
    this.message(`1 change; before #${this.changes}  0 seconds ago`);
    this.changes = Math.max(0, this.changes - 1);
    this.buf.clamp(false);
  }

  private redo(): void {
    if (!this.buf.redo()) { this.message('Already at newest change'); return; }
    this.changes++;
    this.message(`1 change; after #${this.changes}  0 seconds ago`);
    this.buf.clamp(false);
  }

  private repeat(): void {
    if (!this.lastChange.length) return;
    this.replaying = true;
    try {
      for (const k of this.lastChange) this.key(k);
    } finally {
      this.replaying = false;
    }
  }

  // ------------------------------------------------------------ search

  private regex(): RegExp | null {
    if (!this.search?.pattern) return null;
    try {
      return new RegExp(this.search.pattern.replace(/\\</g, '\\b').replace(/\\>/g, '\\b'));
    } catch {
      return new RegExp(this.search.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }

  private findNext(sameDirection: boolean, count: number): void {
    const re = this.regex();
    if (!re || !this.search) { this.message('E35: No previous regular expression', true); return; }
    const forward = sameDirection === this.search.forward;
    for (let i = 0; i < count; i++) if (!this.step(re, forward)) return;
  }

  private step(re: RegExp, forward: boolean): boolean {
    const b = this.buf;
    const n = b.lines.length;
    for (let i = 0; i <= n; i++) {
      const r = forward ? (b.row + i) % n : (b.row - i + 2 * n) % n;
      const line = b.lines[r] ?? '';
      const cols = [...line.matchAll(new RegExp(re.source, 'g'))].map((m) => m.index ?? 0);
      const col = i === 0 ? (forward ? cols.find((c) => c > b.col) : [...cols].reverse().find((c) => c < b.col))
        : forward ? cols[0] : cols[cols.length - 1];
      if (col === undefined) continue;
      const wrapped = i === n || (forward ? r < b.row : r > b.row);
      if (wrapped) this.message(forward ? 'search hit BOTTOM, continuing at TOP' : 'search hit TOP, continuing at BOTTOM', true);
      b.row = r;
      b.col = col;
      return true;
    }
    this.message(`E486: Pattern not found: ${this.search?.pattern ?? ''}`, true);
    return false;
  }

  private searchWord(forward: boolean): void {
    const b = this.buf;
    const m = /\w+/.exec(b.line.slice(b.col)) ?? /\w+$/.exec(b.line.slice(0, b.col + 1));
    if (!m) { this.message('E348: No string under cursor', true); return; }
    this.search = { pattern: `\\<${m[0]}\\>`, forward };
    this.msg = { text: `${forward ? '/' : '?'}\\<${m[0]}\\>` };
    this.findNext(true, 1);
  }

  // ------------------------------------------------------------ screen

  frame(width: number, height: number): Frame {
    this.height = height;
    const textHeight = Math.max(1, height - 1);
    const b = this.buf;
    this.view = { lines: b.lines, row: b.row, col: b.col, number: this.number, top: this.view.top };
    const area = textRows(this.view, width, textHeight);
    const m = this.mode;
    let left: Span | null = this.msg;
    let cursor = area.cursor;
    if (m.kind === 'insert' && this.msg?.style !== 'error') left = { text: '-- INSERT --', style: 'bold' };
    if (m.kind === 'cmdline') {
      left = { text: `${m.prefix}${m.text}` };
      cursor = { row: height - 1, col: Math.min(width - 1, m.text.length + 1) };
    }
    const status = statusLine(left, m.kind === 'cmdline' ? null : ruler(this.view, textHeight), width);
    return { rows: [...area.rows, status], cursor };
  }
}
