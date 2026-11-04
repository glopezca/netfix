/**
 * Samba's own accounts (passdb backend tdbsam): a Linux user only logs in to a share after `smbpasswd -a` gives them
 * an SMB password. Netfix keeps the database as text lines `user:uid:nthash:flags` (flags: D = disabled) in the file
 * Samba uses, /var/lib/samba/private/passdb.tdb, which only root reads (0600 in a 0700 directory).
 */
import type { Vfs } from '../bash/vfs.ts';
import { secretHash } from '../core/hash.ts';

export const PASSDB = '/var/lib/samba/private/passdb.tdb';
const PRIVATE_DIR = '/var/lib/samba/private';
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const MAX_ACCOUNTS = 500;

export interface SmbAccount {
  readonly name: string;
  readonly uid: number;
  readonly hash: string;
  readonly disabled: boolean;
}

/** The NT hash a client proves (NTLM never sends the password itself). */
export const ntHash = (password: string): string => secretHash(`nt:${password}`);

function parseLine(line: string): SmbAccount | null {
  const [name, uid, hash, flags] = line.split(':');
  if (!name || !/^[a-z_][a-z0-9_-]{0,31}$/.test(name) || !/^\d+$/.test(uid ?? '') || !hash) return null;
  return { name, uid: Number(uid), hash, disabled: (flags ?? '').includes('D') };
}

/** The accounts (read as root: smbd and the tools run as root); none when the file does not exist yet. */
export function readPassdb(fs: Vfs): SmbAccount[] {
  const text = fs.tryLookup(PASSDB) ? fs.readFile(PASSDB) : '';
  return text.split('\n').map(parseLine).filter((a): a is SmbAccount => a !== null).slice(0, MAX_ACCOUNTS);
}

export function writePassdb(fs: Vfs, accounts: readonly SmbAccount[]): void {
  if (!fs.tryLookup(PRIVATE_DIR)) fs.mkdir(PRIVATE_DIR, undefined, true, DIR_MODE);
  const text = accounts.map((a) => `${a.name}:${a.uid}:${a.hash}:${a.disabled ? 'D' : ''}`).join('\n');
  fs.writeFile(PASSDB, text ? `${text}\n` : '', undefined, false, FILE_MODE);
  fs.chmod(PASSDB, FILE_MODE);
}

/** The database with the account added or its password changed (a changed one keeps its enabled state). */
export function setSmbPassword(accounts: readonly SmbAccount[], name: string, uid: number, password: string): SmbAccount[] {
  const old = accounts.find((a) => a.name === name);
  const next: SmbAccount = { name, uid, hash: ntHash(password), disabled: old?.disabled ?? false };
  return old ? accounts.map((a) => (a.name === name ? next : a)) : [...accounts, next];
}

export function setSmbDisabled(accounts: readonly SmbAccount[], name: string, disabled: boolean): SmbAccount[] {
  return accounts.map((a) => (a.name === name ? { ...a, disabled } : a));
}

export function removeSmbAccount(accounts: readonly SmbAccount[], name: string): SmbAccount[] {
  return accounts.filter((a) => a.name !== name);
}

/** The Linux account smbd works as for a Samba user: /etc/passwd and the groups /etc/group lists it in. */
export interface UnixAccount {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly groups: readonly number[];
}

const fileText = (fs: Vfs, path: string): string => (fs.tryLookup(path)?.kind === 'file' ? fs.readFile(path) : '');

export function unixAccount(fs: Vfs, name: string): UnixAccount | undefined {
  const row = fileText(fs, '/etc/passwd').split('\n').map((l) => l.split(':')).find((f) => f[0] === name && f.length >= 4);
  if (!row || !/^\d+$/.test(row[2] ?? '') || !/^\d+$/.test(row[3] ?? '')) return undefined;
  const gid = Number(row[3]);
  const extra = fileText(fs, '/etc/group').split('\n').map((l) => l.split(':'))
    .filter((f) => f.length >= 4 && (f[3] ?? '').split(',').includes(name) && /^\d+$/.test(f[2] ?? '')).map((f) => Number(f[2]));
  return { name, uid: Number(row[2]), gid, groups: [...new Set([gid, ...extra])] };
}
