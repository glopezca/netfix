/**
 * Packages apt has installed on a host that are not a service panel (network-manager, avahi-daemon…, and every package
 * on a PC). They live beside the device in a weak registry, as its Configuración boxes do, and are saved with the
 * topology, so a feature that a package brings (nmcli, mDNS) stays after reopening the file. A dependency apt brought is
 * marked automatic, as apt-mark does: `apt autoremove` takes it once nothing installed needs it.
 */

const installed = new WeakMap<object, ReadonlySet<string>>();
const automatic = new WeakMap<object, ReadonlySet<string>>();
/** Debian package names: lower case, digits and + . - (what a file may bring is checked against it). */
const NAME = /^[a-z0-9][a-z0-9+.-]{0,63}$/;
/** Every catalogue package with its dependencies fits (apt-catalog.ts). */
const MAX_PACKAGES = 256;

export function hasPackage(d: object, name: string): boolean {
  return installed.get(d)?.has(name) ?? false;
}

/** In name order (what the file keeps). */
export function packagesOf(d: object): readonly string[] {
  return [...(installed.get(d) ?? [])].sort();
}

function toggle(map: WeakMap<object, ReadonlySet<string>>, d: object, name: string, on: boolean): void {
  const next = new Set(map.get(d));
  if (on) next.add(name);
  else next.delete(name);
  map.set(d, next);
}

/** Installing by hand (or as a lab preinstalls it) is manual; removing also drops the automatic mark. */
export function setPackageInstalled(d: object, name: string, on: boolean): void {
  toggle(installed, d, name, on);
  if (!on) toggle(automatic, d, name, false);
}

/** Installed as a dependency (apt-mark auto) or, with false, kept by hand (apt-mark manual). */
export function setPackageAuto(d: object, name: string, on: boolean): void {
  if (on && !hasPackage(d, name)) return;
  toggle(automatic, d, name, on);
}

export function isPackageAuto(d: object, name: string): boolean {
  return automatic.get(d)?.has(name) ?? false;
}

/** The installed packages marked automatic, in name order (what the file keeps). */
export function autoPackagesOf(d: object): readonly string[] {
  return packagesOf(d).filter((n) => isPackageAuto(d, n));
}

/** The `packages` of a file (untrusted): valid names, no repeats, a bounded list. */
export function parsePackages(data: unknown): string[] {
  if (!Array.isArray(data) || data.length > MAX_PACKAGES) return [];
  return [...new Set(data.filter((n): n is string => typeof n === 'string' && NAME.test(n)))];
}
