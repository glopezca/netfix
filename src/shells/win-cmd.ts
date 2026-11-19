/**
 * The cmd.exe interpreter around the Windows terminal's commands: %VAR% expansion, & && || chains, ( ) groups, set
 * (and set /a), if, for, and batch files (.bat / .cmd) with @, echo off, rem / ::, labels, goto, call, shift, pause and
 * exit /b. The terminal runs each simple command (WinCmdHost.simple); everything else happens here.
 */
import { arith, batchArgs, closingParen, expandLine, openParens, splitChain } from './win-cmd-parse.ts';
import { hasWildcard } from './win-path.ts';

export interface WinCmdHost {
  /** The system's variables (Path, USERNAME…), by their usual names. */
  env(): Record<string, string>;
  /** One simple command (with its quotes and > redirection). */
  simple(text: string): string[];
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

const SYNTAX = ['The syntax of the command is incorrect.'];
/** A batch file running in a loop is cut off after this many lines (cmd.exe would run until Ctrl+C). */
export const MAX_BATCH_STEPS = 10_000;
const MAX_DEPTH = 16;
// shortcut: errorlevel is guessed from the output (a Windows error message = 1); a per-command exit code would be exact.
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

  /** A line typed at the prompt. */
  run(line: string): string[] {
    this.steps = 0;
    return this.line(expandLine(line, { get: (n) => this.get(n) }), null);
  }

  /** A line already expanded: its chain, piece by piece. */
  private line(text: string, f: Frame | null): string[] {
    const out: string[] = [];
    for (const link of splitChain(text)) {
      if (f?.done) break;
      if ((link.op === '&&' && this.errorlevel !== 0) || (link.op === '||' && this.errorlevel === 0)) continue;
      out.push(...this.piece(link.text, f));
    }
    return out;
  }

  private piece(raw: string, f: Frame | null): string[] {
    const t = raw.trim().replace(/^@\s*/, '');
    if (!t || t.startsWith('::') || t.startsWith(':')) return [];
    if (t.startsWith('(')) {
      const end = closingParen(t, 0);
      if (end === t.length - 1) return this.line(t.slice(1, -1), f);
    }
    const m = /^([^\s(=;,]+)\s*(.*)$/s.exec(t);
    const word = (m?.[1] ?? '').toLowerCase();
    const rest = m?.[2] ?? '';
    switch (word) {
      case 'rem': return [];
      case 'set': return this.set(rest);
      case 'if': return this.ifCmd(rest, f);
      case 'for': return this.forCmd(rest, f);
      case 'pause': return ['Press any key to continue . . .'];
      case 'setlocal': case 'endlocal': return [];
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
    const out = this.host.simple(t);
    if (this.batches === before) this.errorlevel = out.some((l) => FAILED.test(l)) ? 1 : 0;
    return out;
  }

  // ------------------------------------------------------------ set

  private set(rest: string): string[] {
    const r = rest.trim();
    if (/^\/a\b/i.test(r)) return this.setArith(r.slice(2));
    if (/^\/p\b/i.test(r)) return SYNTAX; // shortcut: no set /p (it needs to wait for a typed answer)
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
    // At the prompt set /a prints the result; a batch file does not (the caller drops it then).
    return [String(r.last)];
  }

  // ------------------------------------------------------------ if and for

  private condition(s: string): { ok: boolean; rest: string } | null {
    const ci = /^\/i\s+/i.test(s);
    let t = ci ? s.replace(/^\/i\s+/i, '') : s;
    const not = /^not\s+/i.test(t);
    if (not) t = t.replace(/^not\s+/i, '');
    const done = (ok: boolean, rest: string | undefined): { ok: boolean; rest: string } => ({ ok: ok !== not, rest: rest ?? '' });
    let m = /^exist\s+("[^"]*"|\S+)\s*(.*)$/is.exec(t);
    if (m) return done(this.exists(unquote(m[1] ?? '')), m[2]);
    if ((m = /^defined\s+(\S+)\s*(.*)$/is.exec(t))) return done(this.get(m[1] ?? '') !== undefined, m[2]);
    if ((m = /^errorlevel\s+(\d+)\s*(.*)$/is.exec(t))) return done(this.errorlevel >= Number(m[1]), m[2]);
    if ((m = /^("[^"]*"|[^\s=]+)\s*==\s*("[^"]*"|[^\s=]*)\s*(.*)$/s.exec(t))) {
      const [a, b] = [m[1] ?? '', m[2] ?? ''];
      return done(ci ? a.toLowerCase() === b.toLowerCase() : a === b, m[3]);
    }
    if ((m = /^("[^"]*"|\S+)\s+(EQU|NEQ|LSS|LEQ|GTR|GEQ)\s+("[^"]*"|\S+)\s*(.*)$/is.exec(t))) return done(compare(m[1] ?? '', (m[2] ?? '').toUpperCase(), m[3] ?? '', ci), m[4]);
    return null;
  }

  private exists(p: string): boolean {
    if (hasWildcard(p)) return this.host.glob(p).length > 0;
    const path = this.host.path(p);
    return path !== null && this.host.kindOf(path) !== null;
  }

  private ifCmd(rest: string, f: Frame | null): string[] {
    const c = this.condition(rest.trim());
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

  /** for %v in (set) do cmd, and for /l %v in (start,step,end) do cmd (%%v in a batch file). */
  private forCmd(rest: string, f: Frame | null): string[] {
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
    const out: string[] = [];
    for (const value of values) {
      if (f?.done) break;
      // Every turn counts against the same limit as batch lines: nested loops cannot run on for ever.
      if (++this.steps > MAX_BATCH_STEPS) { out.push(`^C (Netfix stopped the for loop after ${MAX_BATCH_STEPS} turns)`); if (f) f.done = true; break; }
      out.push(...this.line(body.replaceAll(`%${v}`, value), f));
    }
    return out;
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
    const out: string[] = [];
    while (!f.done && f.pc < f.lines.length) {
      if (++this.steps > MAX_BATCH_STEPS) { out.push(`^C (Netfix stopped ${f.name} after ${MAX_BATCH_STEPS} lines)`); f.done = true; break; }
      let text = f.lines[f.pc++] ?? '';
      // A ( left open goes on to the next lines, up to its ).
      while (openParens(text) > 0 && f.pc < f.lines.length) text += ` & ${(f.lines[f.pc++] ?? '').trim()}`;
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (f.echo.on && !trimmed.startsWith('@')) out.push(`${this.host.prompt()}${trimmed}`);
      const silent = /^@?\s*set\s+\/a\b/i.test(trimmed); // set /a prints nothing inside a batch file
      const lines = this.line(expandLine(text, { get: (n) => this.get(n), args: f.args }), f);
      if (!silent) out.push(...lines);
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

function compare(a: string, op: string, b: string, ci: boolean): boolean {
  const [x, y] = [unquote(a), unquote(b)];
  const numeric = /^-?\d+$/.test(x) && /^-?\d+$/.test(y);
  const d = numeric ? Number(x) - Number(y) : (ci ? x.toLowerCase() : x).localeCompare(ci ? y.toLowerCase() : y);
  return { EQU: d === 0, NEQ: d !== 0, LSS: d < 0, LEQ: d <= 0, GTR: d > 0, GEQ: d >= 0 }[op] ?? false;
}
