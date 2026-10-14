/** mc (Midnight Commander): a full-screen file manager working with the user's credentials. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import type { McEntry, McFs } from '../../editors/mc-fs.ts';
import { McApp } from '../../editors/mc.ts';
import { MC_RELEASE } from '../../editors/mc-credits.ts';
import { bufferSink } from '../io.ts';
import { runSync } from '../run-sync.ts';
import { errMsg } from './common.ts';
import { normalize } from '../vfs.ts';

const MC_VERSION = `GNU Midnight Commander ${MC_RELEASE}\nBuilt with GLib 2.84.1\nUsing the S-Lang library with terminfo database\nWith builtin Editor and Aspell support\n`;

/** Runs a file utility (cp, mv, rm, mkdir) in a copy of the shell; returns its error text or null. */
function run(ctx: Ctx, argv: readonly string[]): string | null {
  const err = bufferSink();
  const fds = new Map([[0, { read: { kind: 'null' as const } }], [1, { write: { kind: 'null' as const } }], [2, { write: err }]]);
  const status = runSync(ctx.sh.clone().invoke(argv, fds));
  return status === 0 ? null : err.chunks.join('').trim() || `${argv[0]}: error ${status}`;
}

function entries(ctx: Ctx, dir: string): McEntry[] | string {
  const fs = ctx.sh.env.fs;
  try {
    return fs.readdir(dir, ctx.cred).map((name) => {
      const path = normalize(name, dir);
      const l = fs.stat(path, ctx.cred, false);
      const s = l.kind === 'link' ? fs.tryLookup(path, ctx.cred) : undefined;
      const st = s ? fs.stat(path, ctx.cred) : l;
      return { name, dir: st.kind === 'dir', link: l.kind === 'link', exec: st.kind === 'file' && (st.mode & 0o111) !== 0, size: st.size, mtime: st.mtime };
    });
  } catch (e) {
    return `Cannot read directory contents: ${errMsg(e)}`;
  }
}

export function mcFs(ctx: Ctx): McFs {
  const fs = ctx.sh.env.fs;
  return {
    home: ctx.sh.user.home,
    list: (dir) => entries(ctx, dir),
    read: (path) => { try { return fs.readFile(path, ctx.cred); } catch (e) { return { error: errMsg(e) }; } },
    write: (path, content) => { try { fs.writeFile(path, content, ctx.cred); return null; } catch (e) { return errMsg(e); } },
    copy: (sources, target) => run(ctx, ['cp', '-r', '--', ...sources, target]),
    move: (sources, target) => run(ctx, ['mv', '--', ...sources, target]),
    remove: (paths) => run(ctx, ['rm', '-rf', '--', ...paths]),
    mkdir: (path) => run(ctx, ['mkdir', '-p', '--', path]),
    prompt: (dir) => `${ctx.sh.user.name}@${ctx.sh.startHostname}:${dir === ctx.sh.user.home ? '~' : dir.startsWith(`${ctx.sh.user.home}/`) ? `~${dir.slice(ctx.sh.user.home.length)}` : dir}${ctx.cred.uid === 0 ? '#' : '$'} `,
  };
}

function* mc(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  if (args.includes('-V') || args.includes('--version')) { ctx.out(MC_VERSION); return 0; }
  const dirs = args.filter((a) => !a.startsWith('-')).map((a) => ctx.resolve(a));
  for (const d of dirs) {
    if (ctx.sh.env.fs.tryLookup(d, ctx.cred)?.kind !== 'dir') { ctx.err(`mc: ${d}: No such directory\n`); return 1; }
  }
  const app = new McApp(mcFs(ctx), dirs[0] ?? ctx.cwd, dirs[1] ?? dirs[0] ?? ctx.cwd);
  yield { kind: 'screen', app };
  return 0;
}

export const MC_TOOLS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['mc', mc]]);
