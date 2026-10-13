/** State of one bash instance: variables, functions, options, positional parameters, cwd, traps. */
import type { FunctionDef, List } from './ast.ts';
import { Vars, VarError, scalarOf } from './vars.ts';
import { Expander } from './expand.ts';
import type { ExpandApi } from './expand.ts';
import { Arith } from './arith.ts';
import { globPaths } from './globfs.ts';
import { promptEscapes } from './prompt.ts';
import type { Cred } from './vfs.ts';
import { normalize } from './vfs.ts';
import type { Ctx, Fds, Gen, HostEnv, UserInfo } from './types.ts';
import { AbortSignal, ExitSignal } from './types.ts';
import { execList, execCommand, invoke } from './exec.ts';
import type { Command } from './ast.ts';
import { initVariables } from './startup.ts';
import { BUILTINS } from './builtins/index.ts';
import { describeAll } from './builtins/info.ts';
import type { Description } from './builtins/info.ts';
import { expandHistory } from './history.ts';
import { SET_OPTIONS, SET_LETTERS, SHOPT_ON, SHOPT_OFF } from './options.ts';
import type { SetOption } from './options.ts';

export { SET_OPTIONS, SET_LETTERS };
export type { SetOption };
import { makeCtx, ttyFds } from './io.ts';
import { runSync } from './run-sync.ts';
import { freshBudget, MAX_OUTPUT, CHECK_EVERY } from './interp-types.ts';
import type { Budget, HistoryStore, Job } from './interp-types.ts';
import { runSourceText } from './source.ts';
import { dynamicVariable, optionFlags, specialParameter } from './specials.ts';
import { commandSubstitution, processSubstitution } from './subst.ts';


export { freshBudget, MAX_OUTPUT, CHECK_EVERY };
export type { Budget, HistoryStore, Job };

let pidCounter = 4000;

export class Interp {
  readonly env: HostEnv;
  vars = new Vars();
  functions = new Map<string, FunctionDef>();
  aliases = new Map<string, string>();
  opts = new Map<SetOption, boolean>();
  shopt = new Map<string, boolean>();
  args: string[] = [];
  arg0 = 'bash';
  cwd = '/';
  dirstack: string[] = [];
  user: UserInfo;
  interactive: boolean;
  status = 0;
  bgPid: number | undefined;
  readonly pid: number;
  bashpid: number;
  subshell = 0;
  traps = new Map<string, string>();
  funcNames: string[] = [];
  lineno = 0;
  umask = 0o002;
  loopDepth = 0;
  term: (text: string) => void;
  budget: Budget;
  history: HistoryStore = { lines: [], base: 1 };
  commandNumber = 1;
  /** Descriptors of the command being expanded (for command substitution stdin/stderr). */
  currentFds: Fds = ttyFds();
  readonly startedAt: number;
  /** Host name read when the shell started (bash's \h does not follow later changes). */
  startHostname: string;
  /** State of $RANDOM. */
  rngSeed = 1;
  private procCounter = 63;
  readonly expander: Expander;
  readonly arith: Arith;
  readonlyFunctions = new Set<string>();
  disabledBuiltins = new Set<string>();
  activeAliases = new Set<string>();
  /** >0 while running a condition (if/while test, && || operands, !): errexit does not apply. */
  conditionDepth = 0;
  /** Count of command substitutions run (their status becomes $? of assignment-only commands). */
  substitutions = 0;
  jobs: Job[] = [];
  finishedJobs: Job[] = [];
  /** Login shell (SSH sessions): `logout` works. */
  loginShell = false;
  /** Has a controlling terminal (/dev/tty): sudo, su and ssh read passwords from it. */
  controllingTty = false;
  /** The simple command being executed ($BASH_COMMAND). */
  bashCommand = '';
  /** Inside a trap action: $BASH_COMMAND keeps the command that triggered it. */
  trapDepth = 0;
  /** Input line being run: aliases defined on it apply from the next line, as bash reads a whole line first. */
  inputLine = 0;
  readonly aliasLine = new Map<string, number>();
  /** >0 while running `source`: `return` is allowed. */
  sourcing = 0;
  /** `exec >file`: descriptors that replace the defaults for the rest of the session. */
  fdOverride: Fds | undefined;
  exportedFunctions = new Set<string>();
  hashed = new Map<string, string>();
  completions = new Map<string, string>();
  getoptsState = { optind: 1, pos: 1 };

  constructor(env: HostEnv, user: UserInfo, o: { interactive: boolean; term: (t: string) => void; budget?: Budget }) {
    this.env = env;
    this.user = user;
    // Ubuntu: 002 for users with their own group (pam_umask USERGROUPS_ENAB), 022 for root.
    if (user.uid === 0) this.umask = 0o022;
    this.interactive = o.interactive;
    this.term = o.term;
    this.budget = o.budget ?? freshBudget();
    this.pid = ++pidCounter;
    this.bashpid = this.pid;
    this.startedAt = env.now();
    this.startHostname = env.hostname;
    this.rngSeed = this.pid;
    for (const name of SET_OPTIONS) this.opts.set(name, false);
    for (const name of ['braceexpand', 'hashall', 'interactive-comments'] as const) this.opts.set(name, true);
    if (o.interactive) for (const name of ['emacs', 'histexpand', 'history', 'monitor'] as const) this.opts.set(name, true);
    for (const n of SHOPT_ON) this.shopt.set(n, true);
    for (const n of SHOPT_OFF) this.shopt.set(n, false);
    if (!o.interactive) { this.shopt.set('expand_aliases', false); this.shopt.set('extglob', false); }
    this.expander = new Expander(this.expandApi());
    this.arith = new Arith({ get: (n, sub) => this.arithGet(n, sub), set: (n, sub, v) => this.arithSet(n, sub, v) });
  }

  get cred(): Cred {
    return { uid: this.user.uid, gid: this.user.gid, groups: this.user.groups };
  }

  opt(name: SetOption): boolean {
    return this.opts.get(name) ?? false;
  }

  shoptOn(name: string): boolean {
    return this.shopt.get(name) ?? false;
  }

  /** Subshell: copies variables, functions, options; shares the file system, terminal and limits. */
  clone(): Interp {
    const c = new Interp(this.env, this.user, { interactive: this.interactive, term: this.term, budget: this.budget });
    c.startHostname = this.startHostname;
    c.vars = this.vars.clone();
    c.functions = new Map(this.functions);
    c.aliases = new Map(this.aliases);
    c.opts = new Map(this.opts);
    c.shopt = new Map(this.shopt);
    c.args = [...this.args];
    c.arg0 = this.arg0;
    c.cwd = this.cwd;
    c.dirstack = [...this.dirstack];
    c.status = this.status;
    c.subshell = this.subshell + 1;
    c.funcNames = [...this.funcNames];
    c.lineno = this.lineno;
    c.umask = this.umask;
    c.history = this.history;
    c.currentFds = this.currentFds;
    c.loopDepth = 0;
    c.controllingTty = this.controllingTty;
    c.loginShell = this.loginShell;
    (c as { pid: number }).pid = this.pid;
    for (const [sig, cmd] of this.traps) if (cmd === '') c.traps.set(sig, '');
    return c;
  }

  // ------------------------------------------------------------ limits

  tick(): void {
    this.budget.steps++;
    if (this.budget.steps % CHECK_EVERY === 0 && Date.now() > this.budget.deadline) {
      throw new AbortSignal(124, 'bash: Netfix: ejecución detenida tras 4 s (¿bucle infinito?)');
    }
  }

  countOutput(n: number): void {
    this.budget.output += n;
    if (this.budget.output > MAX_OUTPUT) throw new AbortSignal(124, 'bash: Netfix: ejecución detenida: demasiada salida');
  }

  /** "bash: " in interactive shells, "script: line N: " otherwise. */
  errPrefix(): string {
    return this.interactive ? 'bash: ' : `${this.arg0}: line ${this.lineno}: `;
  }

  error(msg: string): void {
    this.term(`${this.errPrefix()}${msg}\n`);
  }

  // ------------------------------------------------------------ variables

  getVar(name: string): string | undefined {
    const sp = this.dynamic(name);
    return sp ?? scalarOf(this.vars.get(name)?.value);
  }

  setVar(name: string, value: string, opts: { export?: boolean } = {}): void {
    this.vars.set(name, value, { arith: (s) => String(this.arith.eval(s)) });
    const v = this.vars.get(name);
    if (v && (opts.export || this.opt('allexport'))) v.attrs.add('x');
  }

  /** Assignment with the usual error report; returns false on failure. */
  trySetVar(name: string, value: string): boolean {
    try {
      this.setVar(name, value);
      return true;
    } catch (e) {
      if (e instanceof VarError) { this.error(e.message); return false; }
      throw e;
    }
  }

  private arithGet(name: string, sub: string | undefined): string | undefined {
    if (sub === undefined) return this.getVar(name);
    const v = this.vars.get(name)?.value;
    if (!v) return undefined;
    if (v.t === 'assoc') return v.v.get(this.expander.word(sub));
    const i = Number(this.arith.eval(sub));
    if (v.t === 'str') return i === 0 ? v.v : undefined;
    return v.v.get(i < 0 ? Math.max(-1, ...v.v.keys()) + 1 + i : i);
  }

  private arithSet(name: string, sub: string | undefined, value: string): void {
    if (sub === undefined) return this.setVar(name, value);
    const v = this.vars.get(name);
    this.vars.setElement(name, v?.attrs.has('A') ? this.expander.word(sub) : Number(this.arith.eval(sub)), value);
  }

  /** Special parameters and dynamic variables. */
  dynamic(name: string): string | undefined {
    return dynamicVariable(this, name);
  }

  flags(): string {
    return optionFlags(this);
  }

  special(name: string): string | readonly string[] | undefined {
    return specialParameter(this, name);
  }

  // ------------------------------------------------------------ expansion hooks

  private expandApi(): ExpandApi {
    const self = this;
    return {
      get vars() { return self.vars; },
      get opts() {
        return {
          nounset: self.opt('nounset'), noglob: self.opt('noglob'), nullglob: self.shoptOn('nullglob'), failglob: self.shoptOn('failglob'),
          braceexpand: self.opt('braceexpand'), patsubReplacement: self.shoptOn('patsub_replacement'),
        };
      },
      special: (n) => this.special(n),
      positional: () => this.args,
      arith: (e) => this.arith.eval(e),
      commandSub: (src, mode) => this.commandSub(src, mode),
      procSub: (dir, src) => this.procSub(dir, src),
      home: (u) => this.env.users().find((x) => x.name === u)?.home,
      glob: (p) => globPaths(this.env.fs, this.cred, this.cwd, p, {
        dotglob: this.shoptOn('dotglob'), nocaseglob: this.shoptOn('nocaseglob'), globstar: this.shoptOn('globstar'), sort: this.getVar('GLOBSORT') ?? 'name',
      }),
      promptExpand: (s) => this.prompt(s),
    };
  }

  prompt(ps: string): string {
    const text = promptEscapes(ps, {
      user: this.user.name, host: this.startHostname, cwd: this.cwd, home: this.getVar('HOME'), uid: this.user.uid, now: this.env.now(),
      historyNumber: this.history.base + this.history.lines.length, commandNumber: this.commandNumber, jobs: 0, version: '5.3', release: '5.3.20',
    });
    if (!this.shoptOn('promptvars')) return text;
    try {
      return this.expander.dqString(text);
    } catch {
      return text;
    }
  }

  /** $(…) in a subshell, ${ …; } in the current shell, ${| …; } returns REPLY. */
  commandSub(src: string, mode: 'sub' | 'cur' | 'val'): string {
    return commandSubstitution(this, src, mode);
  }

  /** <(…) / >(…): a /dev/fd/N file with the output of the command. */
  procSub(dir: '<' | '>', src: string): string {
    const path = `/dev/fd/${this.procCounter--}`;
    if (this.procCounter < 10) this.procCounter = 63;
    processSubstitution(this, dir, src, path);
    return path;
  }

  // ------------------------------------------------------------ running

  ctx(argv: readonly string[], fds: Fds, env?: ReadonlyMap<string, string>): Ctx {
    return makeCtx(this, argv, fds, env ?? this.vars.exported());
  }

  resolvePath(p: string): string {
    return normalize(p, this.cwd);
  }

  run(list: List, fds: Fds): Gen<number> {
    return execList(this, list, fds);
  }

  /** Parses and runs source text one command line at a time; syntax errors are reported like bash (status 2). */
  runSource(src: string, fds: Fds, topLevel = false): Gen<number> {
    return runSourceText(this, src, fds, topLevel);
  }

  isBuiltin(name: string, includeDisabled = false): boolean {
    return BUILTINS.has(name) && (includeDisabled || !this.disabledBuiltins.has(name));
  }

  builtinNames(): string[] {
    return [...BUILTINS.keys()].sort();
  }

  /** Every command name: aliases, functions, builtins and executables in $PATH. */
  commandNames(): string[] {
    const names = new Set<string>([...this.aliases.keys(), ...this.functions.keys(), ...this.builtinNames()]);
    for (const dir of (this.getVar('PATH') ?? '').split(':')) {
      try {
        for (const n of this.env.fs.readdir(dir || '.', this.cred)) names.add(n);
      } catch {
        // unreadable PATH entries are skipped, as bash does
      }
    }
    return [...names].sort();
  }

  describe(name: string): Description | undefined {
    return describeAll(this, name)[0];
  }

  /** !! !n !-n !str !?str? ^a^b !$ !^ !* — null when nothing changes, throws on "event not found". */
  historyExpand(line: string): string | null {
    return expandHistory(line, this.history.lines, this.history.base);
  }

  enabledBuiltin(name: string): boolean {
    return !this.disabledBuiltins.has(name);
  }

  execCommand(cmd: Command, fds: Fds): Gen<number> {
    return execCommand(this, cmd, fds);
  }

  invoke(argv: readonly string[], fds: Fds, opts: { noFunctions?: boolean; builtinOnly?: boolean } = {}): Gen<number> {
    return invoke(this, argv, fds, opts);
  }

  /** Runs argv with an explicit environment (env VAR=value command). */
  invokeEnv(argv: readonly string[], fds: Fds, env: ReadonlyMap<string, string>): Gen<number> {
    return invoke(this, argv, fds, { env });
  }

  /** Runs a trap action; $? is preserved around it. */
  runTrap(name: string): void {
    const action = this.traps.get(name);
    if (!action) return;
    const saved = this.status;
    this.trapDepth++;
    try {
      runSync(this.runSource(action, this.currentFds));
    } finally {
      this.status = saved;
      this.trapDepth--;
    }
  }

  /** Child process: a new non-interactive bash with the exported environment. */
  spawn(arg0: string, args: readonly string[], env: ReadonlyMap<string, string>): Interp {
    const child = new Interp(this.env, this.user, { interactive: false, term: this.term, budget: this.budget });
    initVariables(child, env);
    child.cwd = this.cwd;
    child.setVar('PWD', this.cwd);
    child.umask = this.umask;
    child.arg0 = arg0;
    child.args = [...args];
    child.bashpid = child.pid;
    child.controllingTty = this.controllingTty;
    return child;
  }

  /** Runs a script body in this (child) shell, then its EXIT trap. */
  *runScriptText(content: string, fds: Fds): Gen<number> {
    try {
      return yield* this.runSource(content, fds, true);
    } catch (e) {
      if (e instanceof ExitSignal) return e.code;
      throw e;
    } finally {
      this.runTrap('EXIT');
    }
  }
}

export { runSync };
