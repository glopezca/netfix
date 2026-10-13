/**
 * sshd's access checks: AllowUsers/DenyUsers/AllowGroups/DenyGroups, PermitRootLogin, and public key
 * authentication (AuthorizedKeysFile, StrictModes, authorized_keys options and the signature).
 */
import type { Vfs } from '../bash/vfs.ts';
import type { SshdSettings } from './sshd-config.ts';
import { sameBlob, verifySignature, fingerprint, LABEL, parsePublicLine } from '../net/ssh-keys.ts';
import type { PublicKey } from '../net/ssh-keys.ts';
import { matchPattern } from '../bash/glob.ts';
import { formatIp } from '../core/ip.ts';
import { parseAuthorizedLine } from './authorized-keys.ts';

const GROUP_OTHER_WRITE = 0o022;
const MAX_KEYS_FILE = 256 * 1024;

export interface UserHome {
  readonly name: string;
  readonly uid: number;
  readonly home: string;
  /** Names of the user's groups (primary and supplementary). */
  readonly groupNames?: readonly string[];
}

function matches(pattern: string, user: string, ip: number): boolean {
  const at = pattern.indexOf('@');
  const userPart = at >= 0 ? pattern.slice(0, at) : pattern;
  return matchPattern(userPart, user) && (at < 0 || matchPattern(pattern.slice(at + 1), formatIp(ip)));
}

/** sshd's "User x from y not allowed because …" reason, or null when the user may log in. */
export function accessDenied(s: SshdSettings, u: UserHome, ip: number): string | null {
  const from = `User ${u.name} from ${formatIp(ip)} not allowed because`;
  const groups = u.groupNames ?? [];
  if (s.denyUsers.some((p) => matches(p, u.name, ip))) return `${from} listed in DenyUsers`;
  if (s.allowUsers.length > 0 && !s.allowUsers.some((p) => matches(p, u.name, ip))) return `${from} not listed in AllowUsers`;
  if (s.denyGroups.some((p) => groups.some((g) => matchPattern(p, g)))) return `${from} a group is listed in DenyGroups`;
  if (s.allowGroups.length > 0 && !s.allowGroups.some((p) => groups.some((g) => matchPattern(p, g)))) return `${from} none of user's groups are listed in AllowGroups`;
  return null;
}

/** PermitRootLogin for a method: root may log in with keys by default, never with a password. */
export function rootRefused(s: SshdSettings, user: string, method: 'password' | 'publickey'): boolean {
  if (user !== 'root') return false;
  return s.permitRootLogin === 'no' || s.permitRootLogin === 'forced-commands-only' || (s.permitRootLogin === 'prohibit-password' && method === 'password');
}

/** Group names of `gids` from /etc/group. */
export function groupNames(fs: Vfs, gids: readonly number[]): string[] {
  const text = fs.tryLookup('/etc/group')?.kind === 'file' ? fs.readFile('/etc/group') : '';
  const byGid = new Map(text.split('\n').map((l) => l.split(':')).filter((f) => f.length >= 3).map((f) => [Number(f[2]), f[0] ?? ''] as const));
  return gids.map((g) => byGid.get(g) ?? '').filter(Boolean);
}

function keyFiles(s: SshdSettings, u: UserHome): string[] {
  return s.authorizedKeysFiles.map((f) => {
    const p = f.replace(/%h/g, u.home).replace(/%u/g, u.name).replace(/%%/g, '%');
    return p.startsWith('/') ? p : `${u.home}/${p}`;
  });
}

const inside = (p: string, dir: string): boolean => dir === '/' || p === dir || p.startsWith(`${dir}/`);

/**
 * StrictModes: the file and every directory up to the home (or up to / for a file outside the home)
 * must belong to the user (or root) and not be writable by group or others.
 */
function badModes(fs: Vfs, u: UserHome, path: string): string | null {
  const stop = inside(path, u.home) ? u.home : '/';
  const dirs: string[] = [];
  for (let p = path; ; p = p.slice(0, p.lastIndexOf('/')) || '/') {
    dirs.push(p);
    if (p === stop || p === '/') break;
  }
  for (const p of dirs) {
    const st = fs.tryLookup(p) ? fs.stat(p) : null;
    if (!st) continue;
    if ((st.uid !== u.uid && st.uid !== 0) || (st.mode & GROUP_OTHER_WRITE) !== 0) {
      return `Authentication refused: bad ownership or modes for ${st.kind === 'dir' ? 'directory' : 'file'} ${p}`;
    }
  }
  return null;
}

export type PubkeyResult = { ok: true; log: string } | { ok: false; log: string | null };

/** The key's line in one authorized_keys file: found and usable from `ip`, found but refused, or absent. */
function lookupKey(text: string, key: PublicKey, ip: number, path: string): 'ok' | 'absent' | string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const entry = parseAuthorizedLine(lines[i] ?? '');
    if (!entry || entry.key.type !== key.type || !sameBlob(entry.key.blob, key.blob)) continue;
    if (entry.error) return `${path}:${i + 1}: bad key options: ${entry.error}`;
    if (!entry.allowsFrom(formatIp(ip))) return `Authentication tried for ${'%u'} with correct key but not from a permitted host (host=${formatIp(ip)}, ip=${formatIp(ip)}).`;
    return 'ok';
  }
  return 'absent';
}

/** Public key authentication: `signature` must be valid over `message` and the key listed for `u`. */
export function checkPublicKey(fs: Vfs, s: SshdSettings, u: UserHome, ip: number, keyLine: string, signature: string, message: Uint8Array): PubkeyResult {
  const key: PublicKey | null = parsePublicLine(keyLine);
  if (!key) return { ok: false, log: 'userauth_pubkey: cannot decode key' };
  const fp = `${LABEL[key.type]} ${fingerprint(key.blob)}`;
  for (const path of keyFiles(s, u)) {
    if (fs.tryLookup(path)?.kind !== 'file') continue;
    const bad = s.strictModes ? badModes(fs, u, path) : null;
    if (bad) return { ok: false, log: bad };
    const found = lookupKey(fs.readFile(path).slice(0, MAX_KEYS_FILE), key, ip, path);
    if (found === 'absent') continue;
    if (found !== 'ok') return { ok: false, log: found.replace('%u', u.name) };
    if (!verifySignature(key.blob, message, signature)) return { ok: false, log: `Failed publickey for ${u.name}: bad signature ${fp}` };
    return { ok: true, log: `publickey for ${u.name}: ${fp} (${path})` };
  }
  return { ok: false, log: null };
}
