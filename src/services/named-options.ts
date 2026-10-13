/**
 * /etc/bind/named.conf.options: generated from the DNS settings and editable (root): forwarders,
 * `forward only|first`, `recursion yes|no` and `allow-recursion { localnets; | any; }` change the server.
 */
import type { DnsSettings } from './config.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export const NAMED_OPTIONS = '/etc/bind/named.conf.options';
const MAX_FORWARDERS = 8;

export function namedOptions(s: DnsSettings): string {
  const fwd = s.forwarders ?? [];
  const lines = [
    'options {',
    '\tdirectory "/var/cache/bind";',
    '',
    '\t// Reenviadores / forwarders: consultas recursivas que esta zona no resuelve',
    ...(fwd.length ? ['\tforwarders {', ...fwd.map((ip) => `\t\t${formatIp(ip)};`), '\t};', `\tforward ${s.forwardOnly === false ? 'first' : 'only'};`] : ['\t// forwarders {', '\t//\t8.8.8.8;', '\t// };']),
    '',
    `\trecursion ${fwd.length ? 'yes' : 'no'};`,
    ...(fwd.length ? [`\tallow-recursion { ${s.allowRecursion === 'any' ? 'any' : 'localnets; localhost'}; };`] : []),
    '\tdnssec-validation no;',
    '\tlisten-on-v6 { any; };',
    '};',
    '',
  ];
  return lines.join('\n');
}

function block(text: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*\\{([^}]*)\\}\\s*;`).exec(text);
  return m ? m[1] ?? '' : null;
}

/** The settings described by an edited file (only the recursion part); an error in named-checkconf words. */
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
  const allow = block(clean, 'allow-recursion') ?? '';
  return {
    ...current,
    forwarders: recursion === 'no' ? [] : forwarders,
    forwardOnly: forward !== 'first',
    allowRecursion: /\bany\b/.test(allow) ? 'any' : 'localnets',
  };
}
