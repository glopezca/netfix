/**
 * `resolvectl query`: names and addresses through systemd-resolved, worded as systemd 257 prints them. The same
 * resolver as ping and dig: /etc/hosts and the host's own name first (synthetic data), then DNS with the search list.
 */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { DnsAnswer, DnsType } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { normalizeName, reverseName } from '../net/dns.ts';
import { dnsQuery, dnsSearch, hostsLookup } from './net-tools.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export const QUERY_TYPES: readonly DnsType[] = ['A', 'CNAME', 'MX', 'NS', 'TXT', 'PTR', 'SOA'];
const ADDRESS_COLUMN = 31;
const RECORD_COLUMN = 47;
const LOOPBACK_NET = 127;

interface Found {
  readonly lines: readonly string[];
  readonly synthetic: boolean;
}

const linkFor = (host: Host, ip: number): string => ((ip >>> 24) === LOOPBACK_NET ? 'lo' : host.linuxIfName(host.primaryPort()));

/** «name: value   -- link: eth0», the next values under the first, and the canonical name in brackets. */
function addressLines(name: string, values: readonly string[], link: string, canonical?: string): string[] {
  const indent = ' '.repeat(name.length + 2);
  const rows = values.map((v, i) => `${i === 0 ? `${name}: ` : indent}${v.padEnd(ADDRESS_COLUMN)}-- link: ${link}`);
  return canonical && normalizeName(canonical) !== normalizeName(name) ? [...rows, `${indent}(${canonical})`] : rows;
}

/** The error of a lookup with no answer, in resolved's words. */
function failure(name: string, r: DnsResult): string {
  if (r.kind === 'noserver') return 'No appropriate name servers or networks for name found';
  if (r.kind === 'timeout') return 'All attempts to contact name servers or networks failed';
  if (r.msg.rcode === 'NXDOMAIN') return `'${name}' not found`;
  if (r.msg.rcode !== 'NOERROR') return `Server returned error ${r.msg.rcode}`;
  return `'${name}' does not have any RR of the requested type`;
}

const recordText = (a: DnsAnswer): string => `${a.name.replace(/\.$/, '')} IN ${a.type} ${a.type === 'MX' ? `${a.priority ?? 10} ` : ''}${a.data}`;

/** /etc/hosts, localhost and the host's own name: answered without asking a server. */
function synthetic(host: Host, name: string): Found | undefined {
  const own = normalizeName(name) === host.name.toLowerCase() ? host.config.ip : undefined;
  const ip = own ?? hostsLookup(host, name);
  return ip === undefined ? undefined : { lines: addressLines(name, [formatIp(ip)], linkFor(host, ip)), synthetic: true };
}

function lookup(host: Host, name: string, type: DnsType | undefined): Found | string {
  const literal = parseIp(name);
  if (literal !== null) {
    const r = dnsQuery(host, reverseName(literal), 'PTR');
    const ptr = r.kind === 'answer' ? (r.msg.answers ?? []).filter((a) => a.type === 'PTR').map((a) => a.data.replace(/\.$/, '')) : [];
    return ptr.length ? { lines: addressLines(name, ptr, linkFor(host, literal)), synthetic: false } : failure(reverseName(literal), r);
  }
  if (!type) {
    const local = synthetic(host, name);
    if (local) return local;
  }
  const { result } = dnsSearch(host, name, type ?? 'A');
  const answers = result.kind === 'answer' ? result.msg.answers ?? [] : [];
  const link = host.linuxIfName(host.primaryPort());
  if (type) {
    const records = answers.filter((a) => a.type === type);
    return records.length ? { lines: records.map((a) => `${recordText(a).padEnd(RECORD_COLUMN)}-- link: ${link}`), synthetic: false } : failure(name, result);
  }
  const addresses = answers.filter((a) => a.type === 'A');
  return addresses.length ? { lines: addressLines(name, addresses.map((a) => a.data), link, addresses[0]?.name.replace(/\.$/, '')), synthetic: false } : failure(name, result);
}

export interface QueryOptions {
  readonly type?: DnsType;
  readonly legend: boolean;
}

/** One block per name; a failure goes to stderr and makes the exit status 1. */
export function query(ctx: Ctx, host: Host, names: readonly string[], opts: QueryOptions): number {
  let status = 0;
  for (const name of names) {
    const start = host.clock.now();
    const r = lookup(host, name, opts.type);
    if (typeof r === 'string') {
      ctx.err(`${name}: resolve call failed: ${r}\n`);
      status = 1;
      continue;
    }
    const ms = Math.max(0.1, host.clock.now() - start).toFixed(1);
    const legend = ['', `-- Information acquired via protocol DNS in ${ms}ms.`, '-- Data is authenticated: no; Data was acquired via local or encrypted transport: no', `-- Data from: ${r.synthetic ? 'synthetic' : 'network'}`];
    ctx.out(`${[...r.lines, ...(opts.legend ? legend : [])].join('\n')}\n`);
  }
  return status;
}
