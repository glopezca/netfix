/**
 * The cmd.exe interpreter around the Windows terminal's commands: %VAR% expansion, & && || chains, | pipes, < input,
 * ( ) groups, set (set /a, set /p), if, for (for /l, for /f), and batch files (.bat / .cmd) with @, echo off,
 * rem / ::, labels, goto, call, shift, pause and exit /b. The terminal runs each simple command (WinCmdHost.simple).
 */
import { arith, batchArgs, closingParen, condition, expandLine, openParens, splitChain, type Link } from './win-cmd-parse.ts';
import { forFHeader, forFLines, splitPipe, takeInput, type ForF } from './win-cmd-io.ts';
import { hasWildcard } from './win-path.ts';

export interface WinCmdHost {
  /** The system's variables (Path, USERNAME…), by their usual names. */
  env(): Record<string, string>;
  /** One simple command (with its quotes and > redirection), reading `input` (a pipe or <) if it reads any. */
  simple(text: string, input: readonly string[] | null): { out: string[]; code?: number };
  prompt(): string;
  /** Linux path of a Windows path from the current folder, or null (another drive). */
  path(input: string): string | null;
  kindOf(path: string): 'file' | 'dir' | null;
  read(path: string): string | null;
  /** The names a wildcard matches (for and if exist). */
  glob(pattern: string): readonly string[];
}

interface Frame {
  readonly name: string;
  readonly lines: readonly string[];
  pc: number;
  args: string[];
  readonly echo: { on: boolean };
  done: boolean;
  readonly depth: number;
}

/** set /p waiting for the answer typed at its prompt; what was left of its line runs after it. */
interface Waiting {
  readonly name: string;
  readonly prompt: string;
  readonly f: Frame | null;
  rest: readonly Link[] | null;
}

const SYNTAX = ['The syntax of the command is incorrect.'];
/** A batch file running in a loop is cut off after this many lines (cmd.exe would run until Ctrl+C). */
export const MAX_BATCH_STEPS = 10_000;
const MAX_DEPTH = 16;
// shortcut: a command without its own exit code gets it from its output (a Windows error message = 1).
const FAILED = /not recognized|Invalid Command|cannot find|syntax of the command|Access is denied|File Not Found|could not|is invalid|FAILED|not defined|Divide by zero|unable to|already exists|No such directory/i;

const unquote = (s: string): string => (s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s);

export class WinCmd {
  private readonly host: WinCmdHost;
  /** Variables set with set (their own case kept), on top of the system's. */
  private readonly vars = new Map<string, [string, string]>();
  private errorlevel = 0;
  private steps = 0;
  /** Batch files run so far: a command that was one keeps the errorlevel its exit /b left. */
  private batches = 0;
  /** The batch files running, innermost last (set /p leaves them here to go on after its answer). */
  private stack: Frame[] = [];
  private waiting: Waiting | null = null;

  constructor(host: WinCmdHost) {
    this.host = host;
  }

  get(name: string): string | undefined {
    const key = name.toLowerCase();
    const own = this.vars.get(key);
    if (own) return own[1];
    if (key === 'errorlevel') return String(this.errorlevel);
    if (key === 'cd') return this.host.prompt().replace(/>$/, '');
    return Object.entries(this.host.env()).find(([k]) => k.toLowerCase() === key)?.[1];
  }

  /** The prompt of a set /p waiting for its answer, or null. */
  get asking(): string | null {
    return this.waiting?.prompt ?? null;
  }

  /** A line typed at the prompt. */
  run(line: string): string[] {
    this.steps = 0;
    this.stack = [];
    return this.line(expandLine(line, { get: (n) => this.get(n) }), null);
  }

  /** The answer to set /p: the variable takes it, then its line and the batch files waiting go on. */
  answer(text: string): string[] {
    const w = this.waiting;
    if (!w) return [];
    this.waiting = null;
    this.steps = 0;
    this.assign(w.name, text);
    const out = w.rest ? this.links(w.rest, w.f) : [];
    while (this.stack.length && !this.waiting) {
      out.push(...this.loop(this.stack[this.stack.length - 1] as Frame));
      if (!this.waiting) this.stack.pop();
    }
    return out;
  }

  /** Ctrl+C at a set /p prompt: the batch files stop. */
  cancel(): void {
    this.waiting = null;
    this.stack = [];
  }

  /** A file's lines (nul: none), or null when it cannot be read. */
  readLines(name: string): string[] | null {
    if (name.toLowerCase() === 'nul') return [];
    const path = this.host.path(name);
    const text = path === null || this.host.kindOf(path) !== 'file' ? null : this.host.read(path);
    if (text === null) return null;
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return lines;
  }

  /** A line already expanded: its chain, piece by piece. */
  private line(text: string, f: Frame | null): string[] {
    return this.links(splitChain(text), f);
  }

  private links(list: readonly Link[], f: Frame | null): string[] {
    const out: string[] = [];
    for (const [i, link] of list.entries()) {
      if (f?.done || this.waiting) break;
      if ((link.op === '&&' && this.errorlevel !== 0) || (link.op === '||' && this.errorlevel === 0)) continue;
      out.push(...this.pipeline(link.text, f));
      // The innermost chain keeps its rest; shortcut: the rest of an outer for loop or ( ) block around set /p is not run.
      const w = this.waiting as Waiting | null;
      if (w && !w.rest) w.rest = list.slice(i + 1);
    }
    return out;
  }

  /** a | b | c: each command reads what the one before wrote. */
  private pipeline(text: string, f: Frame | null): string[] {
    const stages = splitPipe(text);
    if (stages.length === 1) return this.piece(text, f, null, false);
    if (stages.some((s) => !s.trim())) { this.errorlevel = 1; return SYNTAX; }
    let input: string[] | null = null;
    for (const [i, s] of stages.entries()) input = this.piece(s, f, input, i > 0);
    return input ?? [];
  }

  private piece(raw: string, f: Frame | null, piped: readonly string[] | null, inPipe: boolean): string[] {
    const red = takeInput(raw);
    const input = red.path === null ? piped : this.readLines(red.path);
    if (red.path !== null && input === null) { this.errorlevel = 1; return ['The system cannot find the file specified.']; }
    const lead = red.text.replace(/^\s*@?\s*/, '');
    const t = lead.trimEnd();
    if (!t || t.startsWith('::') || t.startsWith(':')) return [];
    if (t.startsWith('(')) {
      const end = closingParen(t, 0);
      if (end === t.length - 1) return this.line(t.slice(1, -1), f);
    }
    const m = /^([^\s(=;,]+)\s*(.*)$/s.exec(lead);
    const word = (m?.[1] ?? '').toLowerCase();
    const rest = m?.[2] ?? '';
    switch (word) {
      case 'set': return this.set(rest, f, input, inPipe);
      case 'if': return this.ifCmd(rest, f);
      case 'for': return this.forCmd(rest, f);
      case 'pause': return ['Press any key to continue . . .'];
      case 'rem': case 'setlocal': case 'endlocal': return [];
      case 'goto': return f ? this.goto(f, rest.trim().replace(/^:/, '')) : [];
      case 'shift': if (f) f.args = [f.args[0] ?? '', ...f.args.slice(2)]; return [];
      case 'call': return this.call(rest, f);
      case 'exit': if (f && /^\/b\b/i.test(rest)) return this.exitBatch(f, rest);
        break;
      case 'echo': if (/^(on|off)\s*$/i.test(rest)) { if (f) f.echo.on = /^on/i.test(rest); return []; }
        if (f && !rest.trim() && !/^echo[.:(]/i.test(t)) return [`ECHO is ${f.echo.on ? 'on' : 'off'}.`];
        break;
      default: break;
    }
    if (f && word === 'exit') { f.done = true; return []; }
    const before = this.batches;
    const r = this.host.simple(t, input);
    if (this.batches === before) this.errorlevel = r.code ?? (r.out.some((l) => FAILED.test(l)) ? 1 : 0);
    return r.out;
  }

  // ------------------------------------------------------------ set

  private set(rest: string, f: Frame | null, input: readonly string[] | null, inPipe: boolean): string[] {
    const r = rest.trim();
    if (/^\/p\b/i.test(r)) return this.setPrompt(rest.replace(/^\s*\/p\s*/i, ''), f, input, inPipe);
    // At the prompt set /a prints the result; a batch file does not.
    if (/^\/a\b/i.test(r)) { const out = this.setArith(r.slice(2)); return f ? [] : out; }
    if (!r) return this.listVars('');
    const a = r.startsWith('"') ? r.slice(1, r.lastIndexOf('"') > 0 ? r.lastIndexOf('"') : undefined) : r;
    const eq = a.indexOf('=');
    if (eq < 0) return this.listVars(a);
    if (eq === 0) return SYNTAX;
    const name = a.slice(0, eq);
    const value = a.slice(eq + 1);
    if (value === '') this.vars.delete(name.toLowerCase());
    else this.vars.set(name.toLowerCase(), [name, value]);
    this.errorlevel = 0;
    return [];
  }

  /** set /p NAME=prompt: the first line of < input, or the answer typed (in a pipe it runs apart and sets nothing). */
  private setPrompt(spec: string, f: Frame | null, input: readonly string[] | null, inPipe: boolean): string[] {
    const a = spec.startsWith('"') ? spec.slice(1, spec.lastIndexOf('"') > 0 ? spec.lastIndexOf('"') : undefined) : spec;
    const eq = a.indexOf('=');
    if (eq < 0) return SYNTAX;
    const name = a.slice(0, eq);
    const prompt = a.slice(eq + 1);
    if (input === null) {
      this.waiting = { name, prompt, f, rest: null };
      return [];
    }
    this.assign(inPipe ? '' : name, inPipe ? '' : (input[0] ?? ''));
    return prompt ? [prompt] : [];
  }

  /** What set /p read: an empty answer leaves the variable as it was and errorlevel 1. */
  private assign(name: string, value: string): void {
    if (!name || !value) { this.errorlevel = 1; return; }
    this.vars.set(name.toLowerCase(), [name, value]);
    this.errorlevel = 0;
  }

  private listVars(prefix: string): string[] {
    const all = new Map<string, string>(Object.entries(this.host.env()).map(([k, v]) => [k.toLowerCase(), `${k}=${v}`]));
    for (const [key, [name, value]] of this.vars) all.set(key, `${name}=${value}`);
    const shown = [...all].filter(([k]) => k.startsWith(prefix.toLowerCase())).sort(([a], [b]) => a.localeCompare(b)).map(([, line]) => line);
    this.errorlevel = shown.length ? 0 : 1;
    return shown.length ? shown : [`Environment variable ${prefix} not defined`];
  }

  private setArith(expr: string): string[] {
    const r = arith(expr, (n) => this.get(n));
    if (typeof r === 'string') { this.errorlevel = 1; return [r]; }
    for (const [name, value] of r.sets) this.vars.set(name.toLowerCase(), [name, value]);
    this.errorlevel = 0;
    return [String(r.last)];
  }

  // ------------------------------------------------------------ if and for

  private exists(p: string): boolean {
    if (hasWildcard(p)) return this.host.glob(p).length > 0;
    const path = this.host.path(p);
    return path !== null && this.host.kindOf(path) !== null;
  }

  private ifCmd(rest: string, f: Frame | null): string[] {
    const c = condition(rest.trim(), { get: (n) => this.get(n), errorlevel: this.errorlevel, exists: (p) => this.exists(p) });
    if (!c || !c.rest) return SYNTAX;
    let then = c.rest;
    let otherwise = '';
    if (then.startsWith('(')) {
      const end = closingParen(then, 0);
      if (end < 0) return SYNTAX;
      const after = then.slice(end + 1).trim();
      then = then.slice(1, end);
      if (/^else\b/i.test(after)) otherwise = after.slice(4).trim();
    }
    return this.line(c.ok ? then : otherwise, f);
  }

  /** for %v in (set) do cmd, for /l %v in (start,step,end) do cmd and for /f (%%v in a batch file). */
  private forCmd(rest: string, f: Frame | null): string[] {
    if (/^\/f\b/i.test(rest.trim())) return this.forF(rest.trim(), f);
    const m = /^(\/l\s+)?%(\w)\s+in\s*\(([^)]*)\)\s*do\s+(.+)$/is.exec(rest.trim());
    if (!m) return SYNTAX;
    const [, numeric, v = '', set = '', body = ''] = m;
    let values: string[];
    if (numeric) {
      const [start = 0, step = 1, end = 0] = set.split(/[\s,]+/).filter(Boolean).map((x) => Number.parseInt(x, 10) || 0);
      values = [];
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
        if (step === 0 || values.length >= MAX_BATCH_STEPS) break;
        values.push(String(i));
      }
    } else {
      values = batchArgs(set.replace(/[,;]/g, ' ')).flatMap((item) => (hasWildcard(item) ? this.host.glob(unquote(item)) : [item]));
    }
    return this.turns(values.map((value) => new Map([[v, value]])), body, f);
  }

  /** Runs the body once per turn with its loop variables replaced; every turn counts against the batch limit. */
  private turns(all: readonly ReadonlyMap<string, string>[], body: string, f: Frame | null): string[] {
    const out: string[] = [];
    for (const vars of all) {
      if (f?.done || this.waiting) break;
      if (++this.steps > MAX_BATCH_STEPS) { out.push(`^C (Netfix stopped the for loop after ${MAX_BATCH_STEPS} turns)`); if (f) f.done = true; break; }
      const re = new RegExp(`%([${[...vars.keys()].map((k) => k.replace(/[\\\]^-]/g, '\\$&')).join('')}])`, 'g');
      out.push(...this.line(body.replace(re, (all1, k: string) => vars.get(k) ?? all1), f));
    }
    return out;
  }

  /** for /f ["options"] %v in (files | "string" | 'command') do cmd (with usebackq: "files", 'string', `command`). */
  private forF(text: string, f: Frame | null): string[] {
    const h = forFHeader(text);
    if (Array.isArray(h)) return h;
    const lines = this.forSource(h.source, h.options);
    if ('error' in lines) return lines.error;
    const first = h.variable.charCodeAt(0);
    const turns = forFLines(lines.lines, h.options).map((vals) => new Map(vals.map((value, i) => [String.fromCharCode(first + i), value])));
    return this.turns(turns, h.body, f);
  }

  private forSource(src: string, o: ForF): { lines: string[] } | { error: string[] } {
    const cmd = (o.usebackq ? /^`([^]*)`$/ : /^'([^]*)'$/).exec(src);
    // The command runs apart: the ^ that kept its | & > from the for line are gone by then.
    if (cmd) return { lines: this.line((cmd[1] ?? '').replace(/\^(.)/g, '$1'), null) };
    const str = (o.usebackq ? /^'([^]*)'$/ : /^"([^]*)"$/).exec(src);
    if (str) return { lines: [str[1] ?? ''] };
    const lines: string[] = [];
    for (const name of batchArgs(src).map(unquote)) {
      const got = this.readLines(name);
      if (got === null) return { error: [`The system cannot find the file ${name}.`] };
      lines.push(...got);
    }
    return { lines };
  }

  // ------------------------------------------------------------ batch files

  /** Runs `name` as a batch file if it is one (here or in %PATH%); null when there is none. */
  batch(name: string, args: readonly string[], depth = 0): string[] | null {
    const file = this.findBatch(name);
    if (!file) return null;
    if (depth > MAX_DEPTH) return ['******  B A T C H   R E C U R S I O N  exceeds STACK limits ******'];
    const content = this.host.read(file.path);
    if (content === null) return ['Access is denied.'];
    if (depth === 0) this.steps = 0;
    this.batches++;
    this.errorlevel = 0;
    return this.frame({ name: file.name, lines: content.split(/\r?\n/), pc: 0, args: [file.name, ...args], echo: { on: true }, done: false, depth });
  }

  private findBatch(name: string): { name: string; path: string } | null {
    const exts = /\.(bat|cmd)$/i.test(name) ? [''] : /\.\w+$/.test(name) ? [] : ['.bat', '.cmd'];
    const dirs = /[\\/:]/.test(name) ? [''] : ['', ...(this.get('path') ?? '').split(';').filter(Boolean).map((d) => `${d.replace(/\\$/, '')}\\`)];
    for (const dir of dirs) {
      for (const ext of exts) {
        const path = this.host.path(`${dir}${name}${ext}`);
        if (path !== null && this.host.kindOf(path) === 'file') return { name: `${name}${ext}`, path };
      }
    }
    return null;
  }

  private frame(f: Frame): string[] {
    this.stack.push(f);
    const out = this.loop(f);
    if (!this.waiting) this.stack.pop();
    return out;
  }

  /** A batch file's lines from where it is, until it ends, exits or waits for set /p. */
  private loop(f: Frame): string[] {
    const out: string[] = [];
    while (!f.done && !this.waiting && f.pc < f.lines.length) {
      if (++this.steps > MAX_BATCH_STEPS) { out.push(`^C (Netfix stopped ${f.name} after ${MAX_BATCH_STEPS} lines)`); f.done = true; break; }
      let text = f.lines[f.pc++] ?? '';
      // A ( left open goes on to the next lines, up to its ).
      while (openParens(text) > 0 && f.pc < f.lines.length) text += ` & ${(f.lines[f.pc++] ?? '').trim()}`;
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (f.echo.on && !trimmed.startsWith('@')) out.push(`${this.host.prompt()}${trimmed}`);
      out.push(...this.line(expandLine(text, { get: (n) => this.get(n), args: f.args }), f));
    }
    return out;
  }

  private goto(f: Frame, label: string): string[] {
    if (label.toLowerCase() === 'eof') { f.done = true; return []; }
    const re = new RegExp(`^\\s*:${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
    const at = f.lines.findIndex((l) => re.test(l));
    if (at < 0) { f.done = true; return [`The system cannot find the batch label specified - ${label}`]; }
    f.pc = at + 1;
    return [];
  }

  private call(rest: string, f: Frame | null): string[] {
    const [target = '', ...args] = batchArgs(rest.trim());
    if (target.startsWith(':') && f) {
      if (f.depth >= MAX_DEPTH) return ['******  B A T C H   R E C U R S I O N  exceeds STACK limits ******'];
      const sub: Frame = { ...f, args: [f.args[0] ?? '', ...args], pc: 0, done: false, depth: f.depth + 1 };
      const jumped = this.goto(sub, target.slice(1));
      return sub.done ? jumped : this.frame(sub);
    }
    return this.batch(unquote(target), args, (f?.depth ?? 0) + 1) ?? this.line(rest, f);
  }

  private exitBatch(f: Frame, rest: string): string[] {
    this.errorlevel = Number.parseInt(rest.replace(/^\/b\s*/i, ''), 10) || 0;
    f.done = true;
    return [];
  }
}
