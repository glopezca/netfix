/**
 * Packages apt has installed on a host that are not a service panel (network-manager, avahi-daemon…, and every package
 * on a PC). They live beside the device in a weak registry, as its Configuración boxes do, and are saved with the
 * topology, so a feature that a package brings (nmcli, mDNS) stays after reopening the file.
 */

const installed = new WeakMap<object, ReadonlySet<string>>();
/** Debian package names: lower case, digits and + . - (what a file may bring is checked against it). */
const NAME = /^[a-z0-9][a-z0-9+.-]{0,63}$/;
const MAX_PACKAGES = 64;

export function hasPackage(d: object, name: string): boolean {
  return installed.get(d)?.has(name) ?? false;
}

/** In name order (what the file keeps). */
export function packagesOf(d: object): readonly string[] {
  return [...(installed.get(d) ?? [])].sort();
}

export function setPackageInstalled(d: object, name: string, on: boolean): void {
  const next = new Set(installed.get(d));
  if (on) next.add(name);
  else next.delete(name);
  installed.set(d, next);
}

/** The `packages` of a file (untrusted): valid names, no repeats, a bounded list. */
export function parsePackages(data: unknown): string[] {
  if (!Array.isArray(data) || data.length > MAX_PACKAGES) return [];
  return [...new Set(data.filter((n): n is string => typeof n === 'string' && NAME.test(n)))];
}
