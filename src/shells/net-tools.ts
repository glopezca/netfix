/** Network operations shared by the Linux and Windows shells and the desktop apps. */
import { mdnsResolve } from '../net/mdns.ts';
import { winsLookup } from './samba-wins.ts';
import { windowsLinkResolve } from '../net/win-names.ts';
import { hostsSources, nssNext } from './nsswitch.ts';
import type { NssStatus } from './nsswitch.ts';
import { hasPackage } from '../net/host-packages.ts';
import type { Host } from '../devices/host.ts';
import type { AppPayload, DnsMessage, HttpHeaders, HttpMethod } from '../net/packets.ts';
import { firstAddress, normalizeName, reverseName } from '../net/dns.ts';
import type { TcpResult } from '../net/tcp.ts';
import { runSync } from '../net/sync.ts';
import { parseIp } from '../core/ip.ts';
import { dnsQuery, dnsSearch, hostsLookup } from './dns-client.ts';
import { resolvedLookup } from './nss-resolve.ts';
import { resolvedRunning } from './resolved.ts';

export type Resolved =
  | { readonly kind: 'ip'; readonly ip: number; readonly name: string; readonly viaDns: boolean }
  | { readonly kind: 'error'; readonly reason: 'noserver' | 'timeout' | 'nxdomain' | 'nodata' };

const DEFAULT_HTTP_PORT = 80;
const TCP_WAIT_MS = 6000;
/** Remote commands may run network tools on the server (ping, dig, curl…). */
export const SSH_WAIT_MS = 60_000;

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

/** What one NSS module answers: its status for glibc and, when it found the name, the address. */
interface NssStep {
  readonly status: NssStatus;
  readonly result?: Resolved;
}

const notFound: NssStep = { status: 'NOTFOUND' };
const unavail: NssStep = { status: 'UNAVAIL' };
const DNS_STATUS: Readonly<Record<Extract<Resolved, { kind: 'error' }>['reason'], NssStatus>> = { noserver: 'UNAVAIL', timeout: 'TRYAGAIN', nxdomain: 'NOTFOUND', nodata: 'NOTFOUND' };

/**
 * libnss-resolve: systemd-resolved answers (LLMNR, mDNS, DNS). A stopped unit is UNAVAIL ([!UNAVAIL=return] lets the
 * next source try); any failure of resolved itself is NOTFOUND.
 */
function resolveStep(host: Host, target: string): NssStep {
  if (!resolvedRunning(host)) return unavail;
  const r = resolvedLookup(host, target);
  if (r.kind === 'link') return { status: 'SUCCESS', result: { kind: 'ip', ip: r.ip, name: normalizeName(target), viaDns: false } };
  const addr = r.kind === 'dns' && r.result.kind === 'answer' && r.result.msg.rcode === 'NOERROR' ? firstAddress(r.result.msg) : undefined;
  return r.kind === 'dns' && addr !== undefined ? { status: 'SUCCESS', result: { kind: 'ip', ip: addr, name: normalizeName(r.name), viaDns: true } } : notFound;
}

/** One source of «hosts:»; a module that is not installed (or a source glibc does not know) is UNAVAIL. */
function nssStep(host: Host, source: string, target: string): NssStep {
  if (source === 'dns') {
    const r = dnsStep(host, target);
    return { status: r.kind === 'ip' ? 'SUCCESS' : DNS_STATUS[r.reason], result: r };
  }
  if (source === 'resolve' && hasPackage(host, 'libnss-resolve')) return resolveStep(host, target);
  if (source.startsWith('mdns') && (hasPackage(host, 'libnss-mdns') || hasPackage(host, 'avahi-daemon'))) {
    // The _minimal modules only take .local names: anything else is UNAVAIL, so [NOTFOUND=return] does not stop it.
    if (source.endsWith('_minimal') && !isLocalName(target)) return unavail;
    const r = ip(mdnsResolve(host, normalizeName(target), false), normalizeName(target));
    return r ? { status: 'SUCCESS', result: r } : notFound;
  }
  if (source === 'wins' && hasPackage(host, 'libnss-winbind') && hasPackage(host, 'winbind')) {
    const r = singleLabel(target) ? ip(winsLookup(host, target), target) : undefined;
    return r ? { status: 'SUCCESS', result: r } : notFound;
  }
  return unavail;
}

/** GNU/Linux: the sources of «hosts:» in /etc/nsswitch.conf, in order, with their [STATUS=action] (files was already asked). */
function linuxLookup(host: Host, target: string): Resolved {
  let last: Resolved = { kind: 'error', reason: 'nxdomain' };
  for (const { source, actions } of hostsSources(host)) {
    const step = nssStep(host, source, target);
    if (step.result) last = step.result;
    if (nssNext(actions, step.status) === 'return') return step.status === 'SUCCESS' ? last : step.result ?? { kind: 'error', reason: 'nxdomain' };
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
