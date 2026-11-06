/**
 * What a package's maintainer scripts change besides the package itself: libnss-mdns (avahi-daemon brings it) puts
 * mdns4_minimal [NOTFOUND=return] into the «hosts:» line of /etc/nsswitch.conf on install and takes it out when the
 * last package that brings it goes, and libnss-resolve does the same with resolve [!UNAVAIL=return]; samba starts smbd and nmbd, and removing a package stops its units
 * (pkg-service.ts). The dependencies themselves are recorded by apt (apt-auto.ts).
 */
import type { Vfs } from '../bash/vfs.ts';
import { FsError } from '../bash/vfs.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { DEFAULT_NSSWITCH, NSSWITCH, withMdns, withResolve } from './nsswitch.ts';
import { runsServices } from '../devices/kinds.ts';
import { ANY_HOST_FILES, shippedFiles } from './apt-defaults.ts';
import { pkgInstalled, pkgRemoved } from './pkg-service.ts';
import { notifyAppsChange } from '../net/device-apps.ts';

/** Packages that add tabs to the Servicios of a GNU/Linux host (net/pkg-units.ts hostPanels). */
const WITH_PANELS: ReadonlySet<string> = new Set(['samba', 'nftables', 'avahi-daemon', 'winbind']);

function editNsswitch(fs: Vfs, edit: (text: string) => string): void {
  let text = DEFAULT_NSSWITCH;
  try { text = fs.readFile(NSSWITCH); } catch { /* a missing file is written again from Ubuntu's default */ }
  fs.writeFile(NSSWITCH, edit(text));
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
  // A Server or GNU/Linux router writes them from its Servicios settings (linux-files.ts); smb.conf has none.
  if (on && (!runsServices(host.kind) || ANY_HOST_FILES.has(name))) writeShipped(fs, name);
  if (name === 'avahi-daemon' || name === 'libnss-mdns') {
    editNsswitch(fs, (text) => withMdns(text, hasPackage(host, 'libnss-mdns')));
  }
  if (name === 'libnss-resolve') editNsswitch(fs, (text) => withResolve(text, on));
  if (on) pkgInstalled(host, name);
  else pkgRemoved(host, name);
  if (WITH_PANELS.has(name)) notifyAppsChange(host);
}
