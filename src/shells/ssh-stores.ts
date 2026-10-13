/** Where each terminal's ssh client keeps known_hosts and its keys. */
import type { Host } from '../devices/host.ts';
import type { Vfs } from '../bash/vfs.ts';
import type { UserInfo } from '../bash/types.ts';
import type { SshClientStore } from './ssh-client.ts';

const DEFAULT_IDENTITIES = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
const SSH_DIR_MODE = 0o700;
const KNOWN_HOSTS_MODE = 0o644;

/** ~/.ssh of a Linux account, with that account's permissions. */
export function linuxSshStore(fs: Vfs, acct: UserInfo, cwd = acct.home): SshClientStore {
  const cred = { uid: acct.uid, gid: acct.gid, groups: acct.groups };
  const dir = `${acct.home === '/' ? '' : acct.home}/.ssh`;
  const base = cwd === '/' ? '' : cwd;
  const resolve = (p: string): string => (p === '~' ? acct.home : p.startsWith('~/') ? `${acct.home}${p.slice(1)}` : p.startsWith('/') ? p : `${base}/${p}`);
  const isFile = (p: string): boolean => fs.tryLookup(p, cred)?.kind === 'file';
  return {
    knownHostsPath: `${dir}/known_hosts`,
    knownHosts: (path) => {
      try { return isFile(path) ? fs.readFile(path, cred) : ''; } catch { return ''; }
    },
    addKnownHost: (path, line) => {
      try {
        if (path === `${dir}/known_hosts` && !fs.tryLookup(dir, cred)) fs.mkdir(dir, cred, false, SSH_DIR_MODE);
        fs.writeFile(path, `${line}\n`, cred, true, KNOWN_HOSTS_MODE);
      } catch { /* not writable: OpenSSH also goes on without saving */ }
    },
    defaultIdentities: () => DEFAULT_IDENTITIES.map((n) => `${dir}/${n}`).filter(isFile),
    readIdentity: (path) => {
      if (!fs.tryLookup(path, cred)) return 'missing';
      try { return { text: fs.readFile(path, cred), mode: fs.stat(path, cred).mode }; } catch { return 'denied'; }
    },
    resolve,
  };
}

const windowsKnownHosts = new WeakMap<Host, Map<string, string>>();

/** Windows' OpenSSH client: known_hosts kept in memory per equipment, no key files. */
export function windowsSshStore(host: Host, user: string): SshClientStore {
  const files = windowsKnownHosts.get(host) ?? new Map<string, string>();
  windowsKnownHosts.set(host, files);
  const home = `C:\\Users\\${user}`;
  return {
    knownHostsPath: `${home}\\.ssh\\known_hosts`,
    knownHosts: (path) => files.get(path) ?? '',
    addKnownHost: (path, line) => { files.set(path, `${files.get(path) ?? ''}${line}\n`); },
    defaultIdentities: () => [],
    readIdentity: () => 'missing',
    resolve: (p) => (/^[A-Za-z]:\\/.test(p) || p === '/dev/null' ? p : `${home}\\${p.replace(/^~[\\/]/, '').replace(/\//g, '\\')}`),
  };
}
