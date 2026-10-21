/**
 * /etc/bind/named.conf.options: generated from the DNS settings and editable (root): `max-cache-ttl`, forwarders,
 * `forward only|first`, `recursion yes|no` and `allow-recursion { localnets; | any; }` change the server.
 */
import type { DnsSettings } from './config.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export const NAMED_OPTIONS = '/etc/bind/named.conf.options';
const MAX_FORWARDERS = 8;
const MAX_TTL = 2_147_483_647;

export const DEFAULT_MAX_CACHE_TTL = 604800;

/** Iterative resolution happens when bind recurses and is not limited to its forwarders (`forward only`). */
export function iterates(s: DnsSettings): boolean {
  return s.recursion === true && !((s.forwarders ?? []).length > 0 && s.forwardOnly !== false);
}

export function namedOptions(s: DnsSettings): string {
  const fwd = s.forwarders ?? [];
  const lines = [
    'options {',
    '\tdirectory "/var/cache/bind";',
    '',
    '\t// Caché: tiempo máximo que se guarda una respuesta obtenida por recursión (0 = no se guarda)',
    `\tmax-cache-ttl ${s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL};`,
    '',
    '\t// Agente de reenvío: servidores a los que se pasan las consultas recursivas',
    ...(fwd.length ? ['\tforwarders {', ...fwd.map((ip) => `\t\t${formatIp(ip)};`), '\t};'] : ['\t// forwarders {', '\t//\t8.8.8.8;', '\t// };']),
    '\t// Iterativo: "first" = si los reenviadores no responden, resuelve desde los servidores raíz; "only" = nunca',
    '\t// (sin reenviadores, la recursión siempre es iterativa)',
    `\tforward ${s.forwardOnly === false ? 'first' : 'only'};`,
    '',
    '\t// Recursivo: resuelve cualquier nombre para los clientes permitidos',
    `\trecursion ${s.recursion === true ? 'yes' : 'no'};`,
    `\tallow-recursion { ${s.allowRecursion === 'any' ? 'any' : 'localnets; localhost'}; };`,
    '',
    '\tdnssec-validation no;',
    '\tlisten-on-v6 { any; };',
    '};',
    '',
  ];
  return lines.join('\n');
}

/** A BIND duration: seconds, or a number with s, m, h, d or w. */
const UNITS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
function seconds(text: string): number {
  const unit = text.slice(-1).toLowerCase();
  return Object.hasOwn(UNITS, unit) ? Number(text.slice(0, -1)) * (UNITS[unit] ?? 1) : Number(text);
}

function block(text: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*\\{([^}]*)\\}\\s*;`).exec(text);
  return m ? m[1] ?? '' : null;
}

/** The settings described by an edited file (cache, forwarding, recursion); an error in named-checkconf words. */
export function parseNamedOptions(text: string, current: DnsSettings): DnsSettings | { error: string } {
  const clean = text.replace(/\/\/.*$/gm, '').replace(/#.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if ((clean.match(/\{/g) ?? []).length !== (clean.match(/\}/g) ?? []).length) return { error: `${NAMED_OPTIONS}: unexpected end of input` };
  const fwdText = block(clean, 'forwarders');
  const items = (fwdText ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  const forwarders: number[] = [];
  for (const item of items) {
    const ip = parseIp(item.split(/\s+/)[0] ?? '');
    if (ip === null) return { error: `${NAMED_OPTIONS}: '${item}': not a valid IPv4 address` };
    forwarders.push(ip);
  }
  if (forwarders.length > MAX_FORWARDERS) return { error: `${NAMED_OPTIONS}: too many forwarders` };
  const recursion = /\brecursion\s+(yes|no)\s*;/.exec(clean)?.[1];
  const forward = /\bforward\s+(only|first)\s*;/.exec(clean)?.[1];
  const ttl = /\bmax-cache-ttl\s+(\d+[smhdw]?)\s*;/i.exec(clean)?.[1];
  const allow = block(clean, 'allow-recursion') ?? '';
  return {
    ...current,
    // BIND's defaults when a statement is missing: recursion yes, forward first, max-cache-ttl one week.
    recursion: recursion !== 'no',
    forwarders,
    forwardOnly: forward === 'only',
    maxCacheTtl: ttl === undefined ? DEFAULT_MAX_CACHE_TTL : Math.min(seconds(ttl), MAX_TTL),
    allowRecursion: /\bany\b/.test(allow) ? 'any' : 'localnets',
  };
}
