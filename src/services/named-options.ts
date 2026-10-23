/**
 * /etc/bind/named.conf.options: generated from the DNS settings and editable (root): `max-cache-ttl`, forwarders,
 * `forward only|first`, `recursion yes|no` and `allow-recursion { localnets; | any; }` change the server.
 */
import type { DnsSettings } from './config.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { dnsListenAddresses, ifacesOfAddresses } from './listen.ts';
import type { ListenChoice } from './listen.ts';

export const NAMED_OPTIONS = '/etc/bind/named.conf.options';
const MAX_FORWARDERS = 8;
const MAX_TTL = 2_147_483_647;

export const DEFAULT_MAX_CACHE_TTL = 604800;

/** Iterative resolution happens when bind recurses and is not limited to its forwarders (`forward only`). */
export function iterates(s: DnsSettings): boolean {
  return s.recursion === true && !((s.forwarders ?? []).length > 0 && s.forwardOnly !== false);
}

/** listen-on { any; } or the addresses of the chosen interfaces ({ none; } when none has one). */
function listenOnLine(s: DnsSettings, choices: readonly ListenChoice[]): string {
  const addrs = dnsListenAddresses(s, choices);
  if (addrs === undefined) return '\tlisten-on { any; };';
  return `\tlisten-on { ${addrs.length ? addrs.map((a) => `${formatIp(a)}; `).join('') : 'none; '}};`;
}

export function namedOptions(s: DnsSettings, choices: readonly ListenChoice[] = []): string {
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
    '\t// Interfaces de escucha: direcciones en las que atiende consultas (any = todas)',
    listenOnLine(s, choices),
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

/** listen-on back to interfaces: missing or any = all; none = []; addresses = their interfaces. */
function listenOnOf(text: string | null, current: DnsSettings, choices: readonly ListenChoice[]): readonly string[] | undefined {
  if (text === null || /\bany\b/.test(text)) return undefined;
  const addrs = text.split(';').map((x) => parseIp(x.trim())).filter((x): x is number => x !== null);
  // The same addresses as now: keep the interfaces as chosen (one without an address writes nothing).
  const now = dnsListenAddresses(current, choices);
  if (now !== undefined && [...new Set(addrs)].sort().join() === [...new Set(now)].sort().join()) return current.listenOn;
  return ifacesOfAddresses(addrs, choices);
}

/** listen-on [port 53] { … }; */
const LISTEN_ON = /\blisten-on\s+(?:port\s+\d{1,5}\s+)?\{([^{}]*)\}\s*;/;

/** Larger than any real named.conf.options; parsing stays quick whatever is written. */
const MAX_OPTIONS_TEXT = 64 * 1024;

/** Removes // and # line comments and /* *\/ blocks in one pass (an unclosed /* runs to the end, as in BIND). */
function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    const two = text.slice(i, i + 2);
    if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (two === '//' || text[i] === '#') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function block(text: string, name: string): string | null {
  // [^{}]: each attempt stops at the next brace, so a hostile file cannot make this quadratic.
  const m = new RegExp(`\\b${name}\\s*\\{([^{}]*)\\}\\s*;`).exec(text);
  return m ? m[1] ?? '' : null;
}

/** The settings described by an edited file (cache, forwarding, recursion); an error in named-checkconf words. */
export function parseNamedOptions(text: string, current: DnsSettings, choices: readonly ListenChoice[] = []): DnsSettings | { error: string } {
  if (text.length > MAX_OPTIONS_TEXT) return { error: `${NAMED_OPTIONS}: file too large` };
  const clean = stripComments(text);
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
    listenOn: listenOnOf(LISTEN_ON.exec(clean)?.[1] ?? null, current, choices),
  };
}
