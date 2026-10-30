/**
 * What a package's maintainer scripts change besides the package itself: libnss-mdns (avahi-daemon brings it) puts
 * mdns4_minimal [NOTFOUND=return] into the «hosts:» line of /etc/nsswitch.conf on install and takes it out when the
 * last package that brings it goes. Packages a dependency brings are remembered as installed too (samba-common-bin).
 */
import type { Vfs } from '../bash/vfs.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage, setPackageInstalled } from '../net/host-packages.ts';
import { DEFAULT_NSSWITCH, NSSWITCH, withMdns } from './nsswitch.ts';

/** Dependencies that bring a feature of their own (nmblookup, the mDNS resolver). */
const TRACKED_DEPS: Readonly<Record<string, readonly string[]>> = {
  'avahi-daemon': ['libnss-mdns'], samba: ['samba-common-bin'], winbind: ['samba-common-bin'],
};

function editNsswitch(fs: Vfs, on: boolean): void {
  let text = DEFAULT_NSSWITCH;
  try { text = fs.readFile(NSSWITCH); } catch { /* a missing file is written again from Ubuntu's default */ }
  fs.writeFile(NSSWITCH, withMdns(text, on));
}

export function afterPackage(fs: Vfs, host: Host, name: string, on: boolean): void {
  if (on) for (const d of TRACKED_DEPS[name] ?? []) setPackageInstalled(host, d, true);
  if (name === 'avahi-daemon' || name === 'libnss-mdns') {
    editNsswitch(fs, hasPackage(host, 'libnss-mdns'));
  }
}
