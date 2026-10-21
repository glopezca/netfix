/** The 13 DNS root servers (IPv4 addresses of root.hints, as published by IANA) used by iterative resolution. */
import { parseIp } from '../core/ip.ts';

export interface RootServer {
  readonly name: string;
  readonly ip: string;
}

export const ROOT_SERVERS: readonly RootServer[] = [
  { name: 'a.root-servers.net', ip: '198.41.0.4' }, { name: 'b.root-servers.net', ip: '170.247.170.2' },
  { name: 'c.root-servers.net', ip: '192.33.4.12' }, { name: 'd.root-servers.net', ip: '199.7.91.13' },
  { name: 'e.root-servers.net', ip: '192.203.230.10' }, { name: 'f.root-servers.net', ip: '192.5.5.241' },
  { name: 'g.root-servers.net', ip: '192.112.36.4' }, { name: 'h.root-servers.net', ip: '198.97.190.53' },
  { name: 'i.root-servers.net', ip: '192.36.148.17' }, { name: 'j.root-servers.net', ip: '192.58.128.30' },
  { name: 'k.root-servers.net', ip: '193.0.14.129' }, { name: 'l.root-servers.net', ip: '199.7.83.42' },
  { name: 'm.root-servers.net', ip: '202.12.27.33' },
];

export const ROOT_IPS: readonly number[] = ROOT_SERVERS.map((r) => parseIp(r.ip) ?? 0);

export const ROOT_HINTS_FILE = '/usr/share/dns/root.hints';

/** /usr/share/dns/root.hints (named.root), IPv4 part. */
export function rootHints(): string {
  const ns = ROOT_SERVERS.map((r) => `.                        3600000      NS    ${r.name.toUpperCase()}.`);
  const a = ROOT_SERVERS.map((r) => `${`${r.name.toUpperCase()}.`.padEnd(25)}3600000      A     ${r.ip}`);
  return [';       This file holds the information on root name servers needed to', ';       initialize cache of Internet domain name servers', ';       (e.g. reference this file in the "cache  .  <file>"', ';       configuration file of BIND domain name servers).', ';', ...ns, ...a, '; End of file', ''].join('\n');
}
