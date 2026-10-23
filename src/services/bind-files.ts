/**
 * The bind9 files of Ubuntu generated from the DNS settings: named.conf and its includes, the zone files (also the
 * reverse zones generated from forward ones) and the root hints that iterative resolution starts from.
 */
import type { DnsRecord, DnsSettings, DnsZone } from './config.ts';
import { DEFAULT_TTL } from './config.ts';
import { SAFE_ZONE, servedZones } from './dns-zones.ts';
import type { ListenChoice } from './listen.ts';
import type { ServedZone } from './dns-zones.ts';
import { NAMED_OPTIONS, namedOptions } from './named-options.ts';
import { ROOT_HINTS_FILE, rootHints } from '../net/dns-roots.ts';
import { RPZ_FILE, RPZ_ZONE, rpzFile } from './dns-rpz.ts';

export const NAMED_LOCAL = '/etc/bind/named.conf.local';
const NAMED_DEFAULT_ZONES = '/etc/bind/named.conf.default-zones';

export const zoneFilePath = (zone: string): string => `/etc/bind/db.${zone}`;

function zoneLine(r: DnsRecord): string {
  const value = r.type === 'TXT' ? `"${r.value.replace(/[\\"]/g, (c) => `\\${c}`)}"` : r.value.trim();
  return `${r.name.trim().padEnd(16)}${String(r.ttl).padEnd(8)}IN  ${r.type.padEnd(6)}${r.type === 'MX' ? `${r.priority ?? 10} ` : ''}${value}`;
}

/** A zone file with the SOA first, then the NS list, then the records as typed (relative to `$ORIGIN`). */
export function zoneFile(z: DnsZone, auto: boolean): string {
  const s = z.soa;
  const kind = z.kind === 'reverse' ? 'inversa' : 'directa';
  return [
    `; Zona ${kind} ${z.name}${auto ? ' — generada automáticamente a partir de los registros A de las zonas directas' : ''} (Netfix: Servicios → DNS)`,
    `$TTL ${DEFAULT_TTL}`,
    `$ORIGIN ${z.name}.`,
    `@               IN  SOA  ${s.mname}. ${s.rname}. (`,
    `                         ${String(s.serial).padEnd(11)}; serie`,
    `                         ${String(s.refresh).padEnd(11)}; refresh`,
    `                         ${String(s.retry).padEnd(11)}; retry`,
    `                         ${String(s.expire).padEnd(11)}; expire`,
    `                         ${String(s.minimum).padEnd(11)}); TTL negativo`,
    ...z.ns.map((ns) => `@               IN  NS    ${ns}.`),
    ...z.records.map(zoneLine),
    '',
  ].join('\n');
}

function zoneStanza(s: ServedZone): string {
  const note = s.auto ? '// Zona inversa automática (de los registros A de las zonas directas)\n' : '';
  return `${note}zone "${s.zone.name}" {\n\ttype master;\n\tfile "${zoneFilePath(s.zone.name)}";\n};\n`;
}

function namedLocal(dns: DnsSettings, zones: readonly ServedZone[]): string {
  const head = '//\n// Zonas de este servidor (modo autoritativo). Las genera Netfix: Servicios → DNS.\n//\n\n';
  if (dns.authoritative === false) return `${head}// Modo autoritativo desactivado: no se carga ninguna zona (se conservan en Netfix).\n${dns.publicNames?.enabled ? RPZ_STANZA : ''}`;
  return head + zones.map(zoneStanza).join('\n') + (dns.publicNames?.enabled ? RPZ_STANZA : '');
}

/** The policy zone is loaded whatever the authoritative mode: it is not served (allow-query none), only applied. */
const RPZ_STANZA = `
// Nombres públicos (Servicios → DNS → Nombres públicos): zona de política de respuesta
zone "${RPZ_ZONE}" {
\ttype master;
\tfile "${RPZ_FILE}";
\tallow-query { none; };
};
`;

const DEFAULT_ZONES = `// prime the server with knowledge of the root servers
// (iterative resolution starts here when recursion is on and it is not "forward only")
zone "." {
\ttype hint;
\tfile "${ROOT_HINTS_FILE}";
};

// be authoritative for the localhost forward and reverse zones, and for
// broadcast zones as per RFC 1912
zone "localhost" {
\ttype master;
\tfile "/etc/bind/db.local";
};

zone "127.in-addr.arpa" {
\ttype master;
\tfile "/etc/bind/db.127";
};
`;

const NAMED_CONF = `// This is the primary configuration file for the BIND DNS server named.
//
// Please read /usr/share/doc/bind9/README.Debian for information on the
// structure of BIND configuration files in Debian, *BEFORE* you customize
// this configuration file.
//
// If you are just adding zones, please do that in /etc/bind/named.conf.local

include "/etc/bind/named.conf.options";
include "/etc/bind/named.conf.local";
include "/etc/bind/named.conf.default-zones";
`;

export function bindFiles(dns: DnsSettings, choices: readonly ListenChoice[]): Map<string, string> {
  // A zone name is part of a file name: never one that could leave /etc/bind.
  const zones = servedZones(dns).filter((z) => SAFE_ZONE.test(z.zone.name));
  const files = new Map<string, string>([
    ['/etc/bind/named.conf', NAMED_CONF],
    [NAMED_OPTIONS, namedOptions(dns, choices)],
    [NAMED_LOCAL, namedLocal(dns, zones)],
    [NAMED_DEFAULT_ZONES, DEFAULT_ZONES],
    [ROOT_HINTS_FILE, rootHints()],
    [RPZ_FILE, rpzFile(dns)],
  ]);
  for (const z of zones) files.set(zoneFilePath(z.zone.name), zoneFile(z.zone, z.auto));
  return files;
}
