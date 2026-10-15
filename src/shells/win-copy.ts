/**
 * copy and move of the Windows terminal: one file or the files of a wildcard (or of a folder) into a folder or onto a
 * file (several sources onto one file are joined, as copy does); move also renames or moves a whole folder. An
 * existing file is overwritten after asking, unless /Y is given.
 */
import { basename } from '../bash/vfs.ts';
import { toWindowsPath } from './win-path.ts';
import { NO_DRIVE, NO_FILE, SYNTAX, fsMessage, inDir } from './win-fsctx.ts';
import type { Confirm, WinFs } from './win-fsctx.ts';

export type Outcome = string[] | Confirm;

const count = (n: number, move: boolean, dirs = false): string => `        ${n} ${dirs ? 'dir' : 'file'}(s) ${move ? 'moved' : 'copied'}.`;

function put(ctx: WinFs, from: string, to: string, move: boolean): void {
  if (move) ctx.fs.rename(from, to, ctx.cred);
  else ctx.fs.writeFile(to, ctx.fs.readFile(from, ctx.cred), ctx.cred);
}

/** One file onto `target`: asks before overwriting another file. */
function single(ctx: WinFs, from: string, target: string, move: boolean, force: boolean): Outcome {
  if (ctx.fs.realpath(from) === (ctx.kindOf(target) ? ctx.fs.realpath(target) : target)) return ['The file cannot be copied onto itself.', count(0, move)];
  const go = (): string[] => {
    try {
      put(ctx, from, target, move);
      return [count(1, move)];
    } catch (err) {
      return [fsMessage(err), count(0, move)];
    }
  };
  if (force || ctx.kindOf(target) !== 'file') return go();
  return { question: `Overwrite ${toWindowsPath(target)}? (Yes/No/All): `, accept: /^\s*[ya]/i, yes: go, no: () => [count(0, move)] };
}

/** move of a folder: renamed, or moved into the destination folder. */
function moveFolder(ctx: WinFs, from: string, to: string): string[] {
  const target = ctx.kindOf(to) === 'dir' ? inDir(to, basename(from)) : to;
  if (ctx.kindOf(target)) return ['Access is denied.', count(0, true, true)];
  try {
    ctx.fs.rename(from, target, ctx.cred);
    return [count(1, true, true)];
  } catch (err) {
    return [fsMessage(err), count(0, true, true)];
  }
}

/** Several files: into a folder one by one, or (copy) joined onto one file. */
function many(ctx: WinFs, sources: readonly string[], to: string, move: boolean): string[] {
  if (ctx.kindOf(to) !== 'dir') {
    if (move) return ['Cannot move multiple files to a single file.', count(0, true)];
    try {
      ctx.fs.writeFile(to, sources.map((f) => ctx.fs.readFile(f, ctx.cred)).join(''), ctx.cred);
      return [...sources.map((f) => basename(f)), count(1, false)];
    } catch (err) {
      return [fsMessage(err), count(0, false)];
    }
  }
  let done = 0;
  for (const f of sources) {
    try {
      put(ctx, f, inDir(to, basename(f)), move);
      done++;
    } catch (err) {
      return [fsMessage(err), count(done, move)];
    }
  }
  return [count(done, move)];
}

export function transfer(ctx: WinFs, args: readonly string[], move: boolean): Outcome {
  const force = args.some((a) => a.toLowerCase() === '/y');
  const [src, dst = '.'] = args.filter((a) => !a.startsWith('/'));
  if (!src) return [SYNTAX];
  const from = ctx.path(src);
  const to = ctx.path(dst);
  if (from === null || to === null) return [NO_DRIVE];
  if (move && ctx.kindOf(from) === 'dir') return moveFolder(ctx, from, to);
  const found = ctx.listing(src);
  if (typeof found === 'string') return [NO_FILE, count(0, move)];
  const sources = found.names.map((n) => inDir(found.dir, n)).filter((f) => ctx.kindOf(f) === 'file');
  if (!sources.length) return [NO_FILE, count(0, move)];
  const [only] = sources;
  if (sources.length === 1 && only) return single(ctx, only, ctx.kindOf(to) === 'dir' ? inDir(to, basename(only)) : to, move, force);
  return many(ctx, sources, to, move);
}
