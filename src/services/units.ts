/** Service units as seen by systemctl (Ubuntu) and sc/net (Windows Server). */
import type { ServerServices } from './config.ts';

export type UnitId = 'dhcp' | 'dns' | 'http' | 'smtp' | 'mailbox' | 'ssh' | 'firewall';

export interface UnitInfo {
  readonly id: UnitId;
  readonly linux: string;
  readonly aliases: readonly string[];
  readonly process: string;
  readonly description: string;
  readonly windows: string;
  readonly windowsDisplay: string;
  readonly ports: readonly { readonly proto: 'udp' | 'tcp'; readonly port: number }[];
  readonly pid: number;
  /** Type=oneshot with RemainAfterExit (nftables): "active (exited)", no main process. */
  readonly oneshot?: boolean;
}

export const UNITS: readonly UnitInfo[] = [
  { id: 'dhcp', linux: 'kea-dhcp4-server', aliases: ['kea-dhcp4', 'isc-dhcp-server', 'dhcpd'], process: 'kea-dhcp4', description: 'Kea DHCPv4 Service', windows: 'DHCPServer', windowsDisplay: 'Servidor DHCP', ports: [{ proto: 'udp', port: 67 }], pid: 812 },
  { id: 'dns', linux: 'bind9', aliases: ['named'], process: 'named', description: 'BIND Domain Name Server', windows: 'DNS', windowsDisplay: 'Servidor DNS', ports: [{ proto: 'udp', port: 53 }], pid: 845 },
  { id: 'http', linux: 'apache2', aliases: ['httpd'], process: 'apache2', description: 'The Apache HTTP Server', windows: 'W3SVC', windowsDisplay: 'Servicio de publicación World Wide Web', ports: [{ proto: 'tcp', port: 80 }], pid: 903 },
  { id: 'smtp', linux: 'postfix', aliases: ['smtp'], process: 'master', description: 'Postfix Mail Transport Agent', windows: 'SMTPSVC', windowsDisplay: 'Protocolo simple de transferencia de correo (SMTP)', ports: [{ proto: 'tcp', port: 25 }], pid: 1021 },
  { id: 'mailbox', linux: 'dovecot', aliases: ['pop3', 'imap'], process: 'dovecot', description: 'Dovecot IMAP/POP3 email server', windows: 'POP3Svc', windowsDisplay: 'Servicio POP3/IMAP', ports: [{ proto: 'tcp', port: 110 }, { proto: 'tcp', port: 143 }], pid: 1088 },
  { id: 'ssh', linux: 'ssh', aliases: ['sshd', 'openssh-server'], process: 'sshd', description: 'OpenBSD Secure Shell server', windows: 'sshd', windowsDisplay: 'OpenSSH SSH Server', ports: [{ proto: 'tcp', port: 22 }], pid: 701 },
  { id: 'firewall', linux: 'nftables', aliases: ['nft'], process: 'nft', description: 'nftables', windows: 'MpsSvc', windowsDisplay: 'Windows Defender Firewall', ports: [], pid: 655, oneshot: true },
];

export function findUnit(name: string): UnitInfo | undefined {
  const n = name.trim().toLowerCase().replace(/\.service$/, '');
  return UNITS.find((u) => u.linux === n || u.aliases.includes(n) || u.windows.toLowerCase() === n);
}

export function unitActive(s: ServerServices, id: UnitId): boolean {
  switch (id) {
    case 'dhcp': return s.dhcp.enabled;
    case 'dns': return s.dns.enabled;
    case 'http': return s.http.enabled;
    case 'smtp': return s.mail.smtp;
    case 'mailbox': return s.mail.pop3 || s.mail.imap;
    case 'ssh': return s.ssh.enabled;
    case 'firewall': return s.firewall.enabled;
  }
}

export function setUnitActive(s: ServerServices, id: UnitId, on: boolean): ServerServices {
  switch (id) {
    case 'dhcp': return { ...s, dhcp: { ...s.dhcp, enabled: on } };
    case 'dns': return { ...s, dns: { ...s.dns, enabled: on } };
    case 'http': return { ...s, http: { ...s.http, enabled: on } };
    case 'smtp': return { ...s, mail: { ...s.mail, smtp: on } };
    case 'mailbox': return { ...s, mail: { ...s.mail, pop3: on, imap: on } };
    case 'ssh': return { ...s, ssh: { ...s.ssh, enabled: on } };
    case 'firewall': return { ...s, firewall: { enabled: on } };
  }
}

/** The management GUI's own web server (port mode). */
/**
 * The units of Servicios → Registros: SSH first (the first thing to check when administering remotely), then nftables
 * on a Linux router (a Server has no firewall panel), then the rest in the order of UNITS (Kea … Dovecot).
 */
export function logUnits(kind: string): UnitInfo[] {
  const first = ['ssh', ...(kind === 'linuxrouter' ? ['firewall'] : [])];
  const pick = (id: string): UnitInfo[] => UNITS.filter((u) => u.id === id);
  return [...first.flatMap(pick), ...UNITS.filter((u) => u.id !== 'ssh' && u.id !== 'firewall')];
}

export const WEBUI_UNIT: UnitInfo = { id: 'http', linux: 'netfix-webui', aliases: [], process: 'netfix-webui', description: 'Gestión web de Server', windows: 'netfix-webui', windowsDisplay: 'Gestión web', ports: [], pid: 1190 };

/** Ports actually open on the server, for ss/netstat. `web` = the live web ports (Apache Listen, own ports). */
export function openPorts(s: ServerServices, web?: { readonly http: readonly number[]; readonly admin: readonly number[] }): { proto: 'udp' | 'tcp'; port: number; unit: UnitInfo }[] {
  const out: { proto: 'udp' | 'tcp'; port: number; unit: UnitInfo }[] = [];
  for (const unit of UNITS) {
    if (!unitActive(s, unit.id)) continue;
    if (unit.id === 'http' && web) {
      out.push(...web.http.map((port) => ({ proto: 'tcp' as const, port, unit })));
      continue;
    }
    for (const p of unit.ports) {
      if (unit.id === 'mailbox' && ((p.port === 110 && !s.mail.pop3) || (p.port === 143 && !s.mail.imap))) continue;
      out.push({ ...p, unit });
    }
  }
  if (web) out.push(...web.admin.map((port) => ({ proto: 'tcp' as const, port, unit: WEBUI_UNIT })));
  return out.sort((a, b) => (a.proto === b.proto ? a.port - b.port : a.proto === 'udp' ? -1 : 1));
}
