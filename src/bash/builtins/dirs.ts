/** cd pwd pushd popd dirs. */
import type { CommandFn, Ctx } from '../types.ts';
import type { Interp } from '../interp.ts';
import { builtinError } from '../io.ts';
import { normalize, FsError, canAccess } from '../vfs.ts';
import { parseOpts, badOption } from './util.ts';

/** Changes directory (with CDPATH, -L/-P); returns an error message or null. */
export function changeDir(sh: Interp, target: string, physical: boolean): string | null {
  const fs = sh.env.fs;
  let candidates = [normalize(target, sh.cwd)];
  const cdpath = sh.getVar('CDPATH');
  if (cdpath && !target.startsWith('/') && !/^\.\.?(\/|$)/.test(target)) {
    candidates = [...cdpath.split(':').map((d) => normalize(target, normalize(d || '.', sh.cwd))), ...candidates];
  }
  for (const c of candidates) {
    const node = fs.tryLookup(c, sh.cred);
    if (!node) continue;
    if (node.kind !== 'dir') return `${target}: Not a directory`;
    if (!canAccess(node, sh.cred, 1)) return `${target}: Permission denied`;
    const dest = physical || sh.opt('physical') ? fs.realpath(c) : c;
    sh.setVar('OLDPWD', sh.cwd, { export: true });
    sh.cwd = dest;
    sh.setVar('PWD', dest, { export: true });
    return null;
  }
  try {
    fs.lookup(candidates[candidates.length - 1] ?? target, sh.cred);
  } catch (e) {
    if (e instanceof FsError) return `${target}: ${e.message}`;
  }
  return `${target}: No such file or directory`;
}

function cd(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'LPe@');
  if (p.bad) return badOption(ctx, p.bad, 'cd [-L|[-P [-e]] [-@]] [dir]');
  if (p.rest.length > 1) return builtinError(ctx, 'too many arguments');
  const sh = ctx.sh;
  let target = p.rest[0];
  let print = false;
  if (target === undefined) {
    target = sh.getVar('HOME');
    if (!target) return builtinError(ctx, 'HOME not set');
  } else if (target === '-') {
    target = sh.getVar('OLDPWD');
    if (!target) return builtinError(ctx, 'OLDPWD not set');
    print = true;
  }
  if (target === '') return 0;
  const err = changeDir(sh, target, p.flags.has('P'));
  if (err) return builtinError(ctx, err);
  if (print || (sh.getVar('CDPATH') && !target.startsWith('/') && normalize(target, sh.getVar('OLDPWD') ?? '/') !== sh.cwd)) ctx.out(`${sh.cwd}\n`);
  return 0;
}

function pwd(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'LP');
  if (p.bad) return badOption(ctx, p.bad, 'pwd [-LP]');
  ctx.out(`${p.flags.has('P') ? ctx.sh.env.fs.realpath(ctx.sh.cwd) : ctx.sh.cwd}\n`);
  return 0;
}

function tilde(sh: Interp, d: string): string {
  const home = sh.getVar('HOME');
  return home && (d === home || d.startsWith(`${home}/`)) ? `~${d.slice(home.length)}` : d;
}

function stack(sh: Interp): string[] {
  return [sh.cwd, ...sh.dirstack];
}

function printStack(ctx: Ctx, long: boolean, perLine: boolean, numbered: boolean): void {
  const items = stack(ctx.sh).map((d) => (long ? d : tilde(ctx.sh, d)));
  if (numbered) ctx.out(items.map((d, i) => ` ${i}  ${d}\n`).join(''));
  else ctx.out(perLine ? items.map((d) => `${d}\n`).join('') : `${items.join(' ')}\n`);
}

function dirs(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'clpv');
  if (p.bad) return badOption(ctx, p.bad, 'dirs [-clpv] [+N] [-N]');
  if (p.flags.has('c')) { ctx.sh.dirstack = []; return 0; }
  const n = p.rest[0];
  if (n !== undefined) {
    const items = stack(ctx.sh);
    const m = /^([+-])(\d+)$/.exec(n);
    const i = m ? (m[1] === '+' ? Number(m[2]) : items.length - 1 - Number(m[2])) : -1;
    if (i < 0 || i >= items.length) return builtinError(ctx, `${n}: directory stack index out of range`);
    ctx.out(`${p.flags.has('l') ? items[i] : tilde(ctx.sh, items[i] ?? '')}\n`);
    return 0;
  }
  printStack(ctx, p.flags.has('l'), p.flags.has('p') || p.flags.has('v'), p.flags.has('v'));
  return 0;
}

function pushd(ctx: Ctx): number {
  const sh = ctx.sh;
  const args = ctx.argv.slice(1).filter((a) => a !== '-n');
  const noCd = ctx.argv.includes('-n');
  const arg = args[0];
  if (arg === undefined) {
    if (!sh.dirstack.length) return builtinError(ctx, 'no other directory');
    const top = sh.dirstack[0] ?? '';
    const err = changeDir(sh, top, false);
    if (err) return builtinError(ctx, err);
    sh.dirstack[0] = sh.getVar('OLDPWD') ?? '/';
  } else if (/^[+-]\d+$/.test(arg)) {
    const items = stack(sh);
    const k = arg.startsWith('+') ? Number(arg.slice(1)) : items.length - 1 - Number(arg.slice(1));
    if (k < 0 || k >= items.length) return builtinError(ctx, `${arg}: directory stack index out of range`);
    const rotated = [...items.slice(k), ...items.slice(0, k)];
    const err = changeDir(sh, rotated[0] ?? '/', false);
    if (err) return builtinError(ctx, err);
    sh.dirstack = rotated.slice(1);
  } else if (noCd) {
    sh.dirstack.unshift(normalize(arg, sh.cwd));
  } else {
    const old = sh.cwd;
    const err = changeDir(sh, arg, false);
    if (err) return builtinError(ctx, err);
    sh.dirstack.unshift(old);
  }
  printStack(ctx, false, false, false);
  return 0;
}

function popd(ctx: Ctx): number {
  const sh = ctx.sh;
  const arg = ctx.argv.slice(1).find((a) => a !== '-n');
  if (!sh.dirstack.length) return builtinError(ctx, 'directory stack empty');
  if (arg && /^[+-]\d+$/.test(arg)) {
    const items = stack(sh);
    const k = arg.startsWith('+') ? Number(arg.slice(1)) : items.length - 1 - Number(arg.slice(1));
    if (k < 0 || k >= items.length) return builtinError(ctx, `${arg}: directory stack index out of range`);
    if (k === 0) {
      const err = changeDir(sh, sh.dirstack.shift() ?? '/', false);
      if (err) return builtinError(ctx, err);
    } else sh.dirstack.splice(k - 1, 1);
  } else if (!ctx.argv.includes('-n')) {
    const err = changeDir(sh, sh.dirstack[0] ?? '/', false);
    if (err) return builtinError(ctx, err);
    sh.dirstack.shift();
  } else sh.dirstack.shift();
  printStack(ctx, false, false, false);
  return 0;
}

export const DIRS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['cd', cd], ['pwd', pwd], ['dirs', dirs], ['pushd', pushd], ['popd', popd]]);
