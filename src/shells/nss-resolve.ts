/**
 * What systemd-resolved does with a host name (the A lookup of `resolvectl query` and of the NSS source `resolve`,
 * libnss-resolve), after its synthetic records: a `.local` name goes to mDNS, a single label to LLMNR and, with a
 * search list, to the DNS (ResolveUnicastSingleLabel=no: never bare), the rest to the DNS. Only the links with a scope
 * are asked (resolved.ts: the unit runs and the link's support is not «no»).
 */
import type { Host } from '../devices/host.ts';
import type { DnsResult } from '../net/dns.ts';
import { normalizeName } from '../net/dns.ts';
import { LLMNR_WAIT_MS, llmnrLookup } from '../net/llmnr.ts';
import { mdnsResolve } from '../net/mdns.ts';
import { runSync } from '../net/sync.ts';
import { dnsSearch, searchDomains } from './dns-client.ts';
import { resolvedAsks } from './resolved.ts';
import type { Protocol } from './resolved.ts';

export type LinkProtocol = 'LLMNR/IPv4' | 'mDNS/IPv4';

export type ResolvedLookup =
  | { readonly kind: 'link'; readonly ip: number; readonly protocol: LinkProtocol }
  | { readonly kind: 'dns'; readonly result: DnsResult; readonly name: string }
  /** noscope: no link or server may take the name; attempts: the links were asked and nobody answered. */
  | { readonly kind: 'failed'; readonly reason: 'noscope' | 'attempts' };

const MARGIN_MS = 500;
const noScope: ResolvedLookup = { kind: 'failed', reason: 'noscope' };
const noAnswer: ResolvedLookup = { kind: 'failed', reason: 'attempts' };

/** A stack interface where resolved has a scope for the protocol. */
const scopeOn = (host: Host, p: Protocol) => (iface: string): boolean => resolvedAsks(host, host.linuxIfName(iface), p);
const hasScope = (host: Host, p: Protocol): boolean => host.l3Ifaces().some((i) => i.up && i.addrs.length > 0 && scopeOn(host, p)(i.name));

function llmnr(host: Host, name: string): number | undefined {
  return runSync<number | undefined>(host.hooks, (done) => llmnrLookup(host, name, done, scopeOn(host, 'llmnr')), LLMNR_WAIT_MS + MARGIN_MS);
}

export function resolvedLookup(host: Host, name: string): ResolvedLookup {
  const bare = name.replace(/\.$/, '');
  if (/\.local$/i.test(bare)) {
    if (!hasScope(host, 'mdns')) return noScope;
    const ip = mdnsResolve(host, normalizeName(bare), false);
    return ip === undefined ? noAnswer : { kind: 'link', ip, protocol: 'mDNS/IPv4' };
  }
  if (bare.includes('.')) return { kind: 'dns', ...dnsSearch(host, name, 'A') };
  const linkLocal = hasScope(host, 'llmnr');
  if (linkLocal) {
    const ip = llmnr(host, bare);
    if (ip !== undefined) return { kind: 'link', ip, protocol: 'LLMNR/IPv4' };
  }
  if (searchDomains(host).length > 0) return { kind: 'dns', ...dnsSearch(host, name, 'A') };
  return linkLocal ? noAnswer : noScope;
}
