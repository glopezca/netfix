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
import { findWinShare, winShares } from '../net/win-shares.ts';
import { defaultLinuxUser, hostUsers } from '../shells/host-system.ts';
import { resolveWinPath } from '../shells/win-path.ts';

/** A share connected: its real directory, whether it may only be read, and who works in it. */
export interface SmbTree {
  readonly root: string;
  readonly readOnly: boolean;
  readonly cred: Cred;
}

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

/** Tree connect: the share (its name in any case) and its folder, which must still be there and be entered. */
export function windowsTree(host: Host, fs: Vfs, name: string): SmbTree | SmbStatus {
  const share = findWinShare(host, name);
  if (!share) return 'NT_STATUS_BAD_NETWORK_NAME';
  const cred = localCred(host);
  const path = resolveWinPath(fs, '/', share.path, cred);
  if (!path.ok) return 'NT_STATUS_BAD_NETWORK_NAME';
  try {
    const root = fs.realpath(path.path);
    if (fs.tryLookup(root)?.kind !== 'dir') return 'NT_STATUS_BAD_NETWORK_NAME';
    if (!canAccess(fs.lookup(root, cred), cred, 1)) return 'NT_STATUS_ACCESS_DENIED';
    return { root, readOnly: share.access === 'read', cred };
  } catch (e) {
    return e instanceof FsError ? 'NT_STATUS_BAD_NETWORK_NAME' : 'NT_STATUS_UNSUCCESSFUL';
  }
}
