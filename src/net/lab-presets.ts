/**
 * How each recorded lab sets up its devices (their Configuración tab): servers and GNU/Linux routers show only the
 * services they run, PCs the mail client only where an account is set up. The lab itself limits nothing (v0.26), so
 * a service installed later with apt, or ticked, always shows.
 */
import { SERVICE_IDS } from './lab-features.ts';
import type { FeatureId } from './lab-features.ts';
import { defaultApps, setDeviceApps } from './device-apps.ts';
import type { Topology } from './topology.ts';
import { Host } from '../devices/host.ts';
import { Pc } from '../devices/pc.ts';
import { Server } from '../devices/server.ts';

/** What a lab uses beyond the services its servers start: SRV-SEDE2 gets SSH through the ISP, PC1 tries SFTP. */
const EXTRA: Readonly<Record<string, Readonly<Record<string, readonly FeatureId[]>>>> = {
  internet: { 'SRV-SEDE2': ['ssh'] },
  'vpn-wireguard': { CENTRAL: ['vpn'], SUCURSAL: ['vpn'] },
  'ssh-sftp': { PC1: ['sftp'] },
};

const SERVICES: readonly FeatureId[] = SERVICE_IDS;

function servicesInUse(s: Server): FeatureId[] {
  const v = s.services;
  // A GNU/Linux router runs Apache only because a new one does: its labs do not use it.
  const on: readonly [FeatureId, boolean][] = [['ssh', v.ssh.enabled], ['dhcp', v.dhcp.enabled], ['dns', v.dns.enabled], ['http', v.http.enabled && s.kind === 'server'],
    ['mail', v.mail.smtp || v.mail.pop3 || v.mail.imap], ['firewall', v.firewall.enabled], ['files', true], ['log', true]];
  return on.filter(([, used]) => used).map(([id]) => id);
}

/** Each device of a recorded lab (its Configuración tab): servers with the services they run, PCs with mail if set up. */
export function setLabDevices(id: string, topo: Topology): void {
  for (const p of topo.placed.values()) {
    const d = p.device;
    if (!(d instanceof Host)) continue;
    const extra = EXTRA[id]?.[p.label] ?? [];
    const base = defaultApps(d).filter((a) => !(d instanceof Server) || !(SERVICES.includes(a) || a === 'firewall' || a === 'vpn'));
    const used = d instanceof Server ? servicesInUse(d) : d instanceof Pc && d.mailAccount ? ['mail' as const] : [];
    setDeviceApps(d, [...base, ...used, ...extra]);
  }
}
