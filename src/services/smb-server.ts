/**
 * smbd: answers SMB requests on TCP 445 from /etc/samba/smb.conf (read again on every request, as smbd notices a
 * changed file) and the Samba accounts. A session is a Samba user proving their NT hash, or the guest (nobody) when
 * anonymous or, with «map to guest = bad user», an unknown name. Every file operation runs with the permissions of
 * that Linux account, inside the share's directory: «..» is refused and a link that leads out of it is denied.
 * Windows serves the shares of its SMB panel instead (smb-windows.ts), with the same file operations.
 */
import type { Host } from '../devices/host.ts';
import type { AppPayload } from '../net/packets.ts';
import type { SmbEntry, SmbOp, SmbReply, SmbRequest, SmbShareInfo, SmbStatus } from '../net/smb-types.ts';
import type { Cred, Vfs } from '../bash/vfs.ts';
import { FsError, canAccess } from '../bash/vfs.ts';
import { hostFs } from '../devices/host-fs.ts';
import { DEFAULT_SMB_CONF, SMB_CONF, findShare, parseSmbConf, serverComment } from './smb-conf.ts';
import type { SmbConf, SmbShare } from './smb-conf.ts';
import { readPassdb, unixAccount } from './smb-passdb.ts';
import { groupNames } from './ssh-auth.ts';
import { windowsShareList, windowsTree } from './smb-windows.ts';
import type { SmbTree } from './smb-windows.ts';

const NOBODY = 65534;
const FILE_MODE = 0o744;
const DIR_MODE = 0o755;

interface Session {
  readonly name: string;
  readonly cred: Cred;
  readonly guest: boolean;
}

const GUEST: Session = { name: 'nobody', cred: { uid: NOBODY, gid: NOBODY, groups: [NOBODY] }, guest: true };
const fail = (status: SmbStatus): SmbReply => ({ status });
/** Paths on the server are absolute, so a string that starts as a status is one. */
const isStatus = (v: string): v is SmbStatus => v.startsWith('NT_STATUS_');

const FS_STATUS: Readonly<Record<string, SmbStatus>> = {
  ENOENT: 'NT_STATUS_OBJECT_NAME_NOT_FOUND', EACCES: 'NT_STATUS_ACCESS_DENIED', EPERM: 'NT_STATUS_ACCESS_DENIED',
  EROFS: 'NT_STATUS_ACCESS_DENIED', EEXIST: 'NT_STATUS_OBJECT_NAME_COLLISION', EISDIR: 'NT_STATUS_FILE_IS_A_DIRECTORY',
  ENOTDIR: 'NT_STATUS_NOT_A_DIRECTORY', ENOTEMPTY: 'NT_STATUS_DIRECTORY_NOT_EMPTY', ENOSPC: 'NT_STATUS_DISK_FULL',
  EFBIG: 'NT_STATUS_DISK_FULL',
};

function fsFailure(e: unknown): SmbReply {
  if (e instanceof FsError) return fail(FS_STATUS[e.code] ?? 'NT_STATUS_UNSUCCESSFUL');
  throw e;
}

function readConf(fs: Vfs): SmbConf {
  return parseSmbConf(fs.tryLookup(SMB_CONF)?.kind === 'file' ? fs.readFile(SMB_CONF) : DEFAULT_SMB_CONF);
}

/** Session setup: the Samba account and its NT hash (a disabled account cannot log in). */
function login(fs: Vfs, conf: SmbConf, r: SmbRequest): Session | SmbStatus {
  if (!r.user) return GUEST;
  const name = r.user.toLowerCase();
  const account = readPassdb(fs).find((a) => a.name === name);
  if (!account) return conf.mapToGuest ? GUEST : 'NT_STATUS_LOGON_FAILURE';
  if (account.hash !== r.hash) return 'NT_STATUS_LOGON_FAILURE';
  if (account.disabled) return 'NT_STATUS_ACCOUNT_DISABLED';
  const unix = unixAccount(fs, name);
  if (!unix) return 'NT_STATUS_LOGON_FAILURE';
  return { name, cred: { uid: unix.uid, gid: unix.gid, groups: unix.groups }, guest: false };
}

/** «valid users»: names, and groups as @group or +group. */
function listed(fs: Vfs, share: SmbShare, u: Session): boolean {
  if (!share.validUsers) return true;
  const groups = groupNames(fs, u.cred.groups ?? [u.cred.gid]);
  return share.validUsers.some((v) => (/^[@+]/.test(v) ? groups.includes(v.slice(1)) : !u.guest && v.toLowerCase() === u.name));
}

/** Tree connect: the share's real directory, or why this session may not use it. smbd only has to chdir into it (x);
 * a directory that may not be read still connects, and its listing is what is denied. */
function connect(fs: Vfs, share: SmbShare, u: Session): string | SmbStatus {
  if ((u.guest && !share.guestOk) || !listed(fs, share, u)) return 'NT_STATUS_ACCESS_DENIED';
  if (!share.path.startsWith('/')) return 'NT_STATUS_BAD_NETWORK_NAME';
  try {
    const root = fs.realpath(share.path);
    if (fs.tryLookup(root)?.kind !== 'dir') return 'NT_STATUS_BAD_NETWORK_NAME';
    return canAccess(fs.lookup(root, u.cred), u.cred, 1) ? root : 'NT_STATUS_ACCESS_DENIED';
  } catch (e) {
    return e instanceof FsError ? 'NT_STATUS_ACCESS_DENIED' : 'NT_STATUS_UNSUCCESSFUL';
  }
}

const inside = (p: string, root: string): boolean => root === '/' || p === root || p.startsWith(`${root}/`);

/**
 * A path of the share (\dir\file) on the server: never above the share root, by «..» or by a link. With `follow`
 * false (delete, rename) only the directories on the way are checked: the last name is the entry itself, so a link
 * that leads out of the share can still be deleted or renamed, which touches the link and not its target.
 */
function resolve(fs: Vfs, root: string, path: string, follow = true): string | SmbStatus {
  const parts = path.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (parts.includes('..')) return 'NT_STATUS_OBJECT_PATH_SYNTAX_BAD';
  const full = parts.length ? `${root === '/' ? '' : root}/${parts.join('/')}` : root;
  const checked = follow || !parts.length ? full : full.slice(0, full.lastIndexOf('/')) || '/';
  try {
    return inside(fs.realpath(checked), root) ? full : 'NT_STATUS_ACCESS_DENIED';
  } catch {
    return 'NT_STATUS_OBJECT_NAME_NOT_FOUND';
  }
}

/** A rename's target: a link there is replaced, not followed, unless it leads to a directory, which rename moves the
 * file into, so that directory must be inside the share as well. */
function renameTarget(fs: Vfs, root: string, path: string): string | SmbStatus {
  const to = resolve(fs, root, path, false);
  return isStatus(to) || fs.tryLookup(to)?.kind !== 'dir' ? to : resolve(fs, root, path);
}

function entry(fs: Vfs, path: string, name: string, cred: Cred): SmbEntry {
  const st = fs.stat(path, cred);
  return { name, dir: st.kind === 'dir', size: st.kind === 'file' ? st.size : 0, mtime: st.mtime };
}

function list(fs: Vfs, path: string, cred: Cred): SmbReply {
  const names = fs.readdir(path, cred);
  const self = entry(fs, path, '.', cred);
  const entries = names.map((n) => entry(fs, `${path}/${n}`, n, cred));
  return { status: 'NT_STATUS_OK', entries: [self, { ...self, name: '..' }, ...entries] };
}

const WRITES: ReadonlySet<SmbOp['op']> = new Set(['write', 'mkdir', 'rmdir', 'remove', 'rename']);
/** The operations on the entry itself, not on what a link points to. */
const ON_ENTRY: ReadonlySet<SmbOp['op']> = new Set(['remove', 'rename']);

/** One operation on a path already checked to be inside the share. */
function operate(fs: Vfs, op: SmbOp, path: string, to: string, cred: Cred): SmbReply {
  const ok: SmbReply = { status: 'NT_STATUS_OK' };
  switch (op.op) {
    case 'list': return list(fs, path, cred);
    case 'stat': return { ...ok, entry: entry(fs, path, path.slice(path.lastIndexOf('/') + 1), cred) };
    case 'read':
      if (fs.stat(path, cred).kind === 'dir') return fail('NT_STATUS_FILE_IS_A_DIRECTORY');
      return { ...ok, data: fs.readFile(path, cred) };
    case 'write': fs.writeFile(path, op.data, cred, false, FILE_MODE); return ok;
    case 'mkdir': fs.mkdir(path, cred, false, DIR_MODE); return ok;
    case 'rmdir':
      if (fs.stat(path, cred).kind !== 'dir') return fail('NT_STATUS_NOT_A_DIRECTORY');
      fs.remove(path, cred, false, true);
      return ok;
    case 'remove': fs.remove(path, cred); return ok;
    case 'rename': fs.rename(path, to, cred); return ok;
    default: return ok;
  }
}

function onShare(fs: Vfs, tree: SmbTree, op: SmbOp): SmbReply {
  const { root, cred } = tree;
  if (op.op === 'tree') return { status: 'NT_STATUS_OK' };
  if (WRITES.has(op.op) && tree.readOnly) return fail('NT_STATUS_ACCESS_DENIED');
  const path = resolve(fs, root, 'path' in op ? op.path : '', !ON_ENTRY.has(op.op));
  if (isStatus(path)) return fail(path);
  const to = op.op === 'rename' ? renameTarget(fs, root, op.to) : '';
  if (isStatus(to)) return fail(to);
  if (WRITES.has(op.op) && op.op !== 'write' && op.op !== 'mkdir' && path === root) return fail('NT_STATUS_ACCESS_DENIED');
  try {
    return operate(fs, op, path, to, cred);
  } catch (e) {
    return fsFailure(e);
  }
}

/** NetShareEnum: the browseable disks, then IPC$. */
function shareList(conf: SmbConf, host: Host): SmbReply {
  const comment = serverComment(conf, host.runtimeName());
  const disks: SmbShareInfo[] = conf.shares.filter((s) => s.browseable && !s.printable)
    .map((s) => ({ name: s.name, type: 'Disk', comment: s.comment }));
  return { status: 'NT_STATUS_OK', comment, shares: [...disks, { name: 'IPC$', type: 'IPC', comment: `IPC Service (${comment})` }] };
}

function answer(host: Host, r: SmbRequest): SmbReply {
  const fs = hostFs(host);
  if (!fs) return fail('NT_STATUS_UNSUCCESSFUL');
  if (host.os === 'windows') {
    if (r.req.op === 'shares') return windowsShareList(host);
    const tree = windowsTree(host, fs, r.share);
    return typeof tree === 'string' ? fail(tree) : onShare(fs, tree, r.req);
  }
  const conf = readConf(fs);
  const session = login(fs, conf, r);
  if (typeof session === 'string') return fail(session);
  if (r.req.op === 'shares') return shareList(conf, host);
  const share = findShare(conf, r.share);
  if (!share) return fail('NT_STATUS_BAD_NETWORK_NAME');
  const root = connect(fs, share, session);
  if (isStatus(root)) return fail(root);
  return onShare(fs, { root, readOnly: share.readOnly, cred: session.cred }, r.req);
}

/** The SMB handler of netbios.ts (TCP 139/445 while smbd runs, or on Windows sharing files). */
export function smbServe(host: Host, payload: AppPayload): AppPayload | null {
  if (payload.app !== 'SMB' || payload.kind !== 'smb-request') return null;
  return { app: 'SMB', kind: 'smb-reply', smb: answer(host, payload.smb) };
}
