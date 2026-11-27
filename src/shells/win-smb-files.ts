/**
 * The file commands of a Windows terminal on a share: dir, type, md, rd, del, ren, copy and move with a path on a
 * mapped drive (Z:\…) or a UNC path (\\srv\share\…), one SMB request at a time. The server decides what the session
 * may do (the share's read only, valid users and the Linux permissions of the account smbd works as); copy and move
 * also go between the local disk and a share, or from one share to another.
 */
import type { Host } from '../devices/host.ts';
import { smbCallSteps } from '../clients/smb-client.ts';
import { runSteps, type Steps } from '../net/live-wait.ts';
import type { SmbClientStatus, SmbResult } from '../clients/smb-client.ts';
import type { SmbEntry, SmbOp } from '../net/smb-types.ts';
import { MAX_TOTAL, basename } from '../bash/vfs.ts';
import { DENIED, NO_DRIVE, NO_FILE, NOT_FOUND, SYNTAX, fsMessage, inDir } from './win-fsctx.ts';
import type { Confirm, WinFs } from './win-fsctx.ts';
import { dirDate, thousands } from './win-dir.ts';
import { hasWildcard, wildMatch } from './win-path.ts';
import { onShare, smbTargetSteps } from './win-smb.ts';
import type { SmbTarget } from './win-smb.ts';

const SERIAL = '9A3C-51E2';
const COMMANDS = new Set(['dir', 'type', 'md', 'mkdir', 'rd', 'rmdir', 'del', 'erase', 'ren', 'rename', 'copy', 'move']);

/** One SMB request as steps (0.95.0): waited for live when the share is outside the page. */
const call = (t: SmbTarget, req: SmbOp): Steps<SmbResult> => smbCallSteps(t.host, t.ip, t.login, t.share, req);
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
export function smbMessage(status: SmbClientStatus, notFound = NO_FILE): string {
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
function* expand(t: SmbTarget): Steps<Found | string> {
  const last = t.path.slice(t.path.lastIndexOf('\\') + 1);
  if (hasWildcard(last)) {
    const r = yield* call(at(t, parentOf(t.path)), { op: 'list', path: parentOf(t.path) });
    if (r.status !== 'NT_STATUS_OK') return smbMessage(r.status, NOT_FOUND);
    const entries = (r.entries ?? []).filter((e) => e.name !== '.' && e.name !== '..' && wildMatch(last, e.name));
    return entries.length ? { dir: parentOf(t.path), entries, whole: false } : NOT_FOUND;
  }
  const s = yield* call(t, { op: 'stat', path: t.path });
  if (s.status !== 'NT_STATUS_OK' || !s.entry) return smbMessage(s.status, NOT_FOUND);
  if (!s.entry.dir) return { dir: parentOf(t.path), entries: [{ ...s.entry, name: last }], whole: false };
  const r = yield* call(t, { op: 'list', path: t.path });
  return r.status === 'NT_STATUS_OK' ? { dir: t.path, entries: r.entries ?? [], whole: true } : smbMessage(r.status, NOT_FOUND);
}

function* dir(t: SmbTarget): Steps<string[]> {
  const found = yield* expand(t);
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

function* type(t: SmbTarget): Steps<string[]> {
  const r = yield* call(t, { op: 'read', path: t.path });
  if (r.status !== 'NT_STATUS_OK') return [smbMessage(r.status)];
  const data = r.data ?? '';
  return data === '' ? [] : data.replace(/\n$/, '').split('\n');
}

function* md(t: SmbTarget, input: string): Steps<string[]> {
  if ((yield* call(t, { op: 'stat', path: t.path })).status === 'NT_STATUS_OK') return [`A subdirectory or file ${input} already exists.`];
  const r = yield* call(t, { op: 'mkdir', path: t.path });
  return r.status === 'NT_STATUS_OK' ? [] : [smbMessage(r.status, 'The system cannot find the path specified.')];
}

function* rd(t: SmbTarget): Steps<string[]> {
  const r = yield* call(t, { op: 'rmdir', path: t.path });
  if (r.status === 'NT_STATUS_NOT_A_DIRECTORY') return ['The directory name is invalid.'];
  return r.status === 'NT_STATUS_OK' ? [] : [smbMessage(r.status)];
}

/** del: the files of a name, a wildcard or a folder (a folder or * asks first, unless /Q). */
function* del(t: SmbTarget, quiet: boolean): Steps<string[] | Confirm> {
  const found = yield* expand(t);
  if (typeof found === 'string') return [`Could Not Find ${shown(t)}`];
  const files = found.entries.filter((e) => !e.dir);
  const go = function* (): Steps<string[]> {
    const out: string[] = [];
    for (const e of files) {
      const r = yield* call(t, { op: 'remove', path: child(found.dir, e.name) });
      if (r.status !== 'NT_STATUS_OK') out.push(shown(t, child(found.dir, e.name)), smbMessage(r.status));
    }
    return out;
  };
  const everything = found.whole || /^\*(\.\*)?$/.test(t.path.slice(t.path.lastIndexOf('\\') + 1));
  if (!everything || quiet) return yield* go();
  return { question: `${shown(t, found.dir)}\\*, Are you sure (Y/N)? `, accept: /^\s*y/i, yes: () => runSteps(t.host.hooks, go()), yesSteps: go, no: () => [] };
}

function* ren(t: SmbTarget, name: string): Steps<string[]> {
  if (/[\\/:*?]/.test(name)) return [SYNTAX];
  const r = yield* call(t, { op: 'rename', path: t.path, to: child(parentOf(t.path), name) });
  return r.status === 'NT_STATUS_OK' ? [] : [smbMessage(r.status)];
}

/** One end of copy or move: a share or the local disk. */
interface Source {
  readonly name: string;
  /** fileKey of a remote source, to refuse writing it onto itself. */
  readonly key?: string;
  readonly read: () => Steps<string | { error: string }>;
  readonly drop: () => Steps<string | null>;
}

function* remoteSources(t: SmbTarget): Steps<Source[] | string> {
  const found = yield* expand(t);
  if (typeof found === 'string') return NO_FILE;
  return found.entries.filter((e) => !e.dir).map((e) => {
    const path = child(found.dir, e.name);
    return {
      name: e.name,
      key: fileKey(t, path),
      read: function* () { const r = yield* call(t, { op: 'read', path }); return r.status === 'NT_STATUS_OK' ? r.data ?? '' : { error: smbMessage(r.status) }; },
      drop: function* () { const r = yield* call(t, { op: 'remove', path }); return r.status === 'NT_STATUS_OK' ? null : smbMessage(r.status); },
    };
  });
}

function localSources(ctx: WinFs, input: string): Source[] | string {
  const found = ctx.listing(input);
  if (typeof found === 'string') return found === NO_DRIVE ? NO_DRIVE : NO_FILE;
  return found.names.map((n) => inDir(found.dir, n)).filter((f) => ctx.kindOf(f) === 'file').map((f) => ({
    name: basename(f),
    read: function* () { try { return ctx.fs.readFile(f, ctx.cred); } catch (err) { return { error: fsMessage(err) }; } },
    drop: function* () { try { ctx.fs.remove(f, ctx.cred); return null; } catch (err) { return fsMessage(err); } },
  }));
}

/** Writes one file at the destination (into it when it is a folder); null or the error. */
type Write = (name: string, data: string, many: boolean, key?: string) => Steps<string | null>;

function* writer(host: Host, ctx: WinFs, input: string): Steps<Write | string> {
  const t = yield* smbTargetSteps(host, input);
  if (typeof t === 'string') return t;
  if (t) {
    const folder = t.path === '\\' || (yield* call(t, { op: 'stat', path: t.path })).entry?.dir === true;
    return function* (name, data, _many, key) {
      const path = folder ? child(t.path, name) : t.path;
      if (key === fileKey(t, path)) return ONTO_ITSELF;
      const r = yield* call(t, { op: 'write', path, data });
      return r.status === 'NT_STATUS_OK' ? null : smbMessage(r.status);
    };
  }
  const p = ctx.path(input);
  if (p === null) return NO_DRIVE;
  const folder = ctx.kindOf(p) === 'dir';
  return function* (name, data, many) {
    try {
      ctx.fs.writeFile(folder ? inDir(p, name) : p, data, ctx.cred, many && !folder);
      return null;
    } catch (err) {
      return fsMessage(err);
    }
  };
}

function* transfer(host: Host, ctx: WinFs, args: readonly string[], move: boolean): Steps<string[]> {
  const [src, dst = '.'] = args.filter((a) => !a.startsWith('/'));
  if (!src) return [SYNTAX];
  const from = yield* smbTargetSteps(host, src);
  if (typeof from === 'string') return [from, count(0, move)];
  const sources = from ? yield* remoteSources(from) : localSources(ctx, src);
  if (typeof sources === 'string' || !sources.length) return [typeof sources === 'string' ? sources : NO_FILE, count(0, move)];
  const write = yield* writer(host, ctx, dst);
  if (typeof write === 'string') return [write, count(0, move)];
  let done = 0;
  for (const s of sources) {
    const data = yield* s.read();
    const failed = typeof data === 'string' ? (yield* write(s.name, data, done > 0, s.key)) ?? (move ? yield* s.drop() : null) : data.error;
    if (failed) return [failed, count(done, move)];
    done++;
  }
  return [count(done, move)];
}

const operands = (args: readonly string[]): string[] => args.filter((a) => !a.startsWith('/'));

/**
 * A file command that reaches a share, as steps (0.95.0: waited for live when the share is outside the page); null
 * when none of its paths is on a share (the local commands run it). Whether one is, is known without the network.
 */
export function smbFileCommand(host: Host, ctx: WinFs, cmd: string, args: readonly string[]): Steps<string[] | Confirm> | null {
  if (!COMMANDS.has(cmd)) return null;
  const names = operands(args);
  if (!names.some((n) => onShare(host, n))) return null;
  return fileSteps(host, ctx, cmd, args, names);
}

function* fileSteps(host: Host, ctx: WinFs, cmd: string, args: readonly string[], names: readonly string[]): Steps<string[] | Confirm> {
  if (cmd === 'copy' || cmd === 'move') return yield* transfer(host, ctx, args, cmd === 'move');
  const targets: (SmbTarget | string | null)[] = [];
  for (const n of names) targets.push(yield* smbTargetSteps(host, n));
  // md and type take every name, as the local commands do (rd, del and dir one).
  if (cmd === 'md' || cmd === 'mkdir' || cmd === 'type') {
    const out: string[] = [];
    for (const [i, n] of names.entries()) {
      const each = targets[i];
      if (typeof each === 'string') out.push(each);
      else if (!each) out.push(NO_FILE);
      else out.push(...(cmd === 'type' ? yield* type(each) : yield* md(each, n)));
    }
    return out;
  }
  const [t] = targets;
  if (typeof t === 'string') return [t];
  if (!t) return [NO_FILE];
  switch (cmd) {
    case 'dir': return yield* dir(t);
    case 'rd': case 'rmdir': return yield* rd(t);
    case 'ren': case 'rename': return names[1] ? yield* ren(t, names[1]) : [SYNTAX];
    default: return yield* del(t, args.some((a) => a.toLowerCase() === '/q'));
  }
}
