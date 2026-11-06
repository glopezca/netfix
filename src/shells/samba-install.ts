/**
 * The Samba box of a device's Configuración tab: what `apt install -y samba` / `apt remove -y samba` would leave, without
 * the terminal (apt-install.ts: its dependencies installed as automatic, smb.conf written, smbd and nmbd started and
 * enabled; on removal both stop and the dependencies stay for autoremove). Not while the lab does not allow Samba.
 */
import type { Host } from '../devices/host.ts';
import { sambaAllowed } from '../net/device-apps.ts';
import { setAptInstalled } from './apt-install.ts';

/** Installs (on) or removes (off) the samba package as apt would; nothing when already so or the lab forbids it. */
export function setSambaInstalled(host: Host, on: boolean): void {
  if (on && !sambaAllowed(host)) return;
  setAptInstalled(host, 'samba', on);
}
