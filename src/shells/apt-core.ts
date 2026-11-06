/**
 * What apt changes once it has the packages, shared by the terminal (apt.ts) and the device's boxes (apt-install.ts):
 * which dependencies to fetch, and dpkg installing or removing (the package state, the automatic marks and the
 * maintainer scripts). No output and no network here.
 */
import type { Vfs } from '../bash/vfs.ts';
import type { Host } from '../devices/host.ts';
import { PACKAGES, findPackage } from './apt-catalog.ts';
import type { AptDep, AptPackage } from './apt-catalog.ts';
import { installedPackage, setPackage } from './apt-state.ts';
import { afterPackage } from './apt-scripts.ts';
import { markDependencies } from './apt-auto.ts';
import { setPackageInstalled } from '../net/host-packages.ts';

/** The packages to fetch for `todo` (dependencies not there yet first, each once). */
export function toFetch(host: Host, todo: readonly AptPackage[]): { pkg: AptDep; section: string }[] {
  // What is there already (with what came with it) is not fetched again.
  const present = PACKAGES.filter((p) => installedPackage(host, p)).flatMap((p) => [p.name, ...p.deps.map((d) => d.name)]);
  const seen = new Set([...todo.map((p) => p.name), ...present]);
  const deps = todo.flatMap((p) => p.deps.map((d) => ({ pkg: d, section: p.section }))).filter(({ pkg }) => !seen.has(pkg.name) && (seen.add(pkg.name), true));
  return [...deps, ...todo.map((p) => ({ pkg: p as AptDep, section: p.section }))];
}

/** dpkg after the download: the dependencies automatic, each package installed (manual) and its scripts run. */
export function commitInstall(fs: Vfs, host: Host, todo: readonly AptPackage[], fetched: readonly AptDep[]): void {
  markDependencies(host, todo, fetched);
  for (const p of todo) {
    setPackage(host, p, true);
    afterPackage(fs, host, p.name, true);
  }
}

/** dpkg removing packages (a catalogue one or a dependency); what they brought stays for autoremove. */
export function commitRemove(fs: Vfs, host: Host, todo: readonly AptDep[]): void {
  for (const d of todo) {
    const p = findPackage(d.name);
    if (p) setPackage(host, p, false);
    else setPackageInstalled(host, d.name, false);
    afterPackage(fs, host, d.name, false);
  }
}
