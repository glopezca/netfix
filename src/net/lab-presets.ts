/**
 * The device settings each recorded lab brings (Configuración → Laboratorio actual): its servers and Linux routers
 * show only the services the lab uses; «bastionado» adds kernel parameters and firewall to the server. A lab that is
 * not here (no servers) keeps the defaults, so a server added by the student has everything.
 */
import type { LabFeatures } from './lab-features.ts';

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
