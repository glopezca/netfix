/**
 * The device settings each recorded lab brings (Configuración → Laboratorio actual): its servers and Linux routers
 * show only the services the lab uses; «bastionado» adds kernel parameters and firewall to the server. A lab that is
 * not here (no servers) keeps the defaults, so a server added by the student has everything.
 */
import { SERVICE_IDS } from './lab-features.ts';
import type { FeatureId, LabFeatures } from './lab-features.ts';
import { defaultApps, setDeviceApps } from './device-apps.ts';
import type { Topology } from './topology.ts';
import { Host } from '../devices/host.ts';
import { Pc } from '../devices/pc.ts';
import { Server } from '../devices/server.ts';

const BASE_SERVER = ['ip', 'linux', 'windows'] as const;
const KEEP = ['files', 'log'] as const;

export const LAB_PRESETS: Readonly<Record<string, LabFeatures>> = {
  servidores: { server: [...BASE_SERVER, 'ssh', 'dhcp', 'dns', 'http', 'mail', ...KEEP] },
  internet: { server: [...BASE_SERVER, 'ssh', 'dns', 'http', ...KEEP] },
  'dns-reenvio': { server: [...BASE_SERVER, 'dhcp', 'dns', ...KEEP] },
  'ssh-sftp': { server: [...BASE_SERVER, 'ssh', 'dns', ...KEEP] },
  bastionado: { server: [...BASE_SERVER, 'ssh', 'dns', 'http', ...KEEP, 'sysctl', 'firewall'] },
  'linux-dmz': { server: [...BASE_SERVER, 'http', ...KEEP], linuxrouter: ['sysctl', 'firewall', ...KEEP, 'linux'] },
  'vpn-wireguard': { linuxrouter: ['sysctl', 'firewall', 'vpn', 'ssh', ...KEEP, 'linux'] },
};

/** What a lab uses beyond the services its servers start: SRV-SEDE2 gets SSH through the ISP, PC1 tries SFTP. */
const EXTRA: Readonly<Record<string, Readonly<Record<string, readonly FeatureId[]>>>> = {
  internet: { 'SRV-SEDE2': ['ssh'] },
  'ssh-sftp': { PC1: ['sftp'] },
};

const SERVICES: readonly FeatureId[] = SERVICE_IDS;

function servicesInUse(s: Server): FeatureId[] {
  const v = s.services;
  const on: readonly [FeatureId, boolean][] = [['ssh', v.ssh.enabled], ['dhcp', v.dhcp.enabled], ['dns', v.dns.enabled], ['http', v.http.enabled],
    ['mail', v.mail.smtp || v.mail.pop3 || v.mail.imap], ['files', true], ['log', true]];
  return on.filter(([, used]) => used).map(([id]) => id);
}

/** Each device of a recorded lab (its Configuración tab): servers with the services they run, PCs with mail if set up. */
export function setLabDevices(id: string, topo: Topology): void {
  for (const p of topo.placed.values()) {
    const d = p.device;
    if (!(d instanceof Host)) continue;
    const extra = EXTRA[id]?.[p.label] ?? [];
    const base = defaultApps(d).filter((a) => !(d instanceof Server) || !SERVICES.includes(a));
    const used = d instanceof Server ? servicesInUse(d) : d instanceof Pc && d.mailAccount ? ['mail' as const] : [];
    setDeviceApps(d, [...base, ...used, ...extra]);
  }
}
