/** Boot of a restored Linux router: `wg-quick up` for every enabled wg-quick@IFACE unit (as systemd does). */
import type { Host } from '../devices/host.ts';
import { createShell } from './factory.ts';
import { hostSystem } from './host-system.ts';
import { enabledWgUnits } from './wg-unit.ts';

export function bootWireguard(host: Host): void {
  if (host.kind !== 'linuxrouter') return;
  const units = enabledWgUnits(hostSystem(host).fs);
  if (!units.length) return;
  const root = createShell(host, 'linux', 'root');
  for (const iface of units) root.run(`systemctl start wg-quick@${iface}`);
}
