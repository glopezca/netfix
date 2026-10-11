/** Read-only view of the files a student would inspect on Ubuntu (generated from the live config). */
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { formatIp, formatMask, networkOf, broadcastOf } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { zonesOf } from '../services/dns-service.ts';
import { normalizeName } from '../net/dns.ts';
import { ptExclusions } from '../services/dhcp-pt.ts';
import type { ServerServices } from '../services/config.ts';

export const IFACE = 'eth0';

export function linuxMac(mac: string): string {
  return (mac.match(/../g) ?? []).join(':');
}

function netplan(host: Host): string {
  const c = host.config;
  if (c.mode === 'dhcp') return `network:\n  version: 2\n  ethernets:\n    ${IFACE}:\n      dhcp4: true\n`;
  const addr = c.ip !== undefined && c.prefix !== undefined ? `\n      addresses:\n        - ${formatIp(c.ip)}/${c.prefix}` : '';
  const gw = c.gateway !== undefined ? `\n      routes:\n        - to: default\n          via: ${formatIp(c.gateway)}` : '';
  const dns = c.dns !== undefined ? `\n      nameservers:\n        addresses: [${formatIp(c.dns)}]` : '';
  return `network:\n  version: 2\n  ethernets:\n    ${IFACE}:\n      dhcp4: false${addr}${gw}${dns}\n`;
}

function keaConf(s: ServerServices): string {
  const subnets = s.dhcp.pools.map((p, i) => {
    const net = networkOf(p.start, p.prefix);
    const last = Math.min(broadcastOf(p.start, p.prefix) - 1, p.start + p.maxUsers - 1);
    const opts = [
      p.gateway !== undefined ? `{ "name": "routers", "data": "${formatIp(p.gateway)}" }` : '',
      p.dns !== undefined ? `{ "name": "domain-name-servers", "data": "${formatIp(p.dns)}" }` : '',
      p.domain ? `{ "name": "domain-name", "data": "${p.domain}" }` : '',
    ].filter(Boolean).join(',\n          ');
    const res = p.reservations.map((r) => `{ "hw-address": "${linuxMac(r.mac)}", "ip-address": "${formatIp(r.ip)}" }`).join(',\n          ');
    return `      {
        "id": ${i + 1},
        "subnet": "${formatIp(net)}/${p.prefix}",
        "pools": [ { "pool": "${formatIp(p.start)} - ${formatIp(last)}" } ],
        "valid-lifetime": ${p.leaseMinutes * 60},
        "option-data": [
          ${opts}
        ],
        "reservations": [
          ${res}
        ]
      }`;
  });
  return `{
  "Dhcp4": {
    "interfaces-config": { "interfaces": [ "${IFACE}" ] },
    "lease-database": { "type": "memfile", "persist": true, "name": "/var/lib/kea/kea-leases4.csv" },
    "subnet4": [
${subnets.join(',\n')}
    ]
  }
}
`;
}

function zoneFile(s: ServerServices, zone: string): string {
  const recs = s.dns.records.filter((r) => { const n = normalizeName(r.name); return n === zone || n.endsWith(`.${zone}`); });
  const lines = recs.map((r) => {
    const name = normalizeName(r.name) === zone ? '@' : normalizeName(r.name).slice(0, -(zone.length + 1));
    const value = r.type === 'A' || r.type === 'TXT' ? (r.type === 'TXT' ? `"${r.value}"` : r.value) : `${normalizeName(r.value)}.`;
    return `${name.padEnd(16)}${String(r.ttl).padEnd(8)}IN  ${r.type.padEnd(6)}${r.type === 'MX' ? `${r.priority ?? 10} ` : ''}${value}`;
  });
  return [`$TTL 86400`, `@   IN  SOA  ns.${zone}. admin.${zone}. ( 2026101101 604800 86400 2419200 3600 )`, ...lines, ''].join('\n');
}

function serverFiles(server: Server): Map<string, string> {
  const s = server.services;
  const files = new Map<string, string>();
  files.set('/etc/kea/kea-dhcp4.conf', keaConf(s));
  const zones = zonesOf(s.dns.records);
  files.set('/etc/bind/named.conf.local', zones.map((z) => `zone "${z}" {\n    type master;\n    file "/etc/bind/db.${z}";\n};\n`).join('\n'));
  for (const z of zones) files.set(`/etc/bind/db.${z}`, zoneFile(s, z));
  for (const f of s.http.files) files.set(`/var/www/html/${f.name}`, f.content);
  files.set('/etc/postfix/main.cf', `myhostname = ${server.name.toLowerCase()}.${s.mail.domain || 'localdomain'}\nmydomain = ${s.mail.domain || 'localdomain'}\nmydestination = $mydomain, localhost\ninet_interfaces = all\nhome_mailbox = Maildir/\n`);
  files.set('/etc/dovecot/dovecot.conf', `protocols = ${[s.mail.pop3 ? 'pop3' : '', s.mail.imap ? 'imap' : ''].filter(Boolean).join(' ') || 'none'}\nmail_location = maildir:~/Maildir\n`);
  files.set('/etc/ssh/sshd_config', `Port 22\nPermitRootLogin prohibit-password\nPasswordAuthentication yes\n# Usuarios permitidos (netsim): ${s.ssh.users.map((u) => u.name).join(' ') || '(ninguno)'}\n`);
  const excl = s.dhcp.pools.flatMap(ptExclusions).length;
  files.set('/var/lib/kea/kea-leases4.csv', ['address,hwaddr,client_id,valid_lifetime,expire,subnet_id,hostname',
    ...server.dhcpEngine.allBindings(server.clock.now()).filter((b) => b.type === 'Automatic').map((b) =>
      `${formatIp(b.ip)},${linuxMac(b.mac)},${b.clientId ?? ''},0,${Math.floor((b.expiresAt ?? 0) / 1000)},1,${b.hostname ?? ''}`),
    `# ${excl} rangos excluidos fuera de los pools`].join('\n'));
  return files;
}

export function linuxFiles(host: Host): Map<string, string> {
  const c = host.config;
  const files = new Map<string, string>([
    ['/etc/os-release', 'PRETTY_NAME="Ubuntu 26.04 LTS"\nNAME="Ubuntu"\nVERSION_ID="26.04"\nID=ubuntu\n'],
    ['/etc/hostname', `${host.name.toLowerCase()}\n`],
    ['/etc/hosts', `127.0.0.1 localhost\n127.0.1.1 ${host.name.toLowerCase()}\n`],
    ['/etc/resolv.conf', `# netsim: servidor DNS configurado en el equipo\n${c.dns !== undefined ? `nameserver ${formatIp(c.dns)}` : '# (sin servidor DNS)'}\n`],
    ['/etc/netplan/50-cloud-init.yaml', netplan(host)],
  ]);
  if (host.kind === 'server') for (const [k, v] of serverFiles(host as Server)) files.set(k, v);
  return files;
}

export function listDir(files: Map<string, string>, dir: string): string[] | null {
  const d = dir.replace(/\/+$/, '') || '/';
  const names = new Set<string>();
  for (const path of files.keys()) {
    if (!path.startsWith(`${d}/`)) continue;
    names.add(path.slice(d.length + 1).split('/')[0] ?? '');
  }
  return names.size ? [...names].sort() : null;
}

export function describeAddress(host: Host): { inet: string; brd: string; scope: string } | undefined {
  const { ip, prefix, mode } = host.config;
  if (ip === undefined || prefix === undefined) return undefined;
  return { inet: `${formatIp(ip)}/${prefix}`, brd: formatIp(broadcastOf(ip, prefix)), scope: mode === 'dhcp' ? 'global dynamic' : 'global' };
}

export function maskOf(prefix: number): string {
  return formatMask(prefix);
}

export { formatMacCisco };
