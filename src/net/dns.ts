/** DNS client (stub resolver) and helpers shared by clients and the DNS service. */
import type { DnsMessage, DnsType } from './packets.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export type DnsResult =
  | { readonly kind: 'answer'; readonly msg: DnsMessage; readonly server: number }
  | { readonly kind: 'timeout'; readonly server: number }
  | { readonly kind: 'noserver' };

export interface ResolverEnv {
  /** Sends a DNS query over UDP from `sport` to `server:53`. False when there is no route. */
  sendQuery(server: number, sport: number, msg: DnsMessage): boolean;
  schedule(delayMs: number, fn: () => void): void;
}

const RESOLVER_PORT_BASE = 50_000;
const RESOLVER_PORTS = 1000;
const DEFAULT_TIMEOUT_MS = 2000;
const MAX_CNAME_CHAIN = 8;

export class DnsResolver {
  private readonly env: ResolverEnv;
  private readonly waiting = new Map<number, (r: DnsResult) => void>();
  private nextId = 0x1a2b;

  constructor(env: ResolverEnv) {
    this.env = env;
  }

  /** Port the host must hand DNS responses on (any port in the resolver range). */
  ownsPort(port: number): boolean {
    return port >= RESOLVER_PORT_BASE && port < RESOLVER_PORT_BASE + RESOLVER_PORTS;
  }

  query(server: number | undefined, name: string, type: DnsType, done: (r: DnsResult) => void, timeoutMs = DEFAULT_TIMEOUT_MS): void {
    if (server === undefined) {
      done({ kind: 'noserver' });
      return;
    }
    const id = this.nextId = (this.nextId + 1) & 0xffff;
    const sport = RESOLVER_PORT_BASE + (id % RESOLVER_PORTS);
    const msg: DnsMessage = { id, response: false, qname: normalizeName(name), qtype: type };
    let settled = false;
    const finish = (r: DnsResult): void => {
      if (settled) return;
      settled = true;
      this.waiting.delete(id);
      done(r);
    };
    this.waiting.set(id, (r) => finish(r));
    if (!this.env.sendQuery(server, sport, msg)) {
      finish({ kind: 'timeout', server });
      return;
    }
    this.env.schedule(timeoutMs, () => finish({ kind: 'timeout', server }));
  }

  receive(msg: DnsMessage, from: number): void {
    if (!msg.response) return;
    this.waiting.get(msg.id)?.({ kind: 'answer', msg, server: from });
  }
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.+$/, '');
}

/** Follows CNAMEs inside one response and returns the first IPv4 address, if any. */
export function firstAddress(msg: DnsMessage): number | undefined {
  let target = msg.qname;
  for (let i = 0; i < MAX_CNAME_CHAIN; i++) {
    const a = msg.answers?.find((r) => r.name === target && r.type === 'A');
    if (a) return parseIp(a.data) ?? undefined;
    const cname = msg.answers?.find((r) => r.name === target && r.type === 'CNAME');
    if (!cname) return undefined;
    target = cname.data;
  }
  return undefined;
}

/** "10.0.0.5" → "5.0.0.10.in-addr.arpa" */
export function reverseName(ip: number): string {
  return `${formatIp(ip).split('.').reverse().join('.')}.in-addr.arpa`;
}

/** "5.0.0.10.in-addr.arpa" → 10.0.0.5 */
export function ipFromReverse(name: string): number | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\.in-addr\.arpa$/.exec(normalizeName(name));
  if (!m) return undefined;
  return parseIp([m[4], m[3], m[2], m[1]].join('.')) ?? undefined;
}

export function isValidHostname(name: string): boolean {
  const n = normalizeName(name);
  return n.length > 0 && n.length <= 253 && n.split('.').every((l) => /^(\*|[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)$/.test(l));
}
