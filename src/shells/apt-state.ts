/**
 * What apt has installed on a host. A service package is installed when its panel is on in the device (Configuración
 * tab), so the box and apt always agree; any other package (or a service package on a device without that panel, such
 * as a PC) is remembered for the session. Installing starts the service and removing stops it, as dpkg's scripts do.
 */
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { runsServices } from '../devices/kinds.ts';
import { APPS_BY_KIND, deviceApps, setDeviceApps } from '../net/device-apps.ts';
import type { AptPackage } from './apt-catalog.ts';

const extras = new WeakMap<Host, Set<string>>();

const hasPanel = (host: Host, p: AptPackage): boolean => p.feature !== undefined && APPS_BY_KIND[host.kind].includes(p.feature);

export function installedPackage(host: Host, p: AptPackage): boolean {
  if (p.feature !== undefined && hasPanel(host, p)) return deviceApps(host).includes(p.feature);
  return extras.get(host)?.has(p.name) ?? false;
}

/** The service a package runs (postfix: SMTP, dovecot: IMAP or POP3…), started on install and stopped on remove. */
function runService(server: Server, p: AptPackage, on: boolean): void {
  const s = server.services;
  if (p.feature === 'ssh') server.setServices({ ...s, ssh: { ...s.ssh, enabled: on } });
  else if (p.feature === 'dhcp') server.setServices({ ...s, dhcp: { ...s.dhcp, enabled: on } });
  else if (p.feature === 'dns') server.setServices({ ...s, dns: { ...s.dns, enabled: on } });
  else if (p.feature === 'http') server.setServices({ ...s, http: { ...s.http, enabled: on } });
  else if (p.feature === 'firewall' && !on) server.setServices({ ...s, firewall: { ...s.firewall, enabled: false } });
  else if (p.feature === 'mail') {
    const key = p.name === 'postfix' ? 'smtp' : p.name === 'dovecot-imapd' ? 'imap' : 'pop3';
    server.setServices({ ...s, mail: on ? { ...s.mail, [key]: true } : { ...s.mail, smtp: false, imap: false, pop3: false } });
  }
}

export function setPackage(host: Host, p: AptPackage, on: boolean): void {
  if (p.feature !== undefined && hasPanel(host, p)) {
    const rest = deviceApps(host).filter((id) => id !== p.feature);
    setDeviceApps(host, on ? [...rest, p.feature] : rest);
    // Server and the GNU/Linux router (a value import of Server would close an import cycle through the shells).
    if (runsServices(host.kind)) runService(host as Server, p, on);
    return;
  }
  const set = extras.get(host) ?? new Set<string>();
  if (on) set.add(p.name);
  else set.delete(p.name);
  extras.set(host, set);
}
