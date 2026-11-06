/**
 * The package catalogue of a device's Configuración tab: apt's service packages (each one is a service box: installing
 * it ticks the box and brings its panel, apt-state.ts) and its tool packages. Each has a box in the device (apt install /
 * apt remove, apt-install.ts) and one in Configuración → Laboratorio actual: a package the lab takes away is no longer
 * in the archive (apt cannot find it, nor its short name), but a device that has it keeps it. Saved with the topology
 * as the list of packages taken away.
 */
import { labViewOf } from './device-apps.ts';
import type { AppsDevice } from './device-apps.ts';

/** The packages of Netfix's services, in the order of the Servicios tab. */
export const SERVICE_PACKAGES = ['openssh-server', 'kea-dhcp4-server', 'bind9', 'apache2', 'postfix', 'dovecot-imapd', 'dovecot-pop3d', 'nftables', 'wireguard-tools', 'rsyslog', 'samba', 'avahi-daemon', 'winbind'] as const;

/**
 * Tools without a panel (bind9utils, the old name of bind9-utils, is left to the terminal). network-manager is a
 * network service, but what it would show (addresses, gateway, DNS, link state) is in Interfaces and TCP/IP already:
 * its tool, nmcli, is what it adds.
 */
export const TOOL_PACKAGES = ['network-manager', 'libnss-mdns', 'libnss-resolve', 'smbclient', 'samba-common-bin', 'libnss-winbind', 'bind9-utils'] as const;

/** In the order the boxes list them. */
export const CATALOG_PACKAGES: readonly string[] = [...SERVICE_PACKAGES, ...TOOL_PACKAGES];

/** Short names that only depend on a catalogue package: they go with it (apt cannot install them without it). */
const SHORT: Readonly<Record<string, string>> = { ssh: 'openssh-server', kea: 'kea-dhcp4-server', 'isc-kea': 'kea-dhcp4-server', wireguard: 'wireguard-tools' };

/** A longer list in a file is not a list of packages (the catalogue has a handful). */
const MAX_LIST = 64;

const inCatalogue = (name: unknown): name is string => (CATALOG_PACKAGES as readonly unknown[]).includes(name);

/** Not taken away by the lab (a package outside the catalogue always is available). */
export function packageAllowed(off: readonly string[], name: string): boolean {
  return !off.includes(SHORT[name] ?? name);
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
