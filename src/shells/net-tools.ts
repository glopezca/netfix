/** Network operations shared by the Linux and Windows shells and the desktop apps. */
import type { Host } from '../devices/host.ts';
import type { AppPayload, DnsMessage, DnsType, HttpHeaders, HttpMethod } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { firstAddress, normalizeName, reverseName } from '../net/dns.ts';
import type { TcpResult } from '../net/tcp.ts';
import { runSync } from '../net/sync.ts';
import { parseIp } from '../core/ip.ts';

export type Resolved =
  | { readonly kind: 'ip'; readonly ip: number; readonly name: string; readonly viaDns: boolean }
  | { readonly kind: 'error'; readonly reason: 'noserver' | 'timeout' | 'nxdomain' | 'nodata' };

const DNS_WAIT_MS = 3000;
const DEFAULT_HTTP_PORT = 80;
const TCP_WAIT_MS = 6000;
/** Remote commands may run network tools on the server (ping, dig, curl…). */
export const SSH_WAIT_MS = 60_000;

export function dnsQuery(host: Host, name: string, type: DnsType, server?: number): DnsResult {
  const target = type === 'PTR' ? name : normalizeName(name);
  return runSync<DnsResult>(host.hooks, (done) => host.lookup(target, type, done, server ?? host.config.dns), DNS_WAIT_MS) ?? { kind: 'timeout', server: server ?? 0 };
}

/** IP literal, the host's own name, or a DNS A lookup. */
export function resolveHost(host: Host, target: string): Resolved {
  const literal = parseIp(target);
  if (literal !== null) return { kind: 'ip', ip: literal, name: target, viaDns: false };
  if (normalizeName(target) === host.name.toLowerCase() && host.config.ip !== undefined) return { kind: 'ip', ip: host.config.ip, name: target, viaDns: false };
  const r = dnsQuery(host, target, 'A');
  if (r.kind !== 'answer') return { kind: 'error', reason: r.kind };
  if (r.msg.rcode === 'NXDOMAIN' || r.msg.rcode === 'REFUSED' || r.msg.rcode === 'SERVFAIL') return { kind: 'error', reason: 'nxdomain' };
  const ip = firstAddress(r.msg);
  return ip === undefined ? { kind: 'error', reason: 'nodata' } : { kind: 'ip', ip, name: normalizeName(target), viaDns: true };
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
}

/** Resolves and fetches a URL. Errors use curl's exit codes and messages. */
export function httpGet(host: Host, url: string, method: HttpMethod = 'GET'): HttpOutcome {
  return httpRequest(host, url, { method });
}

/** One HTTP request (no redirects followed); the Host header carries the port when it is not 80. */
export function httpRequest(host: Host, url: string, opts: HttpOptions = {}): HttpOutcome {
  const parts = parseUrl(url);
  if (!parts) return { kind: 'error', code: 3, message: `URL rejected: Malformed input to a URL function (solo se admite http://)` };
  const target = resolveHost(host, parts.host);
  if (target.kind === 'error') return { kind: 'error', code: 6, message: `Could not resolve host: ${parts.host}` };
  const headers: HttpHeaders = { host: `${parts.host}${parts.port !== DEFAULT_HTTP_PORT ? `:${parts.port}` : ''}`, 'user-agent': 'netsim', ...opts.headers };
  const r = tcpCall(host, target.ip, parts.port, { app: 'HTTP', kind: 'request', method: opts.method ?? 'GET', host: parts.host, path: parts.path, headers, body: opts.body });
  if (r.kind === 'ok' && r.reply.app === 'HTTP' && r.reply.kind === 'response') return { kind: 'ok', response: r.reply, ip: target.ip };
  if (r.kind === 'refused') return { kind: 'error', code: 7, message: `Failed to connect to ${parts.host} port ${parts.port} after 0 ms: Couldn't connect to server` };
  if (r.kind === 'noroute') return { kind: 'error', code: 7, message: `Failed to connect to ${parts.host} port ${parts.port} after 0 ms: Network is unreachable` };
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
