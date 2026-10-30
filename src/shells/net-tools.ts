/** Network operations shared by the Linux and Windows shells and the desktop apps. */
import { mdnsResolve } from '../net/mdns.ts';
import { nbnsResolve } from '../net/netbios.ts';
import { windowsLinkResolve } from '../net/win-names.ts';
import { hostsSources } from './nsswitch.ts';
import { hasPackage } from '../net/host-packages.ts';
import type { Host } from '../devices/host.ts';
import type { AppPayload, DnsMessage, DnsType, HttpHeaders, HttpMethod } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { firstAddress, normalizeName, reverseName } from '../net/dns.ts';
import type { TcpResult } from '../net/tcp.ts';
import { runSync } from '../net/sync.ts';
import { parseIp } from '../core/ip.ts';
import { peekHostFile } from '../devices/host-fs.ts';
import { countTransaction, resolvedDns, resolvedDomains } from './resolved.ts';

export type Resolved =
  | { readonly kind: 'ip'; readonly ip: number; readonly name: string; readonly viaDns: boolean }
  | { readonly kind: 'error'; readonly reason: 'noserver' | 'timeout' | 'nxdomain' | 'nodata' };

const DNS_WAIT_MS = 6000;
const DEFAULT_HTTP_PORT = 80;
const TCP_WAIT_MS = 6000;
/** Remote commands may run network tools on the server (ping, dig, curl…). */
export const SSH_WAIT_MS = 60_000;

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

/** The address /etc/hosts gives a name (first matching line, IPv4), as the `files` source of nsswitch. */
export function hostsLookup(host: Host, name: string): number | undefined {
  // A device whose Linux system was never used still has the default file (no need to build the system for it).
  const text = peekHostFile(host, '/etc/hosts') ?? `127.0.0.1 localhost\n127.0.1.1 ${host.name.toLowerCase()}\n`;
  const wanted = normalizeName(name.replace(/\.$/, ''));
  for (const line of text.split('\n')) {
    const [addr, ...names] = line.replace(/#.*/, '').trim().split(/\s+/);
    const ip = addr ? parseIp(addr) : null;
    if (ip !== null && names.some((n) => normalizeName(n.replace(/\.$/, '')) === wanted)) return ip;
  }
  return undefined;
}

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

/** Who asks: a GNU/Linux program (glibc and /etc/nsswitch.conf) or a Windows one (its DNS client and NetBT). */
export type NameClient = 'linux' | 'windows';

type Step = Resolved | undefined;
const ip = (addr: number | undefined, name: string): Step => (addr === undefined ? undefined : { kind: 'ip', ip: addr, name, viaDns: false });
const isLocalName = (name: string): boolean => /\.local\.?$/i.test(name);
const singleLabel = (name: string): boolean => !name.replace(/\.$/, '').includes('.');

function dnsStep(host: Host, target: string): Resolved {
  const { result: r, name } = dnsSearch(host, target, 'A');
  if (r.kind !== 'answer') return { kind: 'error', reason: r.kind };
  if (r.msg.rcode === 'NXDOMAIN' || r.msg.rcode === 'REFUSED' || r.msg.rcode === 'SERVFAIL') return { kind: 'error', reason: 'nxdomain' };
  const addr = firstAddress(r.msg);
  return addr === undefined ? { kind: 'error', reason: 'nodata' } : { kind: 'ip', ip: addr, name: normalizeName(name), viaDns: true };
}

/** Windows: hosts, then mDNS for .local, the DNS (with its suffix) and, for a bare name, LLMNR and NetBIOS at once. */
function windowsLookup(host: Host, target: string): Resolved {
  if (isLocalName(target)) return ip(mdnsResolve(host, normalizeName(target), true), normalizeName(target)) ?? dnsStep(host, target);
  const dns = dnsStep(host, target);
  if (dns.kind === 'ip' || !singleLabel(target)) return dns;
  return ip(windowsLinkResolve(host, target), target) ?? dns;
}

/** GNU/Linux: the sources of «hosts:» in /etc/nsswitch.conf, in order (files was already asked). */
function linuxLookup(host: Host, target: string): Resolved {
  let last: Resolved = { kind: 'error', reason: 'nxdomain' };
  for (const { source, notFoundReturn } of hostsSources(host)) {
    if (source === 'dns') last = dnsStep(host, target);
    else if (source.startsWith('mdns') && (hasPackage(host, 'libnss-mdns') || hasPackage(host, 'avahi-daemon')) && (source === 'mdns' || source === 'mdns4' || isLocalName(target))) {
      last = ip(mdnsResolve(host, normalizeName(target), false), normalizeName(target)) ?? { kind: 'error', reason: 'nxdomain' };
      if (last.kind === 'error' && notFoundReturn && isLocalName(target)) return last;
    } else if (source === 'wins' && hasPackage(host, 'libnss-winbind') && hasPackage(host, 'winbind') && singleLabel(target)) {
      last = ip(nbnsResolve(host, target), target) ?? last;
    }
    if (last.kind === 'ip') return last;
  }
  return last;
}

/** IP literal, the host's own name, /etc/hosts, then what the asking system does (linuxLookup, windowsLookup). */
/** `client` defaults to the device's system (TCP/IP tab); the terminals say which one asks. */
export function resolveHost(host: Host, target: string, client: NameClient = host.os === 'windows' ? 'windows' : 'linux'): Resolved {
  const literal = parseIp(target);
  if (literal !== null) return { kind: 'ip', ip: literal, name: target, viaDns: false };
  // The host's own name answers with its network address (its hosts line, 127.0.1.1, is the loopback).
  if (normalizeName(target) === host.name.toLowerCase() && host.config.ip !== undefined) return { kind: 'ip', ip: host.config.ip, name: target, viaDns: false };
  const local = hostsLookup(host, target);
  if (local !== undefined) return { kind: 'ip', ip: local, name: target, viaDns: false };
  return client === 'windows' ? windowsLookup(host, target) : linuxLookup(host, target);
}

export function tcpCall(host: Host, ip: number, port: number, payload: AppPayload, waitMs = TCP_WAIT_MS): TcpResult {
  return runSync<TcpResult>(host.hooks, (done) => host.connect(ip, port, payload, done, waitMs), waitMs + 1000) ?? { kind: 'timeout' };
}

export interface UrlParts {
  readonly host: string;
  readonly port: number;
  readonly path: string;
}

export function parseUrl(text: string): UrlParts | null {
  const m = /^(?:(https?):\/\/)?([^/:?#\s]+)(?::(\d+))?([^\s]*)$/i.exec(text.trim());
  if (!m) return null;
  const port = m[3] ? Number(m[3]) : 80;
  if (m[1]?.toLowerCase() === 'https' && !m[3]) return null;
  return { host: m[2] ?? '', port, path: m[4] && m[4].startsWith('/') ? m[4] : `/${m[4] ?? ''}` };
}

export type HttpOutcome =
  | { readonly kind: 'ok'; readonly response: Extract<AppPayload, { app: 'HTTP'; kind: 'response' }>; readonly ip: number }
  | { readonly kind: 'error'; readonly code: number; readonly message: string };

export interface HttpOptions {
  readonly method?: HttpMethod;
  readonly headers?: HttpHeaders;
  readonly body?: string;
  /** Who resolves the name (the device's system when absent: its browser, its mail client). */
  readonly client?: NameClient;
}

/** Resolves and fetches a URL. Errors use curl's exit codes and messages. */
export function httpGet(host: Host, url: string, method: HttpMethod = 'GET', client?: NameClient): HttpOutcome {
  return httpRequest(host, url, { method, ...(client ? { client } : {}) });
}

/** One HTTP request (no redirects followed); the Host header carries the port when it is not 80. */
export function httpRequest(host: Host, url: string, opts: HttpOptions = {}): HttpOutcome {
  const parts = parseUrl(url);
  if (!parts) return { kind: 'error', code: 3, message: `URL rejected: Malformed input to a URL function (solo se admite http://)` };
  const target = resolveHost(host, parts.host, opts.client);
  if (target.kind === 'error') return { kind: 'error', code: 6, message: `Could not resolve host: ${parts.host}` };
  const headers: HttpHeaders = { host: `${parts.host}${parts.port !== DEFAULT_HTTP_PORT ? `:${parts.port}` : ''}`, 'user-agent': 'Netfix', ...opts.headers };
  const r = tcpCall(host, target.ip, parts.port, { app: 'HTTP', kind: 'request', method: opts.method ?? 'GET', host: parts.host, path: parts.path, headers, body: opts.body });
  if (r.kind === 'ok' && r.reply.app === 'HTTP' && r.reply.kind === 'response') return { kind: 'ok', response: r.reply, ip: target.ip };
  if (r.kind === 'refused' || r.kind === 'unreachable') return { kind: 'error', code: 7, message: `Failed to connect to ${parts.host} port ${parts.port} after 0 ms: Couldn't connect to server` };
  if (r.kind === 'noroute') return { kind: 'error', code: 7, message: `Failed to connect to ${parts.host} port ${parts.port} after 0 ms: Couldn't connect to server` };
  return { kind: 'error', code: 28, message: `Failed to connect to ${parts.host} port ${parts.port} after 6000 ms: Connection timed out` };
}

export function reverseLookup(host: Host, ip: number, server?: number): DnsMessage | undefined {
  const r = dnsQuery(host, reverseName(ip), 'PTR', server);
  return r.kind === 'answer' ? r.msg : undefined;
}

/** "Sun Oct 11 19:50:01 UTC 2026" */
export function dateLine(ms: number): string {
  return new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, (_m, d, day, mon, y, t) => `${d} ${mon} ${String(day).padStart(2, ' ')} ${t} UTC ${y}`);
}

export function splitArgs(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}
