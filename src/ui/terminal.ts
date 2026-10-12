/** Console widget for the IOS CLI, cmd.exe and bash: ANSI colours, Tab completion, Ctrl+C/D/L and full-screen editors. */
import { el } from './dom.ts';
import { ansiRow, columns, drawFrame, editorKey, fillAnsi } from './term-render.ts';
import { clearRequest } from '../core/ansi.ts';
import type { AnsiStyle } from '../core/ansi.ts';
import { createEditor } from '../editors/index.ts';
import type { Frame, KeyInput } from '../editors/index.ts';

/** A full-screen program shown instead of the scrollback. */
interface FullScreen {
  key(k: KeyInput): void;
  /** The frame to draw, or null when the program has ended. */
  frame(width: number, height: number): Frame | null;
  /** Output to print when it ends (the shell continues). */
  finish(): string[];
}
import type { EditSpec } from '../bash/types.ts';
import type { Completion } from '../shells/base.ts';

export interface ConsoleBackend {
  prompt(): string;
  run(line: string): string[];
  help?(lineBeforeQuestion: string): string[];
  /** IOS returns the completed line; bash returns the line and every candidate. */
  complete?(line: string): string | Completion | null;
  ctrlZ?(): string[];
  secret?(): boolean;
  /** Subscribe to asynchronous output (logs). Returns an unsubscribe function. */
  onAsync?(cb: (line: string) => void): () => void;
  interrupt?(): string[];
  eof?(): string[];
  editRequest?(): EditSpec | null;
  saveEdit?(path: string, content: string): string | null;
  closeEdit?(): string[];
  screenFrame?(width: number, height: number): Frame | null;
  screenKey?(key: KeyInput): string[];
}

const MAX_LINES = 3000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class Terminal {
  readonly root: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly lineEl: HTMLElement;
  private readonly editorEl: HTMLElement;
  private readonly backend: ConsoleBackend;
  private readonly history: string[] = [];
  private historyIdx = 0;
  private readonly unsubscribe: (() => void) | undefined;
  private readonly afterRun: () => void;
  private style: AnsiStyle = {};
  private full: FullScreen | null = null;
  private lastTab = '';

  /** IOS consoles show lines starting with % (messages) in their own colour. */
  private readonly iosMessages: boolean;

  constructor(backend: ConsoleBackend, opts: { intro?: string[]; label: string; afterRun?: () => void; iosMessages?: boolean }) {
    this.backend = backend;
    this.iosMessages = opts.iosMessages ?? false;
    this.afterRun = opts.afterRun ?? (() => undefined);
    this.screen = el('div', { class: 'term-screen', role: 'log', 'aria-live': 'polite' });
    this.promptEl = el('span', { class: 'term-prompt' });
    this.input = el('input', {
      class: 'term-input', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': opts.label,
    });
    this.lineEl = el('label', { class: 'term-line' }, this.promptEl, this.input);
    this.editorEl = el('div', { class: 'term-editor', tabindex: '0', role: 'application', 'aria-label': `Editor · ${opts.label}`, hidden: true });
    this.root = el('div', { class: 'terminal' }, this.screen, this.lineEl, this.editorEl);
    this.root.addEventListener('click', (e) => {
      if (window.getSelection()?.toString() !== '') return;
      if (this.full) this.editorEl.focus(); else if (e.target !== this.input) this.input.focus();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('input', () => this.onInput());
    this.editorEl.addEventListener('keydown', (e) => this.onEditorKey(e));
    this.editorEl.addEventListener('paste', (e) => this.onEditorPaste(e));
    this.unsubscribe = backend.onAsync?.((l) => this.print([l]));
    this.print(opts.intro ?? []);
    this.refreshPrompt();
  }

  focus(): void {
    (this.full ? this.editorEl : this.input).focus({ preventScroll: true });
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  print(lines: readonly string[]): void {
    if (lines.length === 0) return;
    const frag = document.createDocumentFragment();
    for (const raw of lines) {
      const req = clearRequest(raw);
      if (req.clear) { this.screen.textContent = ''; frag.textContent = ''; if (req.after === '') continue; }
      const r = ansiRow(req.after, this.style, this.iosMessages && raw.startsWith('%') ? 'term-row term-msg' : 'term-row');
      this.style = r.style;
      frag.appendChild(r.row);
    }
    this.screen.appendChild(frag);
    while (this.screen.childElementCount > MAX_LINES) this.screen.firstElementChild?.remove();
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  private refreshPrompt(): void {
    fillAnsi(this.promptEl, this.backend.prompt());
    const secret = this.backend.secret?.() ?? false;
    this.input.classList.toggle('term-secret', secret);
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  private echo(text: string): void {
    const secret = this.backend.secret?.() ?? false;
    this.print([`${this.backend.prompt()}${secret ? '' : text}`]);
  }

  /** Prints a command's output, then opens the editor if a program asked for one. */
  private after(lines: readonly string[]): void {
    this.print(lines);
    this.afterRun();
    this.refreshPrompt();
    this.openFullScreenIfRequested();
  }

  private submit(): void {
    const text = this.input.value;
    this.echo(text);
    this.input.value = '';
    if (text.trim() !== '' && !(this.backend.secret?.() ?? false)) {
      this.history.push(text);
      this.historyIdx = this.history.length;
    }
    this.after(this.backend.run(text));
  }

  /** IOS shows help as soon as `?` is typed, keeping the rest of the line. */
  private onInput(): void {
    const v = this.input.value;
    if (!v.endsWith('?') || !this.backend.help) return;
    const before = v.slice(0, -1);
    this.echo(v);
    this.print(this.backend.help(before));
    this.input.value = before;
    this.refreshPrompt();
  }

  private onKey(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey && !e.altKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
    else if (e.key === 'Tab') { e.preventDefault(); this.complete(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.browseHistory(e.key === 'ArrowUp' ? -1 : 1); }
    else if (ctrl && k === 'z' && this.backend.ctrlZ) {
      e.preventDefault();
      this.echo(`${this.input.value}^Z`);
      this.input.value = '';
      this.after(this.backend.ctrlZ());
    } else if (ctrl && k === 'c' && this.input.selectionStart === this.input.selectionEnd) {
      e.preventDefault();
      this.echo(`${this.input.value}^C`);
      this.input.value = '';
      this.after(this.backend.interrupt?.() ?? []);
    } else if (ctrl && k === 'd' && this.input.value === '' && this.backend.eof) {
      e.preventDefault();
      this.echo('');
      this.after(this.backend.eof());
    } else if (ctrl && k === 'l') {
      e.preventDefault();
      this.screen.textContent = '';
    }
    if (e.key !== 'Tab') this.lastTab = '';
  }

  private complete(): void {
    const value = this.input.value;
    const r = this.backend.complete?.(value);
    if (!r) return;
    if (typeof r === 'string') { this.input.value = r; return; }
    if (r.candidates.length > 1 && r.line === value && this.lastTab === value) {
      this.echo(value);
      this.print(columns(r.candidates, this.cols()));
    }
    this.input.value = r.line;
    this.lastTab = r.line;
  }

  private browseHistory(delta: number): void {
    if (this.history.length === 0) return;
    this.historyIdx = Math.min(this.history.length, Math.max(0, this.historyIdx + delta));
    this.input.value = this.history[this.historyIdx] ?? '';
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  // ------------------------------------------------------------ full-screen programs (nano, vim, mc)

  /** nano/vim run here with a local engine; mc runs where the shell runs and sends frames. */
  private openFullScreenIfRequested(): void {
    if (this.full) return;
    const spec = this.backend.editRequest?.();
    const backend = this.backend;
    if (spec) {
      const editor = createEditor(spec, { save: (path, content) => (backend.saveEdit ? backend.saveEdit(path, content) : 'No se puede guardar') });
      this.full = { key: (k) => editor.key(k), frame: (w, h) => (editor.closed ? null : editor.frame(w, h)), finish: () => backend.closeEdit?.() ?? [] };
    } else if (backend.screenFrame?.(DEFAULT_COLS, DEFAULT_ROWS)) {
      let pending: string[] = [];
      this.full = { key: (k) => { pending = [...pending, ...(backend.screenKey?.(k) ?? [])]; }, frame: (w, h) => backend.screenFrame?.(w, h) ?? null, finish: () => pending };
    } else return;
    this.screen.hidden = true;
    this.lineEl.hidden = true;
    this.editorEl.hidden = false;
    this.redrawEditor();
    this.editorEl.focus({ preventScroll: true });
  }

  private closeFullScreen(): void {
    const finish = this.full?.finish;
    this.full = null;
    this.editorEl.hidden = true;
    this.screen.hidden = false;
    this.lineEl.hidden = false;
    this.after(finish?.() ?? []);
    if (!this.full) this.input.focus({ preventScroll: true });
  }

  private cols(): number {
    const probe = el('span', { class: 'term-probe' }, 'MMMMMMMMMM');
    this.root.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const width = this.root.clientWidth - 24;
    return charWidth > 0 && width > 0 ? Math.max(20, Math.floor(width / charWidth)) : DEFAULT_COLS;
  }

  /** Draws the current frame; returns false when the program has ended. */
  private redrawEditor(): boolean {
    if (!this.full) return false;
    const probe = el('div', { class: 'ed-row term-probe' }, 'M');
    this.editorEl.appendChild(probe);
    const lineHeight = probe.getBoundingClientRect().height;
    probe.remove();
    const rows = lineHeight > 0 ? Math.max(6, Math.floor((this.root.clientHeight - 16) / lineHeight)) : DEFAULT_ROWS;
    const frame = this.full.frame(this.cols(), rows);
    if (frame) drawFrame(this.editorEl, frame);
    return frame !== null;
  }

  private onEditorKey(e: KeyboardEvent): void {
    const k = editorKey(e);
    if (!k || !this.full) return;
    if (k.ctrl && ['v', 'c'].includes(k.key.toLowerCase()) && window.getSelection()?.toString()) return;
    e.preventDefault();
    e.stopPropagation();
    this.full.key(k);
    if (!this.redrawEditor()) this.closeFullScreen();
  }

  private onEditorPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const full = this.full;
    if (!full || !text) return;
    e.preventDefault();
    for (const ch of text.replace(/\r\n?/g, '\n')) full.key({ key: ch === '\n' ? 'Enter' : ch === '\t' ? 'Tab' : ch });
    if (!this.redrawEditor()) this.closeFullScreen();
  }
}
