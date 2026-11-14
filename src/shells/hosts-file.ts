/**
 * The hosts files, as the two systems read them: /etc/hosts (GNU/Linux, the `files` source of nsswitch) and
 * C:\Windows\System32\drivers\etc\hosts (Windows, read before DNS). Both are on the device's disk (C:\ is /mnt/c), are
 * ordinary files only root / the Administrators (the sudo group) write, apply at once and are saved with the lab. A line is an address
 * and its names (the canonical one first); `#` starts a comment; names match without case and the first line wins.
 */
import type { Host } from '../devices/host.ts';
import { normalizeName } from '../net/dns.ts';
import { parseIp } from '../core/ip.ts';
import { peekHostFile } from '../devices/host-fs.ts';
import type { Vfs } from '../bash/vfs.ts';
import { WIN_ROOT } from './win-path.ts';

export const LINUX_HOSTS = '/etc/hosts';
/** C:\Windows\System32\drivers\etc\hosts on the device's disk. */
export const WINDOWS_HOSTS = `${WIN_ROOT}/Windows/System32/drivers/etc/hosts`;
/** Where it was before v0.47 (C:\ was the root /): a lab saved then still has it there. */
const LEGACY_WINDOWS_HOSTS = '/Windows/System32/drivers/etc/hosts';

/** Ubuntu's /etc/hosts as the installer leaves it, with the host name as it was given. */
export const ubuntuHosts = (name: string): string => `127.0.0.1 localhost
127.0.1.1 ${name}

# The following lines are desirable for IPv6 capable hosts
::1     ip6-localhost ip6-loopback
fe00::0 ip6-localnet
ff00::0 ip6-mcastprefix
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
`;

/** The hosts file Windows ships: comments only (localhost is answered by the DNS client itself). */
export const WINDOWS_HOSTS_TEXT = `# Copyright (c) 1993-2009 Microsoft Corp.
#
# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.
#
# This file contains the mappings of IP addresses to host names. Each
# entry should be kept on an individual line. The IP address should
# be placed in the first column followed by the corresponding host name.
# The IP address and the host name should be separated by at least one
# space.
#
# Additionally, comments (such as these) may be inserted on individual
# lines or following the machine name denoted by a '#' symbol.
#
# For example:
#
#      102.54.94.97     rhino.acme.com          # source server
#       38.25.63.10     x.acme.com              # x client host

# localhost name resolution is handled within DNS itself.
#\t127.0.0.1       localhost
#\t::1             localhost
`.replace(/\n/g, '\r\n');

/** The sudo group stands for Windows' Administrators: they write the file (Full control), everyone else reads it. */
const ADMINISTRATORS_GID = 27;

/** The Windows disk gets the file Windows ships, unless it is there (a saved or edited one stays). */
export function seedWindowsHosts(fs: Vfs): void {
  // Only on real folders (a file or a link on the way would not be Windows' folders): never over what is there.
  const dirs = ['/mnt', WIN_ROOT, `${WIN_ROOT}/Windows`, `${WIN_ROOT}/Windows/System32`, `${WIN_ROOT}/Windows/System32/drivers`, `${WIN_ROOT}/Windows/System32/drivers/etc`];
  if (dirs.some((d) => { const n = fs.tryLookup(d, undefined, false); return n !== undefined && n.kind !== 'dir'; })) return;
  if (fs.tryLookup(WINDOWS_HOSTS, undefined, false)) return;
  fs.seed(WINDOWS_HOSTS, { kind: 'file', content: WINDOWS_HOSTS_TEXT }, 0o664, 0, ADMINISTRATORS_GID);
  // A lab from before v0.47 had its edited file at /Windows/…: it moves to C:\ (and is saved there from now on).
  const old = fs.tryLookup(LEGACY_WINDOWS_HOSTS, undefined, false);
  if (old?.kind === 'file' && old.dirty) fs.writeFile(WINDOWS_HOSTS, old.content);
}

/** One line with an IPv4 address: the canonical name first, then the aliases. */
export interface HostsEntry {
  readonly ip: number;
  readonly names: readonly string[];
}

export type HostsOs = 'linux' | 'windows';

/** The file's text; a device whose system was never used has the default one (no need to build the system for it). */
function hostsText(host: Host, os: HostsOs): string {
  if (os === 'windows') return peekHostFile(host, WINDOWS_HOSTS) ?? peekHostFile(host, LEGACY_WINDOWS_HOSTS) ?? WINDOWS_HOSTS_TEXT;
  return peekHostFile(host, LINUX_HOSTS) ?? ubuntuHosts(host.name);
}

/** The IPv4 lines of the hosts file, in order (IPv6 lines are kept in the file but Netfix routes IPv4 only). */
export function hostsEntries(host: Host, os: HostsOs = 'linux'): HostsEntry[] {
  return hostsText(host, os).split(/\r?\n/).flatMap((line) => {
    const [addr, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    const ip = addr ? parseIp(addr) : null;
    return ip !== null && names.length > 0 ? [{ ip, names }] : [];
  });
}

/** Every address line as it is written, IPv6 too (getent hosts lists them all). */
export function hostsRows(host: Host, os: HostsOs = 'linux'): { readonly addr: string; readonly names: readonly string[] }[] {
  return hostsText(host, os).split(/\r?\n/).flatMap((line) => {
    const [addr, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    return addr && names.length > 0 && (parseIp(addr) !== null || /^[0-9a-f]*:[0-9a-f:.]*$/i.test(addr)) ? [{ addr, names }] : [];
  });
}

/** The first line that has the name, without case. */
export function hostsEntry(host: Host, name: string, os: HostsOs = 'linux'): HostsEntry | undefined {
  const wanted = normalizeName(name);
  return hostsEntries(host, os).find((e) => e.names.some((n) => normalizeName(n) === wanted));
}

/** The address the hosts file gives a name (first matching line, IPv4). */
export const hostsLookup = (host: Host, name: string, os: HostsOs = 'linux'): number | undefined => hostsEntry(host, name, os)?.ip;
