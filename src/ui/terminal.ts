/** Console widget used for the IOS CLI and the PC command prompt. */
import { el } from './dom.ts';

export interface ConsoleBackend {
  prompt(): string;
  run(line: string): string[];
  help?(lineBeforeQuestion: string): string[];
  complete?(line: string): string | null;
  ctrlZ?(): string[];
  secret?(): boolean;
  /** Subscribe to asynchronous output (logs). Returns an unsubscribe function. */
  onAsync?(cb: (line: string) => void): () => void;
}

const MAX_LINES = 3000;

export class Terminal {
  readonly root: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly backend: ConsoleBackend;
  private readonly history: string[] = [];
  private historyIdx = 0;
  private readonly unsubscribe: (() => void) | undefined;
  private readonly afterRun: () => void;

  constructor(backend: ConsoleBackend, opts: { intro?: string[]; label: string; afterRun?: () => void }) {
    this.backend = backend;
    this.afterRun = opts.afterRun ?? (() => undefined);
    this.screen = el('div', { class: 'term-screen', role: 'log', 'aria-live': 'polite' });
    this.promptEl = el('span', { class: 'term-prompt' });
    this.input = el('input', {
      class: 'term-input', type: 'text', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': opts.label,
    });
    const line = el('label', { class: 'term-line' }, this.promptEl, this.input);
    this.root = el('div', { class: 'terminal' }, this.screen, line);
    this.root.addEventListener('click', (e) => {
      if (window.getSelection()?.toString() === '' && e.target !== this.input) this.input.focus();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('input', () => this.onInput());
    this.unsubscribe = backend.onAsync?.((l) => this.print([l]));
    this.print(opts.intro ?? []);
    this.refreshPrompt();
  }

  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  print(lines: readonly string[]): void {
    if (lines.length === 0) return;
    const frag = document.createDocumentFragment();
    for (const l of lines) frag.appendChild(el('div', { class: l.startsWith('%') ? 'term-row term-msg' : 'term-row' }, l === '' ? ' ' : l));
    this.screen.appendChild(frag);
    while (this.screen.childElementCount > MAX_LINES) this.screen.firstElementChild?.remove();
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  private refreshPrompt(): void {
    this.promptEl.textContent = this.backend.prompt();
    const secret = this.backend.secret?.() ?? false;
    this.input.classList.toggle('term-secret', secret);
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  private echo(text: string): void {
    const secret = this.backend.secret?.() ?? false;
    this.print([`${this.backend.prompt()}${secret ? '' : text}`]);
  }

  private submit(): void {
    const text = this.input.value;
    this.echo(text);
    this.input.value = '';
    if (text.trim() !== '' && !(this.backend.secret?.() ?? false)) {
      this.history.push(text);
      this.historyIdx = this.history.length;
    }
    this.print(this.backend.run(text));
    this.afterRun();
    this.refreshPrompt();
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
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const done = this.backend.complete?.(this.input.value);
      if (done) this.input.value = done;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.browseHistory(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      this.echo(`${this.input.value}^Z`);
      this.input.value = '';
      this.print(this.backend.ctrlZ?.() ?? []);
      this.afterRun();
      this.refreshPrompt();
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && this.input.selectionStart === this.input.selectionEnd) {
      e.preventDefault();
      this.echo(`${this.input.value}^C`);
      this.input.value = '';
    }
  }

  private browseHistory(delta: number): void {
    if (this.history.length === 0) return;
    this.historyIdx = Math.min(this.history.length, Math.max(0, this.historyIdx + delta));
    this.input.value = this.history[this.historyIdx] ?? '';
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }
}
