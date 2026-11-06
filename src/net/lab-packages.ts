/**
 * The package catalogue of a device's Configuración tab: apt's tool packages, which bring no service panel (those
 * follow the Servicios boxes and the lab features; samba has its own). Each has a box in the device (apt install /
 * apt remove, apt-install.ts) and one in Configuración → Laboratorio actual: a package the lab takes away is no longer
 * in the archive (apt cannot find it), but a device that has it keeps it. Saved with the topology as the list of
 * packages taken away.
 */
import { labViewOf } from './device-apps.ts';
import type { AppsDevice } from './device-apps.ts';

/** In the order the boxes list them (bind9utils, the old name of bind9-utils, is left to the terminal). */
export const CATALOG_PACKAGES = ['network-manager', 'avahi-daemon', 'libnss-mdns', 'libnss-resolve', 'smbclient', 'samba-common-bin', 'winbind', 'libnss-winbind', 'bind9-utils'] as const;

/** A longer list in a file is not a list of packages (the catalogue has a handful). */
const MAX_LIST = 64;

const inCatalogue = (name: unknown): name is string => (CATALOG_PACKAGES as readonly unknown[]).includes(name);

/** Not taken away by the lab (a package outside the catalogue always is available). */
export function packageAllowed(off: readonly string[], name: string): boolean {
  return !off.includes(name);
}

/** The device's lab keeps the package in its archive. */
export function labHasPackage(d: AppsDevice, name: string): boolean {
  return packageAllowed(labViewOf(d).pkgsOff, name);
}

/** A copy with one package taken away (on) or given back, in catalogue order; names outside it are ignored. */
export function setPackageOff(off: readonly string[], name: string, on: boolean): string[] {
  return CATALOG_PACKAGES.filter((p) => (p === name ? on && inCatalogue(name) : off.includes(p)));
}

/** The `pkgsOff` of a topology file (untrusted): catalogue names, no repeats; anything else is «all available». */
export function parsePkgsOff(data: unknown): string[] {
  if (!Array.isArray(data) || data.length > MAX_LIST) return [];
  return CATALOG_PACKAGES.filter((p) => data.includes(p));
}
