/**
 * Automatically installed packages, as apt keeps them in /var/lib/apt/extended_states: every dependency apt brings is
 * marked automatic, `apt install` of one marks it manual, and once nothing installed by hand needs it (directly or
 * through another package) it is «no longer required» and `apt autoremove` takes it.
 */
import type { Host } from '../devices/host.ts';
import { PACKAGES, findPackage } from './apt-catalog.ts';
import type { AptDep, AptPackage } from './apt-catalog.ts';
import { autoPackagesOf, isPackageAuto, packagesOf, setPackageAuto, setPackageInstalled } from '../net/host-packages.ts';
import { hasPanel, installedPackage } from './apt-state.ts';
import { labHasPackage } from '../net/lab-packages.ts';

/** A package or dependency by name, with the version and size apt shows when it removes it. */
export function findDep(name: string): AptDep | undefined {
  return findPackage(name) ?? PACKAGES.flatMap((p) => p.deps).find((d) => d.name === name);
}

/** The dependencies apt fetched for `todo` are installed and marked automatic (a service panel's package is not). */
export function markDependencies(host: Host, todo: readonly AptPackage[], fetched: readonly AptDep[]): void {
  for (const d of fetched) {
    if (todo.some((p) => p.name === d.name)) continue;
    const p = findPackage(d.name);
    if (p && hasPanel(host, p)) continue;
    setPackageInstalled(host, d.name, true);
    setPackageAuto(host, d.name, true);
  }
}

/** Ubuntu's base system brings nftables (priority important), as a Server has its firewall. */
const PC_BASE: readonly string[] = ['nftables'];

/** A new PC gets the base packages its lab keeps, with their libraries marked automatic (installed stopped). */
export function preinstallBase(host: Host): void {
  for (const name of PC_BASE) {
    const p = findPackage(name);
    if (!p || !labHasPackage(host, name)) continue;
    setPackageInstalled(host, name, true);
    markDependencies(host, [p], p.deps);
  }
}

/** The automatic packages nothing manual needs, once `without` is gone too (in name order). */
export function orphans(host: Host, without: readonly string[] = []): string[] {
  const required = new Set<string>();
  const need = (name: string): void => {
    if (required.has(name)) return;
    required.add(name);
    for (const d of findPackage(name)?.deps ?? []) need(d.name);
  };
  const manual = [...PACKAGES.filter((p) => installedPackage(host, p)).map((p) => p.name), ...packagesOf(host)];
  for (const name of manual) if (!without.includes(name) && !isPackageAuto(host, name)) need(name);
  return autoPackagesOf(host).filter((n) => !required.has(n) && !without.includes(n));
}

/** What apt says before removing, when some automatic packages are left over. */
export function leftoverNote(names: readonly string[]): string {
  return names.length
    ? `The following packages were automatically installed and are no longer required:\n  ${names.join('  ')}\nUse 'sudo apt autoremove' to remove them.\n\n`
    : '';
}
