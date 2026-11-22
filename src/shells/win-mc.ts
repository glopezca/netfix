/**
 * mc.exe: Midnight Commander on the Windows disk (from Git's usr\bin, like nano.exe and vim.exe). The same two panels as
 * on GNU/Linux, with Windows paths (C:\...) and the permissions of the terminal's account; it never goes above C:\.
 */
import type { McEntry, McFs } from '../editors/mc-fs.ts';
import { McApp } from '../editors/mc.ts';
import type { WinFs } from './win-fsctx.ts';
import { fsMessage, inDir, NO_PATH } from './win-fsctx.ts';
import { WIN_ROOT, resolveWinPath, toWindowsPath } from './win-path.ts';

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

function entries(ctx: WinFs, dir: string): McEntry[] | string {
  try {
    return ctx.fs.readdir(dir, ctx.cred).map((name) => {
      const path = inDir(dir, name);
      const l = ctx.fs.stat(path, ctx.cred, false);
      const st = l.kind === 'link' && ctx.fs.tryLookup(path, ctx.cred) ? ctx.fs.stat(path, ctx.cred) : l;
      // Windows marks programs by their extension, not by a mode bit.
      return { name, dir: st.kind === 'dir', link: l.kind === 'link', exec: st.kind === 'file' && /\.(exe|bat|cmd)$/i.test(name), size: st.size, mtime: st.mtime };
    });
  } catch (e) {
    return `Cannot read directory contents: ${fsMessage(e, NO_PATH)}`;
  }
}

class IntoItself extends Error {}

function copyTree(ctx: WinFs, from: string, to: string): void {
  if (to === from || to.startsWith(`${from}/`)) throw new IntoItself('Cannot copy a directory into itself');
  // A link is copied as a link (as cp -r does): following it could loop back into the folder being copied.
  const node = ctx.fs.tryLookup(from, ctx.cred, false);
  if (node?.kind === 'link') { ctx.fs.symlink(node.target, to, ctx.cred); return; }
  if (ctx.fs.stat(from, ctx.cred).kind !== 'dir') { ctx.fs.writeFile(to, ctx.fs.readFile(from, ctx.cred), ctx.cred); return; }
  if (!ctx.fs.tryLookup(to, ctx.cred)) ctx.fs.mkdir(to, ctx.cred);
  for (const n of ctx.fs.readdir(from, ctx.cred)) copyTree(ctx, inDir(from, n), inDir(to, n));
}

/** Each source into `target` (a folder) or onto it (one source); stops at the first error, as mc's message. */
function each(ctx: WinFs, sources: readonly string[], target: string, op: (from: string, to: string) => void): string | null {
  const intoDir = ctx.kindOf(target) === 'dir';
  try {
    for (const s of sources) op(s, intoDir ? inDir(target, base(s)) : target);
    return null;
  } catch (e) {
    return e instanceof IntoItself ? e.message : fsMessage(e);
  }
}

/** `edit`: the host's editor program (shells/programs.ts `editor`), given a C:\\ path; mc's nano without it. */
export function winMcFs(ctx: WinFs, edit?: (windowsPath: string) => string | null, run?: McFs['run'], profile?: string): McFs {
  const tryFs = (f: () => void): string | null => { try { f(); return null; } catch (e) { return fsMessage(e); } };
  return {
    ...(edit ? { edit: (path: string) => edit(toWindowsPath(path)) } : {}),
    ...(run ? { run } : {}),
    home: WIN_ROOT,
    root: WIN_ROOT,
    windows: true,
    ...(profile ? { profile } : {}),
    list: (dir) => entries(ctx, dir),
    read: (path) => { try { return ctx.fs.readFile(path, ctx.cred); } catch (e) { return { error: fsMessage(e) }; } },
    write: (path, content) => tryFs(() => ctx.fs.writeFile(path, content, ctx.cred)),
    copy: (sources, target) => each(ctx, sources, target, (a, b) => copyTree(ctx, a, b)),
    move: (sources, target) => each(ctx, sources, target, (a, b) => ctx.fs.rename(a, b, ctx.cred)),
    remove: (paths) => tryFs(() => { for (const p of paths) ctx.fs.remove(p, ctx.cred, true, true); }),
    mkdir: (path) => tryFs(() => ctx.fs.mkdir(path, ctx.cred, true)),
    prompt: (dir) => `${toWindowsPath(dir)}>`,
    show: toWindowsPath,
    parse: (text, dir) => { const r = resolveWinPath(ctx.fs, dir, text, ctx.cred); return r.ok ? r.path : null; },
  };
}

/** mc.exe [left [right]]: the app on the current folder (or the ones given), or the error to print. */
export function startWinMc(ctx: WinFs, args: readonly string[], edit?: (windowsPath: string) => string | null, run?: McFs['run'], profile?: string): McApp | string[] {
  const dirs: string[] = [];
  for (const a of args.filter((x) => !x.startsWith('-'))) {
    const p = ctx.path(a);
    if (p === null || ctx.kindOf(p) !== 'dir') return [`mc: ${a}: No such directory`];
    dirs.push(p);
  }
  return new McApp(winMcFs(ctx, edit, run, profile), dirs[0] ?? ctx.cwd, dirs[1] ?? dirs[0] ?? ctx.cwd, dirs.length === 0);
}
