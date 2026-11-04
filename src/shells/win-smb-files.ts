/**
 * The file commands of a Windows terminal on a share: dir, type, md, rd, del, ren, copy and move with a path on a
 * mapped drive (Z:\…) or a UNC path (\\srv\share\…), one SMB request at a time. The server decides what the session
 * may do (the share's read only, valid users and the Linux permissions of the account smbd works as); copy and move
 * also go between the local disk and a share, or from one share to another.
 */
import type { Host } from '../devices/host.ts';
import { smbCall } from '../clients/smb-client.ts';
import type { SmbClientStatus, SmbResult } from '../clients/smb-client.ts';
import type { SmbEntry, SmbOp } from '../net/smb-types.ts';
import { MAX_TOTAL, basename } from '../bash/vfs.ts';
import { DENIED, NO_DRIVE, NO_FILE, NOT_FOUND, SYNTAX, fsMessage, inDir } from './win-fsctx.ts';
import type { Confirm, WinFs } from './win-fsctx.ts';
import { dirDate, thousands } from './win-dir.ts';
import { hasWildcard, wildMatch } from './win-path.ts';
import { smbTarget } from './win-smb.ts';
import type { SmbTarget } from './win-smb.ts';

const SERIAL = '9A3C-51E2';
const COMMANDS = new Set(['dir', 'type', 'md', 'mkdir', 'rd', 'rmdir', 'del', 'erase', 'ren', 'rename', 'copy', 'move']);

const call = (t: SmbTarget, req: SmbOp): SmbResult => smbCall(t.host, t.ip, t.login, t.share, req);
const at = (t: SmbTarget, path: string): SmbTarget => ({ ...t, path });
const parentOf = (path: string): string => path.replace(/\\[^\\]*$/, '') || '\\';
const child = (path: string, name: string): string => `${path === '\\' ? '' : path}\\${name}`;
/** Z:\dir, or \\srv\share\dir (the root of a UNC path has no backslash after the share). */
const shown = (t: SmbTarget, path = t.path): string => (path === '\\' ? (t.root.endsWith(':') ? `${t.root}\\` : t.root) : `${t.root}${path}`);
const count = (n: number, move: boolean): string => `        ${n} file(s) ${move ? 'moved' : 'copied'}.`;
const ONTO_ITSELF = 'The file cannot be copied onto itself.';
/** One remote file, whatever drive or UNC name reaches it (share names ignore case; smbd here keeps the file's). */
const fileKey = (t: SmbTarget, path: string): string => `${t.ip}|${t.share.toLowerCase()}|${path}`;

/** cmd.exe's wording of an SMB answer. */
function message(status: SmbClientStatus, notFound = NO_FILE): string {
  switch (status) {
    case 'NT_STATUS_OBJECT_NAME_NOT_FOUND': case 'NT_STATUS_NOT_A_DIRECTORY': return notFound;
    case 'NT_STATUS_OBJECT_PATH_SYNTAX_BAD': return 'The filename, directory name, or volume label syntax is incorrect.';
    case 'NT_STATUS_ACCESS_DENIED': case 'NT_STATUS_FILE_IS_A_DIRECTORY': return DENIED;
    case 'NT_STATUS_OBJECT_NAME_COLLISION': return 'A duplicate file name exists, or the file cannot be found.';
    case 'NT_STATUS_DIRECTORY_NOT_EMPTY': return 'The directory is not empty.';
    case 'NT_STATUS_DISK_FULL': return 'There is not enough space on the disk.';
    case 'NT_STATUS_LOGON_FAILURE': return 'The user name or password is incorrect.';
    case 'NT_STATUS_BAD_NETWORK_NAME': return 'The network name cannot be found.';
    case 'NT_STATUS_CONNECTION_REFUSED': case 'NT_STATUS_IO_TIMEOUT': case 'NT_STATUS_HOST_UNREACHABLE': return 'The network path was not found.';
    default: return 'An unexpected network error occurred.';
  }
}

interface Found {
  readonly dir: string;
  readonly entries: readonly SmbEntry[];
  /** A whole folder (with . and ..), not a wildcard or one entry. */
  readonly whole: boolean;
}

/** What a remote path names: a folder's entries, the matches of a wildcard or a single entry. */
function expand(t: SmbTarget): Found | string {
  const last = t.path.slice(t.path.lastIndexOf('\\') + 1);
  if (hasWildcard(last)) {
    const r = call(at(t, parentOf(t.path)), { op: 'list', path: parentOf(t.path) });
    if (r.status !== 'NT_STATUS_OK') return message(r.status, NOT_FOUND);
    const entries = (r.entries ?? []).filter((e) => e.name !== '.' && e.name !== '..' && wildMatch(last, e.name));
    return entries.length ? { dir: parentOf(t.path), entries, whole: false } : NOT_FOUND;
  }
  const s = call(t, { op: 'stat', path: t.path });
  if (s.status !== 'NT_STATUS_OK' || !s.entry) return message(s.status, NOT_FOUND);
  if (!s.entry.dir) return { dir: parentOf(t.path), entries: [{ ...s.entry, name: last }], whole: false };
  const r = call(t, { op: 'list', path: t.path });
  return r.status === 'NT_STATUS_OK' ? { dir: t.path, entries: r.entries ?? [], whole: true } : message(r.status, NOT_FOUND);
}

function dir(t: SmbTarget): string[] {
  const found = expand(t);
  const head = [` Volume in drive ${t.root.replace(/:$/, '')} is ${t.share}`, ` Volume Serial Number is ${SERIAL}`, ''];
  if (typeof found === 'string') return [...head, ` Directory of ${shown(t, parentOf(t.path))}`, '', found];
  const entries = found.whole ? found.entries : found.entries.filter((e) => e.name !== '.' && e.name !== '..');
  const rows = entries.map((e) => (e.dir ? `${dirDate(e.mtime)}    <DIR>          ${e.name}` : `${dirDate(e.mtime)} ${thousands(e.size).padStart(17)} ${e.name}`));
  const files = entries.filter((e) => !e.dir);
  const bytes = files.reduce((n, e) => n + e.size, 0);
  return [...head, ` Directory of ${shown(t, found.dir)}`, '', ...rows,
    `${String(files.length).padStart(16)} File(s) ${thousands(bytes).padStart(14)} bytes`,
    `${String(entries.length - files.length).padStart(16)} Dir(s) ${thousands(MAX_TOTAL).padStart(15)} bytes free`];
}

function type(t: SmbTarget): string[] {
  const r = call(t, { op: 'read', path: t.path });
  if (r.status !== 'NT_STATUS_OK') return [message(r.status)];
  const data = r.data ?? '';
  return data === '' ? [] : data.replace(/\n$/, '').split('\n');
}

function md(t: SmbTarget, input: string): string[] {
  if (call(t, { op: 'stat', path: t.path }).status === 'NT_STATUS_OK') return [`A subdirectory or file ${input} already exists.`];
  const r = call(t, { op: 'mkdir', path: t.path });
  return r.status === 'NT_STATUS_OK' ? [] : [message(r.status, 'The system cannot find the path specified.')];
}

function rd(t: SmbTarget): string[] {
  const r = call(t, { op: 'rmdir', path: t.path });
  if (r.status === 'NT_STATUS_NOT_A_DIRECTORY') return ['The directory name is invalid.'];
  return r.status === 'NT_STATUS_OK' ? [] : [message(r.status)];
}

/** del: the files of a name, a wildcard or a folder (a folder or * asks first, unless /Q). */
function del(t: SmbTarget, quiet: boolean): string[] | Confirm {
  const found = expand(t);
  if (typeof found === 'string') return [`Could Not Find ${shown(t)}`];
  const files = found.entries.filter((e) => !e.dir);
  const go = (): string[] => files.flatMap((e) => {
    const r = call(t, { op: 'remove', path: child(found.dir, e.name) });
    return r.status === 'NT_STATUS_OK' ? [] : [shown(t, child(found.dir, e.name)), message(r.status)];
  });
  const everything = found.whole || /^\*(\.\*)?$/.test(t.path.slice(t.path.lastIndexOf('\\') + 1));
  if (!everything || quiet) return go();
  return { question: `${shown(t, found.dir)}\\*, Are you sure (Y/N)? `, accept: /^\s*y/i, yes: go, no: () => [] };
}

function ren(t: SmbTarget, name: string): string[] {
  if (/[\\/:*?]/.test(name)) return [SYNTAX];
  const r = call(t, { op: 'rename', path: t.path, to: child(parentOf(t.path), name) });
  return r.status === 'NT_STATUS_OK' ? [] : [message(r.status)];
}

/** One end of copy or move: a share or the local disk. */
interface Source {
  readonly name: string;
  /** fileKey of a remote source, to refuse writing it onto itself. */
  readonly key?: string;
  readonly read: () => string | { error: string };
  readonly drop: () => string | null;
}

function remoteSources(t: SmbTarget): Source[] | string {
  const found = expand(t);
  if (typeof found === 'string') return NO_FILE;
  return found.entries.filter((e) => !e.dir).map((e) => {
    const path = child(found.dir, e.name);
    return {
      name: e.name,
      key: fileKey(t, path),
      read: () => { const r = call(t, { op: 'read', path }); return r.status === 'NT_STATUS_OK' ? r.data ?? '' : { error: message(r.status) }; },
      drop: () => { const r = call(t, { op: 'remove', path }); return r.status === 'NT_STATUS_OK' ? null : message(r.status); },
    };
  });
}

function localSources(ctx: WinFs, input: string): Source[] | string {
  const found = ctx.listing(input);
  if (typeof found === 'string') return found === NO_DRIVE ? NO_DRIVE : NO_FILE;
  return found.names.map((n) => inDir(found.dir, n)).filter((f) => ctx.kindOf(f) === 'file').map((f) => ({
    name: basename(f),
    read: () => { try { return ctx.fs.readFile(f, ctx.cred); } catch (err) { return { error: fsMessage(err) }; } },
    drop: () => { try { ctx.fs.remove(f, ctx.cred); return null; } catch (err) { return fsMessage(err); } },
  }));
}

/** Writes one file at the destination (into it when it is a folder); null or the error. */
type Write = (name: string, data: string, many: boolean, key?: string) => string | null;

function writer(host: Host, ctx: WinFs, input: string): Write | string {
  const t = smbTarget(host, input);
  if (typeof t === 'string') return t;
  if (t) {
    const folder = t.path === '\\' || call(t, { op: 'stat', path: t.path }).entry?.dir === true;
    return (name, data, _many, key) => {
      const path = folder ? child(t.path, name) : t.path;
      if (key === fileKey(t, path)) return ONTO_ITSELF;
      const r = call(t, { op: 'write', path, data });
      return r.status === 'NT_STATUS_OK' ? null : message(r.status);
    };
  }
  const p = ctx.path(input);
  if (p === null) return NO_DRIVE;
  const folder = ctx.kindOf(p) === 'dir';
  return (name, data, many) => {
    try {
      ctx.fs.writeFile(folder ? inDir(p, name) : p, data, ctx.cred, many && !folder);
      return null;
    } catch (err) {
      return fsMessage(err);
    }
  };
}

function transfer(host: Host, ctx: WinFs, args: readonly string[], move: boolean): string[] {
  const [src, dst = '.'] = args.filter((a) => !a.startsWith('/'));
  if (!src) return [SYNTAX];
  const from = smbTarget(host, src);
  if (typeof from === 'string') return [from, count(0, move)];
  const sources = from ? remoteSources(from) : localSources(ctx, src);
  if (typeof sources === 'string' || !sources.length) return [typeof sources === 'string' ? sources : NO_FILE, count(0, move)];
  const write = writer(host, ctx, dst);
  if (typeof write === 'string') return [write, count(0, move)];
  let done = 0;
  for (const s of sources) {
    const data = s.read();
    const failed = typeof data === 'string' ? write(s.name, data, done > 0, s.key) ?? (move ? s.drop() : null) : data.error;
    if (failed) return [failed, count(done, move)];
    done++;
  }
  return [count(done, move)];
}

const operands = (args: readonly string[]): string[] => args.filter((a) => !a.startsWith('/'));

/** Runs a file command that reaches a share; null when none of its paths is remote (the local commands run it). */
export function smbFileCommand(host: Host, ctx: WinFs, cmd: string, args: readonly string[]): string[] | Confirm | null {
  if (!COMMANDS.has(cmd)) return null;
  const names = operands(args);
  const targets = names.map((n) => smbTarget(host, n));
  if (targets.every((t) => t === null)) return null;
  if (cmd === 'copy' || cmd === 'move') return transfer(host, ctx, args, cmd === 'move');
  const [t] = targets;
  const [input = ''] = names;
  if (typeof t === 'string') return [t];
  if (!t) return [NO_FILE];
  switch (cmd) {
    case 'dir': return dir(t);
    case 'type': return type(t);
    case 'md': case 'mkdir': return md(t, input);
    case 'rd': case 'rmdir': return rd(t);
    case 'ren': case 'rename': return names[1] ? ren(t, names[1]) : [SYNTAX];
    default: return del(t, args.some((a) => a.toLowerCase() === '/q'));
  }
}
