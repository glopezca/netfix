/** Interactive bash session: startup files, prompts, continuation lines, history, interactions, Ctrl+C/Ctrl+D. */
import type { EditSpec, Gen, HostEnv, Interaction, ScreenApp, UserInfo } from './types.ts';
import { AbortSignal, DiscardSignal, ExitSignal } from './types.ts';
import { Interp, runSync, freshBudget } from './interp.ts';
import { initVariables } from './startup.ts';
import { ttyFds } from './io.ts';
import { parse, IncompleteInput, BashSyntaxError } from './parser.ts';
import { HistoryError } from './history.ts';
import { complete } from './complete.ts';
import type { Completion } from './complete.ts';

export interface ShellOptions {
  readonly login?: boolean;
  /** Runs nothing at start-up (tests). */
  readonly noRc?: boolean;
}

const JOB_PAD = 24;

export class BashSession {
  readonly sh: Interp;
  closed = false;
  exitCode = 0;
  private out = '';
  private buffer = '';
  private gen: Gen<number> | null = null;
  private waiting: Interaction | null = null;
  private promptPrefix = '';
  private child: BashSession | null = null;

  constructor(env: HostEnv, user: UserInfo, opts: ShellOptions = {}) {
    this.sh = new Interp(env, user, { interactive: true, term: (t) => { this.out += t; } });
    initVariables(this.sh);
    if (this.sh.getVar('PS1') === undefined) this.sh.setVar('PS1', '\\s-\\v\\$ ');
    this.sh.cwd = env.fs.tryLookup(user.home, this.sh.cred)?.kind === 'dir' ? user.home : '/';
    this.sh.setVar('PWD', this.sh.cwd, { export: true });
    this.sh.loginShell = Boolean(opts.login);
    this.sh.controllingTty = true;
    this.sh.shopt.set('login_shell', Boolean(opts.login));
    this.loadHistory();
    if (!opts.noRc) this.startup(Boolean(opts.login));
    this.out = '';
  }

  private startup(login: boolean): void {
    const files = login ? ['/etc/profile', `${this.sh.user.home}/.profile`] : ['/etc/bash.bashrc', `${this.sh.user.home}/.bashrc`];
    for (const f of files) {
      if (!this.sh.env.fs.tryLookup(f, this.sh.cred)) continue;
      try {
        runSync(this.sh.invoke(['source', f], ttyFds()));
      } catch (e) {
        if (!(e instanceof ExitSignal || e instanceof AbortSignal)) throw e;
      }
    }
    this.sh.status = 0;
  }

  private loadHistory(): void {
    try {
      const text = this.sh.env.fs.readFile(`${this.sh.user.home}/.bash_history`, this.sh.cred);
      this.sh.history.lines.push(...text.split('\n').filter(Boolean).slice(-1000));
    } catch {
      // no history yet
    }
  }

  // ------------------------------------------------------------ prompt and state

  /** A shell variable of the session (not of a nested shell), as `echo "$NAME"` would show it. */
  variable(name: string): string | undefined {
    return this.sh.getVar(name);
  }

  /** NAME=value in the session (not in a nested shell); undefined is `unset NAME`. */
  assign(name: string, value: string | undefined): void {
    if (value === undefined) this.sh.vars.unset(name);
    else this.sh.setVar(name, value);
  }

  prompt(): string {
    if (this.child) return this.child.prompt();
    if (this.waiting?.kind === 'line') return this.promptPrefix + this.waiting.prompt;
    if (this.buffer) return this.sh.prompt(this.sh.getVar('PS2') ?? '> ');
    return this.sh.prompt(this.sh.getVar('PS1') ?? '\\s-\\v\\$ ');
  }

  secret(): boolean {
    if (this.child) return this.child.secret();
    return this.waiting?.kind === 'line' && this.waiting.secret;
  }

  /** The interaction the session is paused on (edit / ssh), for the terminal adapter. */
  pending(): Interaction | null {
    if (this.child) return this.child.pending();
    return this.waiting && this.waiting.kind !== 'line' ? this.waiting : null;
  }

  editRequest(): EditSpec | null {
    const p = this.pending();
    return p?.kind === 'edit' ? p.spec : null;
  }

  /** The full-screen program the session is paused on (mc), if any. */
  screen(): ScreenApp | null {
    const p = this.pending();
    return p?.kind === 'screen' ? p.app : null;
  }

  // ------------------------------------------------------------ input

  /** One line typed by the user; returns the output text produced. */
  input(line: string): string {
    if (this.child) return this.forwardToChild((c) => c.input(line));
    if (this.waiting?.kind === 'line') {
      this.waiting = null;
      this.promptPrefix = '';
      return this.step(line);
    }
    if (this.waiting) return '';
    return this.command(line);
  }

  private command(line: string): string {
    let text = line;
    if (this.sh.opt('histexpand') && !this.buffer) {
      try {
        const expanded = this.sh.historyExpand(text);
        if (expanded !== null) {
          const printOnly = expanded.startsWith('\u0000p');
          text = printOnly ? expanded.slice(2) : expanded;
          this.out += `${text}\n`;
          if (printOnly) { this.sh.history.lines.push(text); return this.flush(); }
        }
      } catch (e) {
        if (e instanceof HistoryError) { this.sh.error(e.message); this.sh.status = 1; return this.flush(); }
        throw e;
      }
    }
    const src = this.buffer ? `${this.buffer}\n${text}` : text;
    try {
      parse(src, true);
    } catch (e) {
      if (e instanceof IncompleteInput) { this.buffer = src; return this.flush(); }
      if (e instanceof BashSyntaxError) {
        this.buffer = '';
        this.remember(src);
        this.sh.error(e.message);
        this.sh.status = 2;
        return this.flush();
      }
      throw e;
    }
    this.buffer = '';
    if (src.trim() === '') return this.flush();
    this.remember(src);
    this.sh.budget = freshBudget();
    this.sh.commandNumber++;
    this.gen = this.sh.runSource(src, this.sh.fdOverride ?? ttyFds(), true);
    return this.step(null);
  }

  /** cmdhist: a multi-line command is saved as one line. */
  private historyText(src: string): string {
    if (!src.includes('\n') || !this.sh.shoptOn('cmdhist') || this.sh.shoptOn('lithist')) return src;
    return src.split('\n').reduce((acc, l) => (acc === '' ? l : /(\b(do|then|else|in)|[{|(]|&&|\|\||;)\s*$/.test(acc) ? `${acc} ${l.trim()}` : `${acc}; ${l.trim()}`), '');
  }

  private remember(raw: string): void {
    const src = this.historyText(raw);
    const control = this.sh.getVar('HISTCONTROL') ?? '';
    const lines = this.sh.history.lines;
    if (/ignorespace|ignoreboth/.test(control) && src.startsWith(' ')) return;
    if (/ignoredups|ignoreboth/.test(control) && lines[lines.length - 1] === src) return;
    lines.push(src);
    const max = Number(this.sh.getVar('HISTSIZE') ?? 1000) || 1000;
    if (lines.length > max) { lines.splice(0, lines.length - max); this.sh.history.base += 1; }
  }

  /** Advances the running command until it ends or needs an interaction. */
  private step(answer: string | null): string {
    if (!this.gen) return this.flush();
    try {
      const r = this.gen.next(answer);
      if (r.done) {
        this.gen = null;
        this.sh.status = r.value;
        this.afterCommand();
      } else this.pause(r.value);
    } catch (e) {
      this.gen = null;
      this.handleError(e);
    }
    return this.flush();
  }

  private pause(i: Interaction): void {
    if (i.kind === 'shell') {
      this.child = new BashSession(this.sh.env, i.user, { login: i.login });
      this.child.sh.setVar('SHLVL', String(Number(this.sh.getVar('SHLVL') ?? 1) + 1), { export: true });
      this.waiting = i;
      return;
    }
    this.waiting = i;
    if (i.kind === 'line' && !this.out.endsWith('\n') && this.out !== '') {
      const nl = this.out.lastIndexOf('\n');
      this.promptPrefix = this.out.slice(nl + 1);
      this.out = this.out.slice(0, nl + 1);
    }
  }

  private handleError(e: unknown): void {
    if (e instanceof ExitSignal) { this.close(e.code); return; }
    if (e instanceof AbortSignal) {
      if (e.note) this.out += `${e.note}\n`;
      this.sh.status = e.code;
      return;
    }
    if (e instanceof DiscardSignal) { this.sh.status = e.code; return; }
    if (e instanceof RangeError) {
      // recursion through source, eval or substitutions deeper than the JavaScript stack
      this.sh.error('maximum recursion depth exceeded');
      this.recover();
      return;
    }
    throw e;
  }

  /** Leaves every function, sourced file and loop of an aborted command. */
  private recover(): void {
    const sh = this.sh;
    sh.vars.resetScopes();
    sh.funcNames = [];
    sh.sourcing = 0;
    sh.loopDepth = 0;
    sh.trapDepth = 0;
    sh.conditionDepth = 0;
    sh.activeAliases.clear();
    sh.status = 1;
  }

  private afterCommand(): void {
    for (const j of this.sh.jobs) this.out += `[${j.id}]+  ${(j.status ? `Exit ${j.status}` : 'Done').padEnd(JOB_PAD)}${j.source}\n`;
    this.sh.finishedJobs.push(...this.sh.jobs);
    this.sh.jobs = [];
    const pc = this.sh.getVar('PROMPT_COMMAND');
    if (pc) { try { runSync(this.sh.runSource(pc, ttyFds())); } catch (e) { if (!(e instanceof AbortSignal)) throw e; } }
  }

  /** Finishes the current interaction (editor closed, ssh session ended…) and continues. */
  resume(answer: string | null = null): string {
    if (this.child) return this.forwardToChild((c) => c.resume(answer));
    this.waiting = null;
    return this.step(answer);
  }

  private forwardToChild(fn: (c: BashSession) => string): string {
    const child = this.child as BashSession;
    const text = fn(child);
    if (!child.closed) return text;
    this.child = null;
    this.waiting = null;
    this.out += text;
    return this.step(String(child.exitCode));
  }

  private close(code: number): void {
    this.sh.runTrap('EXIT');
    if (this.sh.loginShell && this.sh.env.fs.tryLookup(`${this.sh.user.home}/.bash_logout`, this.sh.cred)) {
      try { runSync(this.sh.invoke(['source', `${this.sh.user.home}/.bash_logout`], ttyFds())); } catch { /* ignore errors while leaving */ }
    }
    this.saveHistory();
    this.closed = true;
    this.exitCode = code;
  }

  private saveHistory(): void {
    try {
      const file = this.sh.getVar('HISTFILE') ?? `${this.sh.user.home}/.bash_history`;
      const max = Number(this.sh.getVar('HISTFILESIZE') ?? 2000) || 2000;
      this.sh.env.fs.writeFile(file, `${this.sh.history.lines.slice(-max).join('\n')}\n`, this.sh.cred, false, 0o600);
    } catch {
      // read-only home or quota: history is not saved, like bash
    }
  }

  // ------------------------------------------------------------ keys

  /** Ctrl+C */
  interrupt(): string {
    if (this.child) return this.forwardToChild((c) => c.interrupt());
    this.buffer = '';
    if (this.gen) {
      try {
        this.gen.throw(new AbortSignal(130, ''));
      } catch (e) {
        this.handleError(e);
      }
      this.gen = null;
      this.waiting = null;
      this.promptPrefix = '';
      this.sh.status = 130;
    }
    return this.flush();
  }

  /** Ctrl+D: end of input for `read`/`cat`, or leaves the shell at an empty prompt. */
  eof(): string {
    if (this.child) return this.forwardToChild((c) => c.eof());
    if (this.waiting && this.waiting.kind !== 'line') return '';
    if (this.waiting?.kind === 'line') { this.waiting = null; this.promptPrefix = ''; return this.step(null); }
    if (this.buffer) { this.buffer = ''; this.sh.error('syntax error: unexpected end of file'); return this.flush(); }
    this.out += this.sh.loginShell ? 'logout\n' : 'exit\n';
    this.close(this.sh.status);
    return this.flush();
  }

  /** Runs a line as if typed (used by the SSH server for remote commands). */
  runLine(line: string): string {
    return this.input(line);
  }

  complete(line: string): Completion {
    if (this.child) return this.child.complete(line);
    return complete(this.sh, line);
  }

  private flush(): string {
    const t = this.out;
    this.out = '';
    return t;
  }
}
