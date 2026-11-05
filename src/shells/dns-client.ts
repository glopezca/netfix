/**
 * The DNS client of the GNU/Linux and Windows terminals: one query to the resolver's server, the search list and its
 * candidates, and /etc/hosts. net-tools.ts (resolveHost), nss-resolve.ts and the DNS tools build on it.
 */
import type { Host } from '../devices/host.ts';
import type { DnsType } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { normalizeName } from '../net/dns.ts';
import { runSync } from '../net/sync.ts';
import { parseIp } from '../core/ip.ts';
import { peekHostFile } from '../devices/host-fs.ts';
import { countTransaction, resolvedDns, resolvedDomains } from './resolved.ts';

const DNS_WAIT_MS = 6000;

export function dnsQuery(host: Host, name: string, type: DnsType, server?: number): DnsResult {
  const target = type === 'PTR' ? name : normalizeName(name);
  const to = server ?? resolvedDns(host);
  // Only lookups that go through the resolver (dig @server asks that server directly).
  if (server === undefined) countTransaction(host);
  // No server at all (none configured, or resolvectl dns eth0 ""): lookup() would fall back to the configured one.
  if (to === undefined) return { kind: 'noserver' };
  return runSync<DnsResult>(host.hooks, (done) => host.lookup(target, type, done, to), DNS_WAIT_MS) ?? { kind: 'timeout', server: to ?? 0 };
}

/** The search domains of the host: netplan's `nameservers.search`, then the DHCP domain (option 15) while the lease lasts. */
export function searchDomains(host: Host): readonly string[] {
  const runtime = resolvedDomains(host);
  // resolvectl domain: routing-only domains (~example.com, ~.) are not search domains.
  return runtime ? runtime.filter((d) => !d.startsWith('~')).map(normalizeName) : configuredSearchDomains(host);
}

/** The search list of the device's settings (netplan, DHCP), as /etc/resolv.conf shows it. */
export function configuredSearchDomains(host: Host): readonly string[] {
  const domain = host.config.mode === 'dhcp' ? host.dhcpClient.lease?.domainName : undefined;
  return [...new Set([...host.dnsSearch.map(normalizeName), ...(domain ? [normalizeName(domain)] : [])])];
}

/** One line of /etc/hosts with an IPv4 address: the canonical name first, then the aliases. */
export interface HostsEntry {
  readonly ip: number;
  readonly names: readonly string[];
}

/** The IPv4 lines of /etc/hosts, in order. */
export function hostsEntries(host: Host): HostsEntry[] {
  // A device whose Linux system was never used still has the default file (no need to build the system for it).
  const text = peekHostFile(host, '/etc/hosts') ?? `127.0.0.1 localhost\n127.0.1.1 ${host.name.toLowerCase()}\n`;
  return text.split('\n').flatMap((line) => {
    const [addr, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    const ip = addr ? parseIp(addr) : null;
    return ip !== null && names.length > 0 ? [{ ip, names }] : [];
  });
}

/** The first line of /etc/hosts that has the name, as the `files` source of nsswitch. */
export function hostsEntry(host: Host, name: string): HostsEntry | undefined {
  const wanted = normalizeName(name.replace(/\.$/, ''));
  return hostsEntries(host).find((e) => e.names.some((n) => normalizeName(n.replace(/\.$/, '')) === wanted));
}

/** The address /etc/hosts gives a name (first matching line, IPv4). */
export const hostsLookup = (host: Host, name: string): number | undefined => hostsEntry(host, name)?.ip;

/**
 * The names the resolver tries, as glibc with ndots:1 (and Windows with its DNS suffix): a name without dots goes
 * with each search domain first, a name with dots goes as typed first, and a final dot means only as typed.
 */
export function resolutionCandidates(name: string, search: readonly string[]): string[] {
  if (name.endsWith('.')) return [name.slice(0, -1)];
  const withDomains = search.map((d) => `${name}.${d}`);
  return name.includes('.') ? [name, ...withDomains] : [...withDomains, name];
}

const found = (r: DnsResult): boolean => r.kind === 'answer' && r.msg.rcode === 'NOERROR' && (r.msg.answers?.length ?? 0) > 0;

/**
 * A lookup through the search list: the first name that has an answer. As glibc, a timeout or a REFUSED reply ends
 * the search, an address or a reverse name (PTR) is never searched, and with no answer a NODATA reply (the name
 * exists without that record) is reported before a later NXDOMAIN.
 */
export function dnsSearch(host: Host, name: string, type: DnsType, server?: number): { readonly result: DnsResult; readonly name: string } {
  const literal = parseIp(name) !== null || type === 'PTR' || /\.arpa\.?$/i.test(name);
  const candidates = literal ? [name] : resolutionCandidates(name, searchDomains(host));
  let nodata: DnsResult | null = null;
  let last: DnsResult | null = null;
  for (const candidate of candidates) {
    const result = dnsQuery(host, candidate, type, server);
    if (found(result)) return { result, name: candidate };
    if (result.kind !== 'answer' || result.msg.rcode === 'REFUSED') return { result, name };
    if (result.msg.rcode === 'NOERROR') nodata ??= result;
    last = result;
  }
  return { result: nodata ?? last ?? dnsQuery(host, name, type, server), name };
}
