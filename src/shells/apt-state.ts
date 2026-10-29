/**
 * What apt has installed on a host. On a Server or GNU/Linux router a service package is installed when its panel is
 * on in the device (Configuración tab), so the box and apt always agree; the three mail packages each follow their
 * own service (postfix SMTP, dovecot-imapd IMAP, dovecot-pop3d POP3) and the panel stays while one is left. Anything
 * else (and every package on a PC, which has no service panels) is kept with the device (host-packages.ts). Installing starts the
 * service and removing stops it, as dpkg's scripts do.
 */
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { runsServices } from '../devices/kinds.ts';
import { APPS_BY_KIND, deviceApps, setDeviceApps } from '../net/device-apps.ts';
import type { AptPackage } from './apt-catalog.ts';
import { hasPackage, setPackageInstalled } from '../net/host-packages.ts';

type MailKey = 'smtp' | 'imap' | 'pop3';
const MAIL_KEY: Readonly<Record<string, MailKey>> = { postfix: 'smtp', 'dovecot-imapd': 'imap', 'dovecot-pop3d': 'pop3' };

/** The package turns on a panel of this device (a PC's SSH and mail tabs are clients, not these services). */
const hasPanel = (host: Host, p: AptPackage): boolean =>
  runsServices(host.kind) && p.feature !== undefined && APPS_BY_KIND[host.kind].includes(p.feature);

// Server and the GNU/Linux router (a value import of Server would close an import cycle through the shells).
const asServer = (host: Host): Server => host as Server;

export function installedPackage(host: Host, p: AptPackage): boolean {
  if (!hasPanel(host, p) || p.feature === undefined) return hasPackage(host, p.name);
  const key = MAIL_KEY[p.name];
  return deviceApps(host).includes(p.feature) && (key === undefined || asServer(host).services.mail[key]);
}

/** The service a package runs, started on install and stopped on remove. */
function runService(server: Server, p: AptPackage, on: boolean): void {
  const s = server.services;
  if (p.feature === 'ssh') server.setServices({ ...s, ssh: { ...s.ssh, enabled: on } });
  else if (p.feature === 'dhcp') server.setServices({ ...s, dhcp: { ...s.dhcp, enabled: on } });
  else if (p.feature === 'dns') server.setServices({ ...s, dns: { ...s.dns, enabled: on } });
  else if (p.feature === 'http') server.setServices({ ...s, http: { ...s.http, enabled: on } });
  else if (p.feature === 'firewall' && !on) server.setServices({ ...s, firewall: { ...s.firewall, enabled: false } });
  const key = MAIL_KEY[p.name];
  if (key) server.setServices({ ...server.services, mail: { ...server.services.mail, [key]: on } });
}

export function setPackage(host: Host, p: AptPackage, on: boolean): void {
  if (!hasPanel(host, p) || p.feature === undefined) {
    setPackageInstalled(host, p.name, on);
    return;
  }
  const server = asServer(host);
  runService(server, p, on);
  const mail = server.services.mail;
  const keep = !on && p.feature === 'mail' && (mail.smtp || mail.imap || mail.pop3);
  const rest = deviceApps(host).filter((id) => id !== p.feature);
  if (!keep) setDeviceApps(host, on ? [...rest, p.feature] : rest);
}
