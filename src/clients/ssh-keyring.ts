/**
 * The user's ~/.ssh for the graphical SSH and file transfer apps: key pairs (generate, list, delete),
 * known_hosts entries (list, forget) and saved sessions (~/.config/netfix/ssh-sessions). Everything is
 * done with the user's credentials on the PC's file system, so it shows up in the terminal too.
 */
import type { Cred, Vfs } from '../bash/vfs.ts';
import type { UserInfo } from '../bash/types.ts';
import { fingerprint, generateKey, isEncrypted, parsePublicLine, privateFile, publicLine } from '../net/ssh-keys.ts';
import type { KeyType } from '../net/ssh-keys.ts';

export interface KeyInfo {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly fingerprint: string;
  readonly publicLine: string;
  readonly encrypted: boolean;
}

export interface KnownHost {
  readonly line: number;
  readonly host: string;
  readonly type: string;
  readonly fingerprint: string;
}

export interface SshProfile {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  /** Private key file name in ~/.ssh ('' = default keys, then password). */
  readonly identity: string;
}

const SSH_DIR_MODE = 0o700;
const PRIVATE_MODE = 0o600;
const PUBLIC_MODE = 0o644;
const MAX_PROFILES = 50;
const NAME = /^[A-Za-z0-9_.-]{1,40}$/;
const BITS: Readonly<Record<KeyType, number>> = { ed25519: 256, ecdsa: 256, rsa: 3072 };

export class SshKeyring {
  private readonly fs: Vfs;
  private readonly acct: UserInfo;
  private readonly cred: Cred;
  private readonly hostname: string;

  constructor(fs: Vfs, acct: UserInfo, hostname: string) {
    this.fs = fs;
    this.acct = acct;
    this.cred = { uid: acct.uid, gid: acct.gid, groups: acct.groups };
    this.hostname = hostname;
  }

  get dir(): string {
    return `${this.acct.home === '/' ? '' : this.acct.home}/.ssh`;
  }

  private read(path: string): string | null {
    try {
      return this.fs.tryLookup(path, this.cred)?.kind === 'file' ? this.fs.readFile(path, this.cred) : null;
    } catch {
      return null;
    }
  }

  private ensureDir(path: string, mode: number): void {
    if (!this.fs.tryLookup(path, this.cred)) this.fs.mkdir(path, this.cred, true, mode);
  }

  keys(): KeyInfo[] {
    if (this.fs.tryLookup(this.dir, this.cred)?.kind !== 'dir') return [];
    let names: string[] = [];
    try { names = this.fs.readdir(this.dir, this.cred); } catch { return []; }
    return names.filter((n) => n.endsWith('.pub')).flatMap((pub) => {
      const line = this.read(`${this.dir}/${pub}`)?.trim() ?? '';
      const key = parsePublicLine(line);
      const name = pub.slice(0, -4);
      const priv = this.read(`${this.dir}/${name}`);
      return key && priv !== null ? [{ name, path: `${this.dir}/${name}`, type: line.split(/\s+/)[0] ?? '', fingerprint: fingerprint(key.blob), publicLine: line, encrypted: isEncrypted(priv) }] : [];
    });
  }

  /** New key pair ~/.ssh/NAME (600) + NAME.pub (644); returns an error or null. */
  generate(type: KeyType, name: string, passphrase: string): string | null {
    if (!NAME.test(name)) return 'name';
    const path = `${this.dir}/${name}`;
    if (this.fs.tryLookup(path, this.cred)) return 'exists';
    try {
      this.ensureDir(this.dir, SSH_DIR_MODE);
      const kp = generateKey(type, BITS[type], `${this.acct.name}@${this.hostname}`);
      this.fs.writeFile(path, privateFile(kp, passphrase), this.cred, false, PRIVATE_MODE);
      this.fs.chmod(path, PRIVATE_MODE, this.cred);
      this.fs.writeFile(`${path}.pub`, `${publicLine(kp)}\n`, this.cred, false, PUBLIC_MODE);
      return null;
    } catch {
      return 'write';
    }
  }

  deleteKey(name: string): void {
    if (!NAME.test(name)) return;
    for (const p of [`${this.dir}/${name}`, `${this.dir}/${name}.pub`]) {
      try { if (this.fs.tryLookup(p, this.cred)) this.fs.remove(p, this.cred); } catch { /* not ours */ }
    }
  }

  knownHosts(): KnownHost[] {
    const text = this.read(`${this.dir}/known_hosts`) ?? '';
    return text.split('\n').flatMap((l, i) => {
      const [host = '', ...rest] = l.trim().split(/\s+/);
      const key = parsePublicLine(rest.join(' '));
      return l.trim() && !l.trim().startsWith('#') && key ? [{ line: i + 1, host, type: rest[0] ?? '', fingerprint: fingerprint(key.blob) }] : [];
    });
  }

  /** Forgets one known_hosts line (like `ssh-keygen -R`, but for that entry only). */
  forgetHost(line: number): void {
    const path = `${this.dir}/known_hosts`;
    const text = this.read(path);
    if (text === null) return;
    this.fs.writeFile(path, text.split('\n').filter((_, i) => i + 1 !== line).join('\n'), this.cred);
  }

  // ------------------------------------------------------------ saved sessions

  private get profilesPath(): string {
    return `${this.acct.home === '/' ? '' : this.acct.home}/.config/netfix/ssh-sessions`;
  }

  profiles(): SshProfile[] {
    const text = this.read(this.profilesPath) ?? '';
    return text.split('\n').flatMap((l) => {
      const [name = '', host = '', port = '22', user = '', identity = ''] = l.split('\t');
      return NAME.test(name) && host ? [{ name, host, port: Number(port) || 22, user, identity }] : [];
    });
  }

  saveProfile(p: SshProfile): string | null {
    const clean = (v: string): string => v.replace(/[\t\n\r]/g, '').trim().slice(0, 100);
    if (!NAME.test(p.name) || !clean(p.host) || !(p.port >= 1 && p.port <= 65535)) return 'profile';
    const rest = this.profiles().filter((x) => x.name !== p.name).slice(0, MAX_PROFILES - 1);
    const lines = [...rest, p].map((x) => [x.name, clean(x.host), x.port, clean(x.user), clean(x.identity)].join('\t'));
    try {
      this.ensureDir(this.profilesPath.replace(/\/[^/]+$/, ''), SSH_DIR_MODE);
      this.fs.writeFile(this.profilesPath, `${lines.join('\n')}\n`, this.cred, false, PRIVATE_MODE);
      return null;
    } catch {
      return 'write';
    }
  }

  deleteProfile(name: string): void {
    const lines = this.profiles().filter((x) => x.name !== name).map((x) => [x.name, x.host, x.port, x.user, x.identity].join('\t'));
    try { this.fs.writeFile(this.profilesPath, lines.length ? `${lines.join('\n')}\n` : '', this.cred); } catch { /* not writable */ }
  }
}
