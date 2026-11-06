/**
 * A package box of the device: what `apt install -y X` / `apt remove -y X` would leave, without the terminal or the
 * network (its dependencies installed as automatic, its scripts run; on removal they stay for autoremove).
 */
import type { Host } from '../devices/host.ts';
import { findPackage } from './apt-catalog.ts';
import { installedPackage } from './apt-state.ts';
import { commitInstall, commitRemove, toFetch } from './apt-core.ts';
import { hostSystem } from './host-system.ts';

/** Installs (on) or removes (off) a catalogue package as apt would: whether anything changed. */
export function setAptInstalled(host: Host, name: string, on: boolean): boolean {
  const p = findPackage(name);
  if (!p || installedPackage(host, p) === on) return false;
  const fs = hostSystem(host).fs;
  if (on) commitInstall(fs, host, [p], toFetch(host, [p]).map(({ pkg }) => pkg));
  else commitRemove(fs, host, [p]);
  host.notifyChange();
  return true;
}
