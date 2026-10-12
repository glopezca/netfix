/** Adapters from a host's VFS to the Apache reader (as root) and server (as www-data). */
import type { Vfs, Cred } from '../../bash/vfs.ts';
import { FsError } from '../../bash/vfs.ts';
import { matchPattern } from '../../bash/glob.ts';
import type { ConfReader } from './model.ts';
import type { FsResult, WebEntry, WebFs } from './serve.ts';

export const WWW_DATA: Cred = { uid: 33, gid: 33, groups: [33] };

export function confReader(fs: Vfs): ConfReader {
  return {
    read: (path) => {
      try { return fs.readFile(path); } catch { return null; }
    },
    glob: (pattern) => {
      const slash = pattern.lastIndexOf('/');
      const dir = pattern.slice(0, slash) || '/';
      const base = pattern.slice(slash + 1);
      let names: string[];
      try { names = fs.readdir(dir); } catch { return []; }
      return names.filter((n) => matchPattern(base, n) && fs.tryLookup(`${dir}/${n}`)?.kind === 'file').sort().map((n) => `${dir}/${n}`);
    },
  };
}

function attempt<T>(fn: () => T): FsResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    return { ok: false, code: e.code === 'EACCES' ? 'EACCES' : e.code === 'ENOTDIR' ? 'ENOTDIR' : 'ENOENT' };
  }
}

export function webFs(fs: Vfs, cred: Cred = WWW_DATA): WebFs {
  return {
    kind: (path) => attempt(() => (fs.stat(path, cred).kind === 'dir' ? 'dir' as const : 'file' as const)),
    read: (path) => attempt(() => {
      if (fs.stat(path, cred).kind === 'dir') throw new FsError('ENOENT');
      return fs.readFile(path, cred);
    }),
    list: (dir) => attempt((): WebEntry[] => fs.readdir(dir, cred).map((name) => {
      const st = fs.stat(`${dir === '/' ? '' : dir}/${name}`, cred);
      return { name, dir: st.kind === 'dir', size: st.size, mtime: st.mtime };
    })),
  };
}
