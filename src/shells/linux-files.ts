/** Read-only view of the files a student would inspect on Ubuntu (generated from the live config). */
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { formatIp, formatMask, networkOf, broadcastOf } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { zonesOf } from '../services/dns-service.ts';
import { normalizeName } from '../net/dns.ts';
import { ptExclusions } from '../services/dhcp-pt.ts';
import type { DnsRecord, ServerServices } from '../services/config.ts';
import { cleanOrigin, effectiveRecords, qualify } from '../services/dns-names.ts';

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
    const res = p.reservations.map((r) => `{ ${r.clientId ? `"client-id": "${linuxMac(r.clientId)}"` : `"hw-address": "${linuxMac(r.mac ?? '')}"`}, "ip-address": "${formatIp(r.ip)}" }`).join(',\n          ');
    return `      {
        "id": ${i + 1},
        "subnet": "${formatIp(net)}/${p.prefix}",
        "pools": [ { "pool": "${formatIp(p.start)} - ${formatIp(last)}" } ],
        "valid-lifetime": ${p.leaseMinutes * 60},${p.identifyBy === 'mac' ? '\n        "match-client-id": false,' : ''}
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

function zoneLine(name: string, r: DnsRecord, value: string): string {
  return `${name.padEnd(16)}${String(r.ttl).padEnd(8)}IN  ${r.type.padEnd(6)}${r.type === 'MX' ? `${r.priority ?? 10} ` : ''}${value}`;
}

const inZone = (name: string, zone: string): boolean => name === zone || name.endsWith(`.${zone}`);

/** Zone file: the origin zone keeps the names as typed (relative, @ or absolute); others are derived. */
function zoneFile(s: ServerServices, zone: string): string {
  const origin = cleanOrigin(s.dns.origin);
  const head = [`$TTL 86400`, ...(zone === origin ? [`$ORIGIN ${zone}.`] : []), `@   IN  SOA  ns.${zone}. admin.${zone}. ( 2026101101 604800 86400 2419200 3600 )`];
  const typed = zone === origin
    ? s.dns.records.filter((r) => inZone(qualify(r.name, origin) ?? '', zone)).map((r) => zoneLine(r.name.trim(), r, r.type === 'TXT' ? `"${r.value}"` : r.value.trim()))
    : effectiveRecords(s.dns).filter((r) => inZone(normalizeName(r.name), zone)).map((r) => {
      const name = normalizeName(r.name) === zone ? '@' : normalizeName(r.name).slice(0, -(zone.length + 1));
      const value = r.type === 'A' ? r.value : r.type === 'TXT' ? `"${r.value}"` : `${normalizeName(r.value)}.`;
      return zoneLine(name, r, value);
    });
  return [...head, ...typed, ''].join('\n');
}

function zonesFor(s: ServerServices): string[] {
  const origin = cleanOrigin(s.dns.origin);
  const zones = zonesOf(effectiveRecords(s.dns)).filter((z) => !origin || !inZone(z, origin));
  return origin ? [origin, ...zones] : zones;
}

/** Apache snippets and settings of the web applications, as their Ubuntu packages install them. */
function webAppFiles(s: ServerServices, files: Map<string, string>): void {
  const rc = s.webapps.roundcube;
  if (rc.enabled) {
    files.set('/etc/apache2/conf-enabled/roundcube.conf', rc.mode === 'alias'
      ? `# Generado por Netfix (Servicios → HTTP → Roundcube)\nAlias ${rc.alias} /var/lib/roundcube/public_html\n\n<Directory /var/lib/roundcube/public_html/>\n  Options +FollowSymLinks\n  AllowOverride All\n  Require all granted\n</Directory>\n`
      : `# Generado por Netfix (Servicios → HTTP → Roundcube)\nListen ${rc.port}\n<VirtualHost *:${rc.port}>\n  DocumentRoot /var/lib/roundcube/public_html\n  <Directory /var/lib/roundcube/public_html/>\n    Require all granted\n  </Directory>\n</VirtualHost>\n`);
    files.set('/etc/roundcube/config.inc.php', `<?php\n$config = [];\n$config['imap_host'] = 'localhost:143';\n$config['smtp_host'] = 'localhost:25';\n$config['product_name'] = 'Roundcube Webmail';\n$config['skin'] = 'elastic';\n$config['mail_domain'] = '${s.mail.domain}';\n`);
  }
  const ad = s.webapps.admin;
  if (ad.enabled && ad.mode === 'alias') {
    files.set('/etc/apache2/conf-enabled/netfix-admin.conf', `# Generado por Netfix (Servicios → HTTP → Gestión web)\nAlias ${ad.alias} /usr/share/netfix-admin\n<Directory /usr/share/netfix-admin>\n  Require all granted\n</Directory>\n`);
  }
}

function serverFiles(server: Server): Map<string, string> {
  const s = server.services;
  const files = new Map<string, string>();
  webAppFiles(s, files);
  files.set('/etc/kea/kea-dhcp4.conf', keaConf(s));
  const zones = zonesFor(s);
  files.set('/etc/bind/named.conf.local', zones.map((z) => `zone "${z}" {\n    type master;\n    file "/etc/bind/db.${z}";\n};\n`).join('\n'));
  for (const z of zones) files.set(`/etc/bind/db.${z}`, zoneFile(s, z));
  files.set('/etc/postfix/main.cf', `myhostname = ${server.name.toLowerCase()}.${s.mail.domain || 'localdomain'}\nmydomain = ${s.mail.domain || 'localdomain'}\nmydestination = $mydomain, localhost\ninet_interfaces = all\nhome_mailbox = Maildir/\n`);
  files.set('/etc/dovecot/dovecot.conf', `protocols = ${[s.mail.pop3 ? 'pop3' : '', s.mail.imap ? 'imap' : ''].filter(Boolean).join(' ') || 'none'}\nmail_location = maildir:~/Maildir\n`);
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
    ['/etc/resolv.conf', `# Netfix: servidor DNS configurado en el equipo\n${c.dns !== undefined ? `nameserver ${formatIp(c.dns)}` : '# (sin servidor DNS)'}\n`],
    ['/etc/netplan/50-cloud-init.yaml', netplan(host)],
  ]);
  if (host.kind === 'server') for (const [k, v] of serverFiles(host as Server)) files.set(k, v);
  return files;
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
