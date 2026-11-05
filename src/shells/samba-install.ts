/**
 * The Samba box of a device's Configuración tab: what `apt install -y samba` / `apt remove -y samba` would leave, without
 * the terminal (its dependencies installed as automatic, smb.conf written, smbd and nmbd started and enabled; on removal
 * both stop and the dependencies stay for autoremove). Not while the lab does not allow Samba.
 */
import type { Host } from '../devices/host.ts';
import { sambaAllowed } from '../net/device-apps.ts';
import { findPackage } from './apt-catalog.ts';
import { installedPackage, setPackage } from './apt-state.ts';
import { markDependencies } from './apt-auto.ts';
import { afterPackage } from './apt-scripts.ts';
import { toFetch } from './apt.ts';
import { hostSystem } from './host-system.ts';

/** Installs (on) or removes (off) the samba package as apt would; nothing when already so or the lab forbids it. */
export function setSambaInstalled(host: Host, on: boolean): void {
  const p = findPackage('samba');
  if (!p || installedPackage(host, p) === on || (on && !sambaAllowed(host))) return;
  if (on) markDependencies(host, [p], toFetch(host, [p]).map(({ pkg }) => pkg));
  setPackage(host, p, on);
  afterPackage(hostSystem(host).fs, host, p.name, on);
  host.notifyChange();
}
