/** Executes lists, and-or lists, pipelines and simple commands. */
import { commandText } from './deparse.ts';
import type { AndOr, Assignment, Command, List, Pipeline, SimpleCommand } from './ast.ts';
import type { Interp } from './interp.ts';
import type { CommandFn, Ctx, DeclArg, Fds, Gen } from './types.ts';
import { DiscardSignal, ExitSignal, LoopSignal, ReturnSignal } from './types.ts';
import { ExpansionError } from './expand.ts';
import { VarError } from './vars.ts';
import { ArithError } from './arith.ts';
import { applyRedirects, RedirError } from './redirect.ts';
import { bufferSink, dataSource, writeSink, isGen } from './io.ts';
import { execCompound } from './exec-compound.ts';
import { resolveCommand, runResolved } from './run.ts';
import { parse } from './parser.ts';
import { isPlainWord } from './wordparse.ts';
import { quoteForReuse } from './params.ts';

const SPECIAL_BUILTINS = new Set(['break', ':', '.', 'continue', 'eval', 'exec', 'exit', 'export', 'readonly', 'return', 'set', 'shift', 'times', 'trap', 'unset', 'source']);
const DECLARATION = new Set(['declare', 'typeset', 'local', 'readonly', 'export']);

/** Errors that end the current command with status 1 (and a message). */
export function reportError(sh: Interp, e: unknown): number {
  if (e instanceof ExpansionError) {
    sh.error(e.message);
    if (e.exits && !sh.interactive) throw new ExitSignal(1);
    throw new DiscardSignal(1);
  }
  if (e instanceof ArithError || e instanceof VarError) {
    sh.error(e.message);
    throw new DiscardSignal(1);
  }
  if (e instanceof RedirError) {
    sh.error(e.message);
    return 1;
  }
  throw e;
}

export function* execList(sh: Interp, list: List, fds: Fds): Gen<number> {
  let status = sh.status;
  for (const item of list.items) {
    sh.tick();
    const f = sh.fdOverride ?? fds;
    if (item.async) {
      status = yield* execBackground(sh, item.cmd, f, item.source);
    } else {
      status = yield* execCommand(sh, item.cmd, f);
    }
    sh.status = status;
  }
  return status;
}

function* execBackground(sh: Interp, cmd: Command, fds: Fds, source: string): Gen<number> {
  const sub = sh.clone();
  const pid = sh.pid + 1 + Math.floor(sh.budget.steps % 1000);
  sh.bgPid = pid;
  const jobs = sh.jobs;
  const id = jobs.length + 1;
  if (sh.interactive) writeSink(sh, fds.get(2)?.write, `[${id}] ${pid}\n`);
  const bgFds = new Map(fds);
  bgFds.set(0, { read: { kind: 'null' } });
  const code = yield* inSubshell(sub, cmd, bgFds);
  jobs.push({ id, pid, source, status: code });
  return 0;
}

/** Runs a command in a subshell, turning `exit` into its status. */
export function* inSubshell(sub: Interp, cmd: Command, fds: Fds): Gen<number> {
  try {
    return yield* execCommand(sub, cmd, fds);
  } catch (e) {
    if (e instanceof ExitSignal || e instanceof DiscardSignal) return e.code;
    if (e instanceof LoopSignal || e instanceof ReturnSignal) return 0;
    throw e;
  }
}

function setPipestatus(sh: Interp, statuses: readonly number[]): void {
  sh.vars.setArray('PIPESTATUS', statuses.map((s) => ({ value: String(s) })), false);
}

export function* execCommand(sh: Interp, cmd: Command, fds: Fds): Gen<number> {
  switch (cmd.kind) {
    case 'list': return yield* execList(sh, cmd, fds);
    case 'and_or': return yield* execAndOr(sh, cmd, fds);
    case 'pipeline': return yield* execPipeline(sh, cmd, fds);
    case 'simple': {
      const status = yield* execSimple(sh, cmd, fds);
      setPipestatus(sh, [status]);
      return checkErrexit(sh, status);
    }
    case 'function':
      if (sh.functions.get(cmd.name) && sh.readonlyFunctions.has(cmd.name)) {
        sh.error(`${cmd.name}: readonly function`);
        return 1;
      }
      sh.functions.set(cmd.name, cmd);
      return 0;
    default: {
      const status = yield* execCompound(sh, cmd, fds);
      setPipestatus(sh, [status]);
      return cmd.kind === 'subshell' || cmd.kind === 'arith' || cmd.kind === 'cond' ? checkErrexit(sh, status) : status;
    }
  }
}

/** set -e: a failing command outside conditions ends the shell (and runs the ERR trap). */
export function checkErrexit(sh: Interp, status: number): number {
  if (status === 0 || sh.conditionDepth > 0) return status;
  const trap = sh.traps.get('ERR');
  if (trap) sh.runTrap('ERR');
  if (sh.opt('errexit')) throw new ExitSignal(status);
  return status;
}

function* execAndOr(sh: Interp, cmd: AndOr, fds: Fds): Gen<number> {
  sh.conditionDepth++;
  let status: number;
  try {
    status = yield* execCommand(sh, cmd.first, fds);
  } finally {
    sh.conditionDepth--;
  }
  for (let i = 0; i < cmd.rest.length; i++) {
    const step = cmd.rest[i] as AndOr['rest'][number];
    if ((step.op === '&&') !== (status === 0)) continue;
    const last = i === cmd.rest.length - 1;
    if (!last) sh.conditionDepth++;
    try {
      status = yield* execCommand(sh, step.cmd, fds);
    } finally {
      if (!last) sh.conditionDepth--;
    }
  }
  return status;
}

function* execPipeline(sh: Interp, p: Pipeline, fds: Fds): Gen<number> {
  const started = Date.now();
  if (p.negate) sh.conditionDepth++;
  let status = 0;
  const statuses: number[] = [];
  try {
    let input: ReturnType<typeof dataSource> | undefined;
    for (let i = 0; i < p.cmds.length; i++) {
      const c = p.cmds[i] as Command;
      const last = i === p.cmds.length - 1;
      const out = last ? undefined : bufferSink();
      const f = new Map(fds);
      if (input) f.set(0, { read: input });
      if (out) {
        f.set(1, { write: out });
        if (p.stderrToPipe[i]) f.set(2, { write: out });
      }
      const single = p.cmds.length === 1;
      const runIn = single || (last && sh.shoptOn('lastpipe') && !sh.opt('monitor')) ? sh : sh.clone();
      status = runIn === sh ? yield* execCommand(sh, c, f) : yield* inSubshell(runIn, c, f);
      statuses.push(status);
      input = out ? dataSource(out.chunks.join('')) : undefined;
    }
  } finally {
    if (p.negate) sh.conditionDepth--;
  }
  setPipestatus(sh, statuses);
  if (sh.opt('pipefail')) status = [...statuses].reverse().find((s) => s !== 0) ?? 0;
  if (p.timed) writeSink(sh, fds.get(2)?.write, `\nreal\t0m${((Date.now() - started) / 1000).toFixed(3)}s\nuser\t0m0.000s\nsys\t0m0.000s\n`);
  return p.negate ? (status === 0 ? 1 : 0) : status;
}

// ------------------------------------------------------------ simple commands

function* execSimple(sh: Interp, cmd: SimpleCommand, fds: Fds): Gen<number> {
  sh.lineno = cmd.line;
  sh.tick();
  const aliased = aliasExpansion(sh, cmd);
  if (aliased) return yield* runAlias(sh, aliased.name, aliased.list, fds);
  sh.currentFds = fds;
  if (sh.trapDepth === 0) sh.bashCommand = commandText(cmd);
  const subsBefore = sh.substitutions;
  let argv: string[];
  let decl: Map<number, DeclArg> | undefined;
  try {
    ({ argv, decl } = expandArgs(sh, cmd));
  } catch (e) {
    return reportError(sh, e);
  }
  let cfds: Fds;
  try {
    cfds = applyRedirects(sh, cmd.redirs, fds);
  } catch (e) {
    return reportError(sh, e);
  }
  if (argv.length === 0) return assignOnly(sh, cmd.assigns, sh.substitutions > subsBefore ? sh.status : 0);
  const name = argv[0] ?? '';
  let temps: [string, string][];
  try {
    temps = cmd.assigns.map((a) => [a.name, sh.expander.word(a.value?.raw ?? '', true)]);
  } catch (e) {
    return reportError(sh, e);
  }
  trace(sh, cfds, temps, argv);
  const resolved = resolveCommand(sh, name);
  const status = yield* withTemps(sh, resolved.kind === 'builtin' && SPECIAL_BUILTINS.has(name), resolved.kind === 'program' || resolved.kind === 'script', temps,
    (env) => runResolved(sh, resolved, argv, cfds, env, decl));
  sh.vars.set('_', argv[argv.length - 1] ?? '');
  return status;
}

/** Expands the words; assignment arguments of declare/local/… are kept apart. */
function expandArgs(sh: Interp, cmd: SimpleCommand): { argv: string[]; decl?: Map<number, DeclArg> } {
  const first = cmd.words[0]?.raw ?? '';
  if (!DECLARATION.has(first) && !(first === 'builtin' && DECLARATION.has(cmd.words[1]?.raw ?? ''))) return { argv: sh.expander.words(cmd.words) };
  const argv: string[] = [];
  const decl = new Map<number, DeclArg>();
  for (const w of cmd.words) {
    if (!w.assign) { argv.push(...sh.expander.words([w])); continue; }
    decl.set(argv.length, declArg(sh, w.assign));
    argv.push(w.assign.name);
  }
  return { argv, decl };
}

function declArg(sh: Interp, a: Assignment): DeclArg {
  if (a.array) {
    const array: { key?: string; value: string }[] = a.array.flatMap((e) => (e.key !== undefined ? [{ key: sh.expander.word(e.key), value: sh.expander.word(e.value.raw, true) }] : sh.expander.words([e.value]).map((value) => ({ value }))));
    return { name: a.name, append: a.append, array };
  }
  return { name: a.name, index: a.index, append: a.append, value: a.value ? sh.expander.word(a.value.raw, true) : '' };
}

/** NAME=value with no command: assignments in the current shell. */
function assignOnly(sh: Interp, assigns: readonly Assignment[], before: number): number {
  const subsBefore = sh.substitutions;
  for (const a of assigns) {
    try {
      assign(sh, a);
    } catch (e) {
      return reportError(sh, e);
    }
  }
  return sh.substitutions > subsBefore ? sh.status : before;
}

export function assign(sh: Interp, a: Assignment): void {
  if (a.array) {
    const items: { key?: string; value: string }[] = a.array.flatMap((e) => (e.key !== undefined ? [{ key: sh.expander.word(e.key), value: sh.expander.word(e.value.raw, true) }] : sh.expander.words([e.value]).map((value) => ({ value }))));
    const isAssoc = sh.vars.get(a.name)?.attrs.has('A') ?? false;
    sh.vars.setArray(a.name, items.map((it) => ({ key: it.key !== undefined && !isAssoc ? String(sh.arith.eval(it.key)) : it.key, value: it.value })), isAssoc, a.append);
    if (sh.opt('allexport')) sh.vars.get(a.name)?.attrs.add('x');
    return;
  }
  const value = sh.expander.word(a.value?.raw ?? '', true);
  if (a.index !== undefined) {
    const isAssoc = sh.vars.get(a.name)?.attrs.has('A') ?? false;
    sh.vars.setElement(a.name, isAssoc ? sh.expander.word(a.index) : Number(sh.arith.eval(a.index)), value, a.append);
    return;
  }
  sh.vars.set(a.name, value, { append: a.append, arith: (s) => String(sh.arith.eval(s)) });
  if (sh.opt('allexport')) sh.vars.get(a.name)?.attrs.add('x');
}

/** Temporary NAME=value before a command: persistent for special builtins, in the environment for programs. */
function* withTemps(sh: Interp, persistent: boolean, external: boolean, temps: readonly [string, string][], run: (env: ReadonlyMap<string, string>) => Gen<number>): Gen<number> {
  if (!temps.length) return yield* run(sh.vars.exported());
  if (persistent) {
    for (const [k, v] of temps) if (!sh.trySetVar(k, v)) return 1;
    return yield* run(sh.vars.exported());
  }
  const env = new Map(sh.vars.exported());
  for (const [k, v] of temps) env.set(k, v);
  if (external) return yield* run(env);
  sh.vars.pushScope();
  try {
    for (const [k, v] of temps) {
      const local = sh.vars.declareLocal(k);
      local.value = { t: 'str', v };
      local.attrs.add('x');
    }
    return yield* run(env);
  } finally {
    sh.vars.popScope();
  }
}

function trace(sh: Interp, fds: Fds, temps: readonly [string, string][], argv: readonly string[]): void {
  if (!sh.opt('xtrace')) return;
  const q = (s: string): string => (/^[A-Za-z0-9_./=:@%+,-]+$/.test(s) ? s : quoteForReuse(s));
  const ps4 = sh.prompt(sh.getVar('PS4') ?? '+ ');
  const parts = [...temps.map(([k, v]) => `${k}=${q(v)}`), ...argv.map(q)];
  writeSink(sh, fds.get(2)?.write, `${ps4.repeat(1)}${parts.join(' ')}\n`);
}

// ------------------------------------------------------------ aliases

function aliasExpansion(sh: Interp, cmd: SimpleCommand): { name: string; list: List } | undefined {
  if (!sh.shoptOn('expand_aliases') || cmd.wordAt < 0) return undefined;
  const name = cmd.words[0]?.raw ?? '';
  const value = sh.aliases.get(name);
  if (value === undefined || !isPlainWord(name) || sh.activeAliases.has(name) || sh.aliasLine.get(name) === sh.inputLine) return undefined;
  const src = cmd.source.slice(0, cmd.wordAt) + value + cmd.source.slice(cmd.wordAt + name.length);
  try {
    return { name, list: parse(src) };
  } catch {
    return undefined;
  }
}

function* runAlias(sh: Interp, name: string, list: List, fds: Fds): Gen<number> {
  sh.activeAliases.add(name);
  try {
    return yield* execList(sh, list, fds);
  } finally {
    sh.activeAliases.delete(name);
  }
}

/** Runs argv as a command (used by `command`, `builtin`, `exec`, `xargs`, `sudo`…). */
export function* invoke(sh: Interp, argv: readonly string[], fds: Fds, opts: { noFunctions?: boolean; builtinOnly?: boolean; env?: ReadonlyMap<string, string> } = {}): Gen<number> {
  const resolved = resolveCommand(sh, argv[0] ?? '', opts);
  return yield* runResolved(sh, resolved, argv, fds, opts.env ?? sh.vars.exported());
}

export function* callFn(fn: CommandFn, ctx: Ctx): Gen<number> {
  const r = fn(ctx);
  return isGen(r) ? yield* r : r;
}
