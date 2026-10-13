/**
 * bind9 as a caching, forwarding resolver: queries for names outside its zones go to the forwarders
 * (8.8.8.8, the ISP…), one after another on timeout; answers are cached for their TTL and relayed with
 * RA set. Only clients allowed by allow-recursion get recursion; RD=0 queries are never forwarded.
 */
import type { DnsMessage } from '../net/packets.ts';
import { normalizeName } from '../net/dns.ts';
import { inSubnet } from '../core/ip.ts';

export const FORWARD_TIMEOUT_MS = 1200;
const FIRST_PORT = 40_000;
const PORTS = 8000;
const MAX_CACHE = 512;
const MAX_PENDING = 256;
const NEGATIVE_TTL_S = 60;

export type AllowRecursion = 'localnets' | 'any';

export interface ForwarderEnv {
  send(dst: number, sport: number, msg: DnsMessage): void;
  reply(to: number, port: number, msg: DnsMessage): void;
  schedule(delayMs: number, fn: () => void): void;
  now(): number;
  log(line: string): void;
}

interface Pending {
  readonly client: number;
  readonly port: number;
  readonly query: DnsMessage;
  readonly servers: readonly number[];
  index: number;
  done: boolean;
}

/** Whether `client` may use recursion (localnets = same subnet as the server, or the server itself). */
export function recursionAllowed(allow: AllowRecursion, client: number, local: { ip?: number; prefix?: number }): boolean {
  if (allow === 'any') return true;
  if (local.ip === undefined || local.prefix === undefined) return false;
  return client === local.ip || (client >>> 24) === 127 || inSubnet(client, local.ip, local.prefix);
}

export class DnsForwarder {
  private readonly env: ForwarderEnv;
  private readonly pending = new Map<number, Pending>();
  private readonly cache = new Map<string, { msg: DnsMessage; expires: number }>();
  private nextPort = 0;

  constructor(env: ForwarderEnv) {
    this.env = env;
  }

  flush(): void {
    this.cache.clear();
  }

  cacheSize(): number {
    return this.cache.size;
  }

  /** Resolves `q` for the client through `servers`; answers from the cache when it can. */
  resolve(q: DnsMessage, client: number, port: number, servers: readonly number[]): void {
    const key = `${normalizeName(q.qname)}/${q.qtype}`;
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.env.now()) {
      this.env.reply(client, port, { ...hit.msg, id: q.id, ra: true, rd: q.rd, authoritative: false });
      return;
    }
    if (!servers.length || this.pending.size >= MAX_PENDING) {
      this.env.reply(client, port, { id: q.id, response: true, qname: q.qname, qtype: q.qtype, rcode: 'SERVFAIL', answers: [], ra: true, rd: q.rd });
      return;
    }
    this.ask({ client, port, query: q, servers, index: 0, done: false });
  }

  private ask(p: Pending): void {
    const server = p.servers[p.index];
    if (server === undefined) {
      this.env.log(`client query ${p.query.qname}/${p.query.qtype}: all forwarders failed (SERVFAIL)`);
      this.env.reply(p.client, p.port, { id: p.query.id, response: true, qname: p.query.qname, qtype: p.query.qtype, rcode: 'SERVFAIL', answers: [], ra: true, rd: p.query.rd });
      return;
    }
    const sport = FIRST_PORT + (this.nextPort++ % PORTS);
    this.pending.set(sport, p);
    this.env.send(server, sport, { ...p.query, id: sport, rd: true });
    this.env.schedule(FORWARD_TIMEOUT_MS, () => {
      if (p.done || this.pending.get(sport) !== p) return;
      this.pending.delete(sport);
      p.index += 1;
      this.ask(p);
    });
  }

  /** An upstream answer arriving on `port`; false when it is not one of ours. */
  onResponse(port: number, answer: DnsMessage): boolean {
    const p = this.pending.get(port);
    if (!p) return false;
    this.pending.delete(port);
    p.done = true;
    this.store(p.query, answer);
    this.env.reply(p.client, p.port, { ...answer, id: p.query.id, authoritative: false, ra: true, rd: p.query.rd });
    return true;
  }

  private store(q: DnsMessage, answer: DnsMessage): void {
    if (answer.rcode !== 'NOERROR' && answer.rcode !== 'NXDOMAIN') return;
    const ttl = Math.min(...(answer.answers ?? []).map((a) => a.ttl), answer.answers?.length ? Infinity : NEGATIVE_TTL_S);
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value ?? '');
    this.cache.set(`${normalizeName(q.qname)}/${q.qtype}`, { msg: answer, expires: this.env.now() + ttl * 1000 });
  }
}
