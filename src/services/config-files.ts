/**
 * Configuration files of each service, for the «Ficheros» view (Services tab and web GUI): the paths a teacher would
 * open with cat, read as root from the device's file system as they are right now. Directories are listed one level
 * deep (sites-enabled, sysctl.d…), so a file written by hand shows up too.
 */
import type { Vfs } from '../bash/vfs.ts';

export interface ConfigSource {
  readonly id: string;
  /** i18n key of its name in the Services tab. */
  readonly label: string;
  /** Files or directories, in the order shown. */
  readonly paths: readonly string[];
}

export interface ConfigFile {
  readonly path: string;
  readonly content: string;
}

const ROUTER: readonly ConfigSource[] = [
  { id: 'sysctl', label: 'sysctl.tab', paths: ['/etc/sysctl.conf', '/etc/sysctl.d'] },
  { id: 'firewall', label: 'fw.tab', paths: ['/etc/nftables.conf'] },
  { id: 'vpn', label: 'vpn.tab', paths: ['/etc/wireguard'] },
];

const SERVICES: readonly ConfigSource[] = [
  { id: 'ssh', label: 'files.ssh', paths: ['/etc/ssh/sshd_config', '/etc/ssh/sshd_config.d'] },
  { id: 'dhcp', label: 'files.dhcp', paths: ['/etc/kea/kea-dhcp4.conf'] },
  { id: 'dns', label: 'files.dns', paths: ['/etc/bind/named.conf', '/etc/bind/named.conf.options', '/etc/bind/named.conf.local', '/etc/bind'] },
  { id: 'http', label: 'files.http', paths: ['/etc/apache2/apache2.conf', '/etc/apache2/ports.conf', '/etc/apache2/sites-enabled', '/etc/apache2/conf-enabled'] },
  { id: 'mail', label: 'files.mail', paths: ['/etc/postfix/main.cf', '/etc/dovecot/dovecot.conf'] },
];

/** The services of a device in the order of its Services tab (the router's own panels first, then SSH…). */
export function configSources(device: { readonly kind: string }): readonly ConfigSource[] {
  return device.kind === 'linuxrouter' ? [...ROUTER, ...SERVICES] : SERVICES;
}

/** Most files a directory can contribute (a student filling /etc/bind must not freeze the view). */
const MAX_PER_DIR = 40;

/** The service's own tree (/etc/bind, /etc/apache2…): a link inside it may point anywhere in it, not elsewhere. */
const treeOf = (path: string): string => path.split('/').slice(0, 3).join('/');

function inTree(fs: Vfs, path: string, tree: string): boolean {
  try {
    const real = fs.realpath(path);
    return real === tree || real.startsWith(`${tree}/`);
  } catch {
    return false;
  }
}

function expand(fs: Vfs, path: string): string[] {
  const node = fs.tryLookup(path);
  if (!node) return [];
  if (node.kind !== 'dir') return [path];
  const tree = treeOf(path);
  return fs.readdir(path).sort().slice(0, MAX_PER_DIR).map((name) => `${path}/${name}`)
    .filter((p) => fs.tryLookup(p)?.kind === 'file' && inTree(fs, p, tree));
}

/** The files of a service with their current content; unknown ids and unreadable files are left out. */
export function configFiles(fs: Vfs, id: string): ConfigFile[] {
  const source = [...ROUTER, ...SERVICES].find((s) => s.id === id);
  if (!source) return [];
  // A directory listed after some of its files (named.conf first, then /etc/bind) adds only the rest.
  return [...new Set(source.paths.flatMap((p) => expand(fs, p)))].flatMap((path) => {
    try {
      return [{ path, content: fs.readFile(path) }];
    } catch {
      return [];
    }
  });
}
