/**
 * What a package's maintainer scripts change besides the package itself: libnss-mdns (avahi-daemon brings it) puts
 * mdns4_minimal [NOTFOUND=return] into the «hosts:» line of /etc/nsswitch.conf on install and takes it out when the
 * last package that brings it goes. Packages a dependency brings are remembered as installed too (samba-common-bin).
 */
import type { Vfs } from '../bash/vfs.ts';
import { FsError } from '../bash/vfs.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage, setPackageInstalled } from '../net/host-packages.ts';
import { DEFAULT_NSSWITCH, NSSWITCH, withMdns } from './nsswitch.ts';
import { runsServices } from '../devices/kinds.ts';
import { shippedFiles } from './apt-defaults.ts';

/** Dependencies that bring a feature of their own (nmblookup, the mDNS resolver). */
const TRACKED_DEPS: Readonly<Record<string, readonly string[]>> = {
  'avahi-daemon': ['libnss-mdns'], samba: ['samba-common-bin'], winbind: ['samba-common-bin'],
  // named-checkconf and named-checkzone stay when bind9 goes (apt leaves bind9-utils until autoremove).
  bind9: ['bind9-utils'], bind9utils: ['bind9-utils'],
};

function editNsswitch(fs: Vfs, on: boolean): void {
  let text = DEFAULT_NSSWITCH;
  try { text = fs.readFile(NSSWITCH); } catch { /* a missing file is written again from Ubuntu's default */ }
  fs.writeFile(NSSWITCH, withMdns(text, on));
}

/** The package's configuration files on a PC, unless they are there already (dpkg keeps the conffiles you edited). */
function writeShipped(fs: Vfs, name: string): void {
  for (const [path, content] of shippedFiles(name)) {
    if (fs.exists(path)) continue;
    try {
      fs.mkdir(path.slice(0, path.lastIndexOf('/')), undefined, true, 0o755);
      fs.writeFile(path, content, undefined, false, 0o644);
    } catch (e) {
      // /etc/kea made a plain file by hand: the package is installed without that file (the tools still work).
      if (!(e instanceof FsError)) throw e;
    }
  }
}

export function afterPackage(fs: Vfs, host: Host, name: string, on: boolean): void {
  if (on) for (const d of TRACKED_DEPS[name] ?? []) setPackageInstalled(host, d, true);
  // A Server or GNU/Linux router writes them from its Servicios settings (linux-files.ts).
  if (on && !runsServices(host.kind)) writeShipped(fs, name);
  if (name === 'avahi-daemon' || name === 'libnss-mdns') {
    editNsswitch(fs, hasPackage(host, 'libnss-mdns'));
  }
}
