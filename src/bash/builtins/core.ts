/** Core builtins: : true false echo printf exit logout return break continue shift eval source exec command builtin let. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { ExitSignal, LoopSignal, ReturnSignal } from '../types.ts';
import { builtinError } from '../io.ts';
import { expandEscapes, formatPrintf } from './printf.ts';
import { parseOpts, badOption, flagStr } from './util.ts';
import { ArithError } from '../arith.ts';
import { FsError } from '../vfs.ts';
import { findInPath } from '../path.ts';

const numArg = (ctx: Ctx, s: string | undefined, dflt: number): number | null => {
  if (s === undefined) return dflt;
  return /^-?\d+$/.test(s.trim()) ? Number(s) : null;
};

function echo(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  let newline = true;
  let escapes = ctx.sh.shoptOn('xpg_echo');
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (!/^-[neE]+$/.test(a)) break;
    for (const c of a.slice(1)) {
      if (c === 'n') newline = false;
      else escapes = c === 'e';
    }
  }
  let text = args.slice(i).join(' ');
  if (escapes) {
    const r = expandEscapes(text, true);
    text = r.text;
    if (r.stop) newline = false;
  }
  ctx.out(newline ? `${text}\n` : text);
  return 0;
}

function printf(ctx: Ctx): number {
  let args = ctx.argv.slice(1);
  let target: string | undefined;
  if (args[0] === '-v') {
    target = args[1];
    args = args.slice(2);
    if (!target) return badOption(ctx, '-v:', 'printf [-v var] format [arguments]');
  } else if (args[0] === '--') args = args.slice(1);
  if (args.length === 0) {
    ctx.err(`${ctx.sh.errPrefix()}printf: usage: printf [-v var] format [arguments]\n`);
    return 2;
  }
  const r = formatPrintf(args[0] ?? '', args.slice(1), ctx.sh.env.now());
  let text = '';
  for (const pass of r.passes) {
    for (const e of pass.errors) builtinError(ctx, e);
    if (target === undefined) ctx.out(pass.text);
    else text += pass.text;
  }
  if (target !== undefined && !ctx.sh.trySetVar(target, text)) return 1;
  return r.status;
}

function exit(ctx: Ctx): number {
  const n = numArg(ctx, ctx.argv[1], ctx.sh.status);
  if (ctx.sh.interactive && ctx.sh.subshell === 0) ctx.err(ctx.sh.loginShell ? 'logout\n' : 'exit\n');
  if (n === null) {
    builtinError(ctx, `${ctx.argv[1] ?? ''}: numeric argument required`, 2);
    throw new ExitSignal(2);
  }
  if (ctx.argv.length > 2) return builtinError(ctx, 'too many arguments');
  throw new ExitSignal(((n % 256) + 256) % 256);
}

function logout(ctx: Ctx): number {
  if (!ctx.sh.loginShell) return builtinError(ctx, 'not login shell: use `exit\'');
  return exit({ ...ctx, argv: ['exit', ...ctx.argv.slice(1)] });
}

function ret(ctx: Ctx): number {
  if (!ctx.sh.funcNames.length && !ctx.sh.sourcing) return builtinError(ctx, "can only `return' from a function or sourced script", 2);
  const n = numArg(ctx, ctx.argv[1], ctx.sh.status);
  if (n === null) {
    builtinError(ctx, `${ctx.argv[1] ?? ''}: numeric argument required`, 2);
    throw new ReturnSignal(2);
  }
  throw new ReturnSignal(((n % 256) + 256) % 256);
}

function loop(kind: 'break' | 'continue'): CommandFn {
  return (ctx) => {
    const n = numArg(ctx, ctx.argv[1], 1);
    if (n === null || n < 1) return builtinError(ctx, `${ctx.argv[1] ?? ''}: loop count out of range`);
    if (ctx.sh.loopDepth === 0) {
      builtinError(ctx, "only meaningful in a `for', `while', or `until' loop", 0);
      return 0;
    }
    throw new LoopSignal(kind, Math.min(n, ctx.sh.loopDepth));
  };
}

function shift(ctx: Ctx): number {
  const n = numArg(ctx, ctx.argv[1], 1);
  if (n === null) return builtinError(ctx, `${ctx.argv[1] ?? ''}: numeric argument required`);
  if (n < 0 || n > ctx.sh.args.length) {
    if (ctx.sh.shoptOn('shift_verbose')) builtinError(ctx, `${n}: shift count out of range`);
    return 1;
  }
  ctx.sh.args = ctx.sh.args.slice(n);
  return 0;
}

function* evalBuiltin(ctx: Ctx): Gen<number> {
  const src = ctx.argv.slice(1).join(' ');
  if (!src.trim()) return 0;
  return yield* ctx.sh.runSource(src, ctx.fds);
}

function sourcePath(ctx: Ctx, name: string, searchPath: string | undefined): string | undefined {
  if (name.includes('/')) return ctx.resolve(name);
  if (searchPath !== undefined) {
    for (const d of searchPath.split(':')) {
      const p = ctx.sh.resolvePath(`${d || '.'}/${name}`);
      if (ctx.sh.env.fs.tryLookup(p, ctx.cred)?.kind === 'file') return p;
    }
    return undefined;
  }
  if (ctx.sh.shoptOn('sourcepath')) {
    const inPath = findInPath(ctx.sh, name);
    if (inPath) return inPath;
  }
  return ctx.resolve(name);
}

function* source(ctx: Ctx): Gen<number> {
  let args = ctx.argv.slice(1);
  let searchPath: string | undefined;
  if (args[0] === '-p') { searchPath = args[1] ?? ''; args = args.slice(2); }
  if (args[0] === '--') args = args.slice(1);
  const name = args[0];
  if (name === undefined) {
    builtinError(ctx, 'filename argument required', 2);
    ctx.err(`${ctx.argv[0]}: usage: ${ctx.argv[0]} filename [arguments]\n`);
    return 2;
  }
  const path = sourcePath(ctx, name, searchPath);
  let text: string;
  try {
    if (!path) throw new FsError('ENOENT');
    text = ctx.sh.env.fs.readFile(path, ctx.cred);
  } catch (e) {
    return builtinError(ctx, `${name}: ${e instanceof FsError ? e.message : 'No such file or directory'}`);
  }
  const sh = ctx.sh;
  const savedArgs = sh.args;
  if (args.length > 1) sh.args = args.slice(1);
  sh.sourcing++;
  try {
    return yield* sh.runSource(text, ctx.fds);
  } catch (e) {
    if (e instanceof ReturnSignal) return e.code;
    throw e;
  } finally {
    sh.sourcing--;
    if (args.length > 1) sh.args = savedArgs;
  }
}

function* execBuiltin(ctx: Ctx): Gen<number> {
  const p = parseOpts(ctx.argv.slice(1), 'cla:');
  if (p.bad) return badOption(ctx, p.bad, 'exec [-cl] [-a name] [command [argument ...]] [redirection ...]');
  if (!p.rest.length) {
    ctx.sh.fdOverride = ctx.fds;
    return 0;
  }
  const argv = [flagStr(p, 'a') ?? p.rest[0] ?? '', ...p.rest.slice(1)];
  const status = yield* ctx.sh.invoke([p.rest[0] ?? '', ...argv.slice(1)], ctx.fds, { noFunctions: true });
  throw new ExitSignal(status);
}

function* command(ctx: Ctx): Gen<number> {
  const p = parseOpts(ctx.argv.slice(1), 'pvV');
  if (p.bad) return badOption(ctx, p.bad, 'command [-pVv] command [arg ...]');
  if (!p.rest.length) return 0;
  if (p.flags.has('v') || p.flags.has('V')) {
    const desc = ctx.sh.describe(p.rest[0] ?? '');
    if (!desc) return p.flags.has('V') ? builtinError(ctx, `${p.rest[0] ?? ''}: not found`) : 1;
    ctx.out(`${p.flags.has('V') ? desc.long : desc.short}\n`);
    return 0;
  }
  return yield* ctx.sh.invoke(p.rest, ctx.fds, { noFunctions: true });
}

function* builtin(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  if (!args.length) return 0;
  return yield* ctx.sh.invoke(args, ctx.fds, { builtinOnly: true });
}

function letBuiltin(ctx: Ctx): number {
  if (ctx.argv.length < 2) return builtinError(ctx, 'expression expected');
  let last = 0n;
  try {
    for (const e of ctx.argv.slice(1)) last = ctx.sh.arith.eval(e);
  } catch (e) {
    if (e instanceof ArithError) return builtinError(ctx, e.message);
    throw e;
  }
  return last === 0n ? 1 : 0;
}

export const CORE: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  [':', () => 0], ['true', () => 0], ['false', () => 1],
  ['echo', echo], ['printf', printf], ['exit', exit], ['logout', logout], ['return', ret],
  ['break', loop('break')], ['continue', loop('continue')], ['shift', shift],
  ['eval', evalBuiltin], ['source', source], ['.', source], ['exec', execBuiltin],
  ['command', command], ['builtin', builtin], ['let', letBuiltin],
]);
