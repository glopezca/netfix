/**
 * What the Samba panel of Servicios does, as root would do it in the terminal: start or stop smbd and nmbd
 * (systemctl enable --now / disable --now), add a share to /etc/samba/smb.conf (and its folder, as mkdir -p) or take
 * one out, and manage the Samba accounts of Linux users (smbpasswd -a / -d / -e / -x). smbd reads smb.conf on every
 * connection, so a change is in force at once.
 */
import { t } from '../i18n/t.ts';
import type { Host } from '../devices/host.ts';
import { FsError } from '../bash/vfs.ts';
import type { Vfs } from '../bash/vfs.ts';
import { hostSystem } from './host-system.ts';
import { startPkgUnit, stopPkgUnit } from './pkg-service.ts';
import { PKG_UNITS, pkgUnitState, setPkgUnitState } from '../net/pkg-units.ts';
import { DEFAULT_SMB_CONF, SMB_CONF, addShare, findShare, parseSmbConf, removeShare, validShareName } from '../services/smb-conf.ts';
import type { NewShare, SmbShare } from '../services/smb-conf.ts';
import { readPassdb, removeSmbAccount, setSmbDisabled, setSmbPassword, unixAccount, writePassdb } from '../services/smb-passdb.ts';
import type { SmbAccount } from '../services/smb-passdb.ts';

export type SambaError = 'smb.err.name' | 'smb.err.exists' | 'smb.err.path' | 'smb.err.user' | 'smb.err.password';

export interface SambaView {
  /** smbd is running (nmbd follows it in the panel). */
  readonly running: boolean;
  /** The file shares (not the printers). */
  readonly shares: readonly SmbShare[];
  readonly accounts: readonly SmbAccount[];
  /** Linux users that may get a Samba account (the people's accounts, uid 1000 to 59999). */
  readonly users: readonly string[];
}

const FIRST_UID = 1000;
const LAST_UID = 59999;
const MAX_PATH = 255;
const SAMBA_UNITS = PKG_UNITS.filter((u) => u.pkg === 'samba');

const fsOf = (host: Host): Vfs => hostSystem(host).fs;
const confText = (fs: Vfs): string => (fs.tryLookup(SMB_CONF)?.kind === 'file' ? fs.readFile(SMB_CONF) : DEFAULT_SMB_CONF);
/** Who may use a share and how, as the panel and the web GUI list it. */
export function shareAccess(s: SmbShare): string {
  const who = s.guestOk ? t('smb.guests') : s.validUsers?.length ? t('smb.validUsers', { users: s.validUsers.join(' ') }) : t('smb.accountsOnly');
  return `${s.readOnly ? t('smb.readOnly') : t('smb.readWrite')} · ${who}`;
}

/** A value on one line of smb.conf (a newline would start another parameter or section). */
const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim();

function linuxUsers(fs: Vfs): string[] {
  const text = fs.tryLookup('/etc/passwd')?.kind === 'file' ? fs.readFile('/etc/passwd') : '';
  return text.split('\n').map((l) => l.split(':')).filter((f) => {
    const uid = Number(f[2]);
    return f[0] && /^\d+$/.test(f[2] ?? '') && uid >= FIRST_UID && uid <= LAST_UID;
  }).map((f) => f[0] ?? '');
}

export function sambaView(host: Host): SambaView {
  const fs = fsOf(host);
  const smbd = SAMBA_UNITS.find((u) => u.name === 'smbd');
  return {
    running: smbd !== undefined && pkgUnitState(host, smbd).active,
    shares: parseSmbConf(confText(fs)).shares.filter((s) => !s.printable),
    accounts: readPassdb(fs),
    users: linuxUsers(fs),
  };
}

/** systemctl enable --now / disable --now smbd nmbd. */
export function setSambaRunning(host: Host, on: boolean): void {
  for (const u of SAMBA_UNITS) {
    setPkgUnitState(host, u, { enabled: on });
    if (on) startPkgUnit(host, u);
    else stopPkgUnit(host, u);
  }
  host.notifyChange();
}

/** Adds the share at the end of smb.conf, creating its folder when it is not there; the reason when it cannot. */
export function addSambaShare(host: Host, share: NewShare): SambaError | null {
  const fs = fsOf(host);
  const name = share.name.trim();
  const path = oneLine(share.path);
  if (!validShareName(name)) return 'smb.err.name';
  const text = confText(fs);
  if (findShare(parseSmbConf(text), name)) return 'smb.err.exists';
  if (!path.startsWith('/') || path.length > MAX_PATH || fs.tryLookup(path)?.kind === 'file') return 'smb.err.path';
  if (!fs.tryLookup(path) && !makeFolder(fs, path)) return 'smb.err.path';
  fs.writeFile(SMB_CONF, addShare(text, { ...share, name, path, comment: oneLine(share.comment) }));
  host.notifyChange();
  return null;
}

/** mkdir -p of a share's folder; false when the path cannot be one (a file on the way, say). */
function makeFolder(fs: Vfs, path: string): boolean {
  try {
    fs.mkdir(path, undefined, true);
    return true;
  } catch (err) {
    if (err instanceof FsError) return false;
    throw err;
  }
}

/** Removes a share of smb.conf ([global] and the other sections that are not shares stay). */
export function removeSambaShare(host: Host, name: string): void {
  const fs = fsOf(host);
  const text = confText(fs);
  if (!findShare(parseSmbConf(text), name)) return;
  fs.writeFile(SMB_CONF, removeShare(text, name));
  host.notifyChange();
}

/** smbpasswd -a: the Samba account of a Linux user, with that password (a new one or a change). */
export function setSambaPassword(host: Host, user: string, password: string): SambaError | null {
  const fs = fsOf(host);
  const account = linuxUsers(fs).includes(user) ? unixAccount(fs, user) : undefined;
  if (!account) return 'smb.err.user';
  if (!password) return 'smb.err.password';
  writePassdb(fs, setSmbPassword(readPassdb(fs), user, account.uid, password));
  host.notifyChange();
  return null;
}

/** smbpasswd -d / -e. */
export function setSambaAccountDisabled(host: Host, user: string, disabled: boolean): void {
  const fs = fsOf(host);
  writePassdb(fs, setSmbDisabled(readPassdb(fs), user, disabled));
  host.notifyChange();
}

/** smbpasswd -x. */
export function removeSambaAccount(host: Host, user: string): void {
  const fs = fsOf(host);
  writePassdb(fs, removeSmbAccount(readPassdb(fs), user));
  host.notifyChange();
}
