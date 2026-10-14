/**
 * sftp-server: SFTP requests run on the server's file system with the credentials of the logged-in user
 * (the VFS is the only permission authority), relative paths start at the user's home directory.
 */
import type { SftpEntry, SftpOp, SftpResult } from '../net/packets.ts';
import type { Cred, StatInfo, Vfs } from '../bash/vfs.ts';
import { FsError } from '../bash/vfs.ts';

export interface SftpUser {
  readonly cred: Cred;
  readonly home: string;
  /** uid/gid → name (ls -l in the client). */
  readonly names: { user(uid: number): string; group(gid: number): string };
}

const FILE_MODE = 0o644;
const DIR_MODE = 0o755;
const MAX_ENTRIES = 2000;

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

export function resolveSftp(home: string, path: string): string {
  const p = path.trim() || '.';
  return normalize(p.startsWith('/') ? p : `${home}/${p}`);
}

function failure(e: unknown): SftpResult {
  // A malformed request must not escape into the network loop: it is a plain SSH_FX_FAILURE.
  if (!(e instanceof FsError)) return { status: 'failure', message: 'Failure' };
  if (e.code === 'ENOENT') return { status: 'no-such-file', message: 'No such file or directory' };
  if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS') return { status: 'permission-denied', message: 'Permission denied' };
  if (e.code === 'ENOTEMPTY') return { status: 'failure', message: 'Directory not empty' };
  if (e.code === 'EEXIST') return { status: 'failure', message: 'File exists' };
  if (e.code === 'EISDIR') return { status: 'failure', message: 'Is a directory' };
  if (e.code === 'ENOTDIR') return { status: 'failure', message: 'Not a directory' };
  return { status: 'failure', message: 'Failure' };
}

function entryOf(name: string, st: StatInfo, u: SftpUser): SftpEntry {
  const kind = st.kind === 'file' || st.kind === 'dir' || st.kind === 'link' ? st.kind : 'other';
  return { name, kind, size: st.size, mode: st.mode, mtime: st.mtime, owner: u.names.user(st.uid), group: u.names.group(st.gid) };
}

function list(fs: Vfs, u: SftpUser, path: string): SftpResult {
  const names = fs.readdir(path, u.cred).slice(0, MAX_ENTRIES);
  const entries = names.flatMap((n) => {
    try {
      return [entryOf(n, fs.stat(`${path === '/' ? '' : path}/${n}`, u.cred, false), u)];
    } catch {
      return [];
    }
  });
  return { status: 'ok', path, entries };
}

function run(fs: Vfs, u: SftpUser, req: SftpOp): SftpResult {
  const path = resolveSftp(u.home, req.path);
  switch (req.op) {
    case 'realpath': {
      const st = fs.stat(path, u.cred);
      return { status: 'ok', path, entry: entryOf(path, st, u) };
    }
    case 'list': return list(fs, u, path);
    case 'stat': return { status: 'ok', path, entry: entryOf(path.split('/').pop() || '/', fs.stat(path, u.cred), u) };
    case 'read': return { status: 'ok', path, data: fs.readFile(path, u.cred) };
    case 'write': fs.writeFile(path, req.data, u.cred, false, FILE_MODE); return { status: 'ok', path };
    case 'mkdir': fs.mkdir(path, u.cred, false, DIR_MODE); return { status: 'ok', path };
    case 'rmdir':
      if (fs.stat(path, u.cred, false).kind !== 'dir') return { status: 'failure', message: 'Not a directory' };
      fs.remove(path, u.cred, false, true);
      return { status: 'ok', path };
    case 'remove':
      if (fs.stat(path, u.cred, false).kind === 'dir') return { status: 'failure', message: 'Is a directory' };
      fs.remove(path, u.cred);
      return { status: 'ok', path };
    case 'rename': fs.rename(path, resolveSftp(u.home, req.to), u.cred); return { status: 'ok', path };
    case 'chmod': fs.chmod(path, req.mode & 0o7777, u.cred); return { status: 'ok', path };
  }
}

/** Runs one request; file system errors become SFTP status codes. */
export function sftpRequest(fs: Vfs, u: SftpUser, req: SftpOp): SftpResult {
  try {
    return run(fs, u, req);
  } catch (e) {
    return failure(e);
  }
}
