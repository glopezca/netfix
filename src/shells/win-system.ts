/**
 * The Windows disk of a device, apart from GNU/Linux: C:\ is /mnt/c of its file system, so on a device with both
 * systems GNU/Linux reaches it there (as in WSL). It holds Windows' hosts file, C:\Users\<user> (with .ssh when the
 * device runs the SSH service) and Git for Windows' usr\bin, in %PATH%, with the same nano and vim as GNU/Linux.
 */
import { runsServices } from '../devices/kinds.ts';
import type { HostKind } from '../devices/kinds.ts';
import type { Vfs } from '../bash/vfs.ts';
import type { UserInfo } from '../bash/types.ts';
import { BINARY_MARK } from '../bash/path.ts';
import { WIN_ROOT } from './win-path.ts';
import { seedWindowsHosts } from './hosts-file.ts';

export const GIT_BIN = `${WIN_ROOT}/Program Files/Git/usr/bin`;
/** %PATH% of the terminal: Windows' folders, then Git's usr\bin (nano.exe, vim.exe). */
export const WIN_PATH = 'C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\Git\\usr\\bin';
/** The programs of Git's usr\bin: the editors GNU/Linux has, on Windows paths. */
export const WIN_EDITORS: readonly ('nano' | 'vim')[] = ['nano', 'vim'];

/** The Windows account a terminal opens with: Administrator on a Server, user on a PC. */
export const defaultWindowsUser = (kind: HostKind): string => (runsServices(kind) ? 'Administrator' : 'user');

export const usersDir = (user: string): string => `${WIN_ROOT}/Users/${user}`;

/** The account a Windows user works as: the GNU/Linux one with its name (lower case), else the device's main one. */
export function windowsAccount(users: readonly UserInfo[], user: string, main: string): UserInfo | undefined {
  return users.find((u) => u.name === user.toLowerCase()) ?? users.find((u) => u.name === main) ?? users[0];
}

/** A folder, unless something is already there (a saved or edited disk keeps what it has). */
function folder(fs: Vfs, path: string, mode: number, owner?: UserInfo): void {
  if (!fs.tryLookup(path, undefined, false)) fs.seed(path, { kind: 'dir' }, mode, owner?.uid ?? 0, owner?.gid ?? 0);
}

/** Lays out C:\ (idempotent): what is there already is never replaced, and a non-folder at /mnt/c is left alone. */
export function seedWindowsDisk(fs: Vfs, user: string, owner: UserInfo | undefined, sshService: boolean): void {
  const root = fs.tryLookup(WIN_ROOT, undefined, false);
  if (root && root.kind !== 'dir') return;
  seedWindowsHosts(fs);
  folder(fs, `${WIN_ROOT}/Users`, 0o755);
  folder(fs, usersDir(user), 0o755, owner);
  if (sshService) folder(fs, `${usersDir(user)}/.ssh`, 0o700, owner);
  folder(fs, GIT_BIN, 0o755);
  for (const e of WIN_EDITORS) {
    const exe = `${GIT_BIN}/${e}.exe`;
    // The same program as GNU/Linux's (bash runs it from /mnt/c too).
    if (!fs.tryLookup(exe, undefined, false)) fs.seed(exe, { kind: 'file', content: `${BINARY_MARK}${e}\n` }, 0o755);
  }
}
