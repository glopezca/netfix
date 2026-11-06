/**
 * The Server service of Windows behind smb-server.ts: which shares there are (win-shares.ts, the box of the device's
 * Configuración tab and its SMB panel) and where each one lives. Password-protected sharing is off, so every session
 * is Everyone: a share for reading or with full control, and the files are worked on with the permissions of the
 * device's own account (the one its Windows terminal uses), so what arrives over the network is that user's.
 */
import type { Host } from '../devices/host.ts';
import type { Cred, Vfs } from '../bash/vfs.ts';
import { FsError, canAccess } from '../bash/vfs.ts';
import type { SmbReply, SmbShareInfo, SmbStatus } from '../net/smb-types.ts';
import { addWinShare, findWinShare, removeWinShare, sharePath, winShares } from '../net/win-shares.ts';
import type { ShareError, WinShare } from '../net/win-shares.ts';
import { hostFs } from '../devices/host-fs.ts';
import { defaultLinuxUser, hostUsers } from '../shells/host-system.ts';
import { resolveWinPath } from '../shells/win-path.ts';

/** A share connected: its real directory, whether it may only be read, and who works in it. */
export interface SmbTree {
  readonly root: string;
  readonly readOnly: boolean;
  readonly cred: Cred;
}

/** Paths on the server are absolute, so a string that starts as a status is one. */
const isStatus = (v: string): v is SmbStatus => v.startsWith('NT_STATUS_');

/** The device's own account, as its Windows terminal (windows.ts). */
function localCred(host: Host): Cred {
  const users = hostUsers(host);
  const account = users.find((u) => u.name === defaultLinuxUser(host)) ?? users[0];
  return { uid: account?.uid ?? 0, gid: account?.gid ?? 0, groups: account?.groups ?? [] };
}

/** NetShareEnum: the shares by name, then IPC$; Windows gives no server comment. */
export function windowsShareList(host: Host): SmbReply {
  const disks: SmbShareInfo[] = [...winShares(host)]
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((s) => ({ name: s.name, type: 'Disk', comment: s.remark }));
  return { status: 'NT_STATUS_OK', comment: '', shares: [...disks, { name: 'IPC$', type: 'IPC', comment: 'Remote IPC' }] };
}

/** The real directory of a share's C:\folder, or why it cannot be entered: gone (or not a folder), or denied. */
function folderOf(fs: Vfs, path: string, cred: Cred): string | SmbStatus {
  const p = resolveWinPath(fs, '/', path, cred);
  if (!p.ok) return 'NT_STATUS_BAD_NETWORK_NAME';
  try {
    const root = fs.realpath(p.path);
    if (fs.tryLookup(root)?.kind !== 'dir') return 'NT_STATUS_BAD_NETWORK_NAME';
    return canAccess(fs.lookup(root, cred), cred, 1) ? root : 'NT_STATUS_ACCESS_DENIED';
  } catch (e) {
    return e instanceof FsError ? 'NT_STATUS_BAD_NETWORK_NAME' : 'NT_STATUS_UNSUCCESSFUL';
  }
}

/** Tree connect: the share (its name in any case) and its folder, which must still be there and be entered. */
export function windowsTree(host: Host, fs: Vfs, name: string): SmbTree | SmbStatus {
  const share = findWinShare(host, name);
  if (!share) return 'NT_STATUS_BAD_NETWORK_NAME';
  const cred = localCred(host);
  const root = folderOf(fs, share.path, cred);
  return isStatus(root) ? root : { root, readOnly: share.access === 'read', cred };
}

/** Why a share was not published: what win-shares.ts checks, or a folder that is not there (or is on another drive). */
export type PublishError = ShareError | 'folder';

/** The panel and `net share`: publishes a share of a folder that exists, and tells the device's open panels. */
export function publishWinShare(host: Host, share: WinShare): PublishError | undefined {
  const path = sharePath(share.path);
  if (path === undefined) return /^[a-bd-z]:\\/i.test(share.path) ? 'folder' : 'path';
  const fs = hostFs(host);
  if (!fs || folderOf(fs, path, localCred(host)) === 'NT_STATUS_BAD_NETWORK_NAME') return 'folder';
  const err = addWinShare(host, { ...share, path });
  if (!err) host.notifyChange();
  return err;
}

/** Stops sharing (the folder stays): whether there was such a share. */
export function unpublishWinShare(host: Host, name: string): boolean {
  const done = removeWinShare(host, name);
  if (done) host.notifyChange();
  return done;
}
