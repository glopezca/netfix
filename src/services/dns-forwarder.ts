/**
 * bind9's resolver: queries for names outside its zones go to the forwarders (one after another on timeout) and,
 * when it may iterate (no forwarders, or `forward first` after they fail), down from the root servers: root → TLD →
 * the domain's servers, following referrals and CNAMEs. Answers and delegations are cached for their TTL (capped by
 * max-cache-ttl). Only clients allowed by allow-recursion get recursion; RD=0 queries are never resolved.
 */
import type { DnsAnswer, DnsMessage } from '../net/packets.ts';
import { normalizeName } from '../net/dns.ts';
import { formatIp, inSubnet } from '../core/ip.ts';
import { closestServers, iterStep } from './dns-iterate.ts';

export const FORWARD_TIMEOUT_MS = 1200;
const FIRST_PORT = 40_000;
const PORTS = 8000;
const MAX_CACHE = 512;
const MAX_PENDING = 256;
const NEGATIVE_TTL_S = 60;
const MAX_STEPS = 20;
/** Servers tried per zone while iterating (bind does not wait for all 13 roots). */
const TRIES_PER_ZONE = 3;
const DEFAULT_MAX_TTL = 604800;

export type AllowRecursion = 'localnets' | 'any';

export interface ForwarderEnv {
  send(dst: number, sport: number, msg: DnsMessage): void;
  reply(to: number, port: number, msg: DnsMessage): void;
  schedule(delayMs: number, fn: () => void): void;
  now(): number;
  log(line: string): void;
}

/** How to resolve: forwarders first; iterate from `roots` when allowed; cache answers up to `maxTtl` seconds. */
export interface ResolvePlan {
  readonly forwarders: readonly number[];
  readonly iterate?: boolean;
  readonly roots?: readonly number[];
  readonly maxTtl?: number;
}

export interface CacheEntry {
  readonly name: string;
  readonly type: string;
  readonly what: string;
  readonly ttl: number;
}

interface Pending {
  readonly client: number;
  readonly port: number;
  readonly query: DnsMessage;
  readonly plan: ResolvePlan;
  phase: 'forward' | 'iterate';
  /** Zone whose servers are being asked ('' = root) and the server asked last. */
  zone: string;
  server: number;
  /** The cached delegation was tried and failed: start again from the root. */
  retried: boolean;
  servers: readonly number[];
  index: number;
  qname: string;
  prefix: readonly DnsAnswer[];
  steps: number;
  done: boolean;
}

/** Whether `client` may use recursion (localnets = same subnet as the server, or the server itself). */
export function recursionAllowed(allow: AllowRecursion, client: number, local: { ip?: number; prefix?: number }): boolean {
  if (allow === 'any') return true;
  if (local.ip === undefined || local.prefix === undefined) return false;
  return client === local.ip || (client >>> 24) === 127 || inSubnet(client, local.ip, local.prefix);
}

const keyOf = (name: string, type: string): string => `${normalizeName(name)}/${type}`;

export class DnsForwarder {
  private readonly env: ForwarderEnv;
  private readonly pending = new Map<number, Pending>();
  private readonly cache = new Map<string, { msg: DnsMessage; expires: number }>();
  private readonly delegations = new Map<string, { servers: readonly number[]; expires: number }>();
  private nextPort = 0;

  constructor(env: ForwarderEnv) {
    this.env = env;
  }

  flush(): void {
    this.cache.clear();
    this.delegations.clear();
  }

  cacheSize(): number {
    return this.cache.size + this.delegations.size;
  }

  /** What the cache holds now (answers and known delegations) with the seconds each has left. */
  entries(): CacheEntry[] {
    const now = this.env.now();
    const left = (expires: number): number => Math.max(0, Math.ceil((expires - now) / 1000));
    const answers = [...this.cache.values()].filter((e) => e.expires > now).map((e) => ({
      name: e.msg.qname, type: e.msg.qtype, ttl: left(e.expires),
      what: e.msg.rcode === 'NOERROR' ? (e.msg.answers ?? []).map((a) => `${a.type} ${a.data}`).join(', ') || 'NODATA' : e.msg.rcode ?? '',
    }));
    const zones = [...this.delegations.entries()].filter(([, d]) => d.expires > now).map(([zone, d]) => ({ name: zone, type: 'NS', ttl: left(d.expires), what: d.servers.map(formatIp).join(', ') }));
    return [...answers, ...zones];
  }

  /** Resolves `q` for the client (a list of servers is the forwarders-only plan of the ISP relay). */
  resolve(q: DnsMessage, client: number, port: number, plan: ResolvePlan | readonly number[]): void {
    const p: ResolvePlan = Array.isArray(plan) ? { forwarders: plan } : (plan as ResolvePlan);
    const hit = this.cache.get(keyOf(q.qname, q.qtype));
    if (hit && hit.expires > this.env.now()) {
      this.env.reply(client, port, { ...hit.msg, id: q.id, ra: true, rd: q.rd, authoritative: false });
      return;
    }
    if ((!p.forwarders.length && !p.iterate) || this.pending.size >= MAX_PENDING) return this.fail(client, port, q);
    const job: Pending = { client, port, query: q, plan: p, phase: 'forward', zone: '', server: 0, retried: false, servers: p.forwarders, index: 0, qname: normalizeName(q.qname), prefix: [], steps: 0, done: false };
    if (!p.forwarders.length) this.startIteration(job);
    else this.ask(job);
  }

  private fail(client: number, port: number, q: DnsMessage): void {
    this.env.reply(client, port, { id: q.id, response: true, qname: q.qname, qtype: q.qtype, rcode: 'SERVFAIL', answers: [], ra: true, rd: q.rd });
  }

  private startIteration(p: Pending): void {
    const from = closestServers(p.qname, this.delegations, this.env.now(), p.plan.roots ?? []);
    p.phase = 'iterate';
    p.zone = from.zone === '.' ? '' : from.zone;
    p.servers = from.servers.slice(0, TRIES_PER_ZONE);
    p.index = 0;
    this.env.log(`resolving ${p.qname}/${p.query.qtype}: iterative, starting at ${from.zone === '.' ? 'the root servers' : `${from.zone} (cached)`}`);
    this.ask(p);
  }

  private ask(p: Pending): void {
    const server = p.servers[p.index];
    if (server === undefined || p.steps >= MAX_STEPS) {
      if (p.phase === 'forward' && p.plan.iterate) return this.startIteration(p);
      if (p.phase === 'iterate' && p.zone !== '' && !p.retried && this.delegations.has(p.zone) && p.steps < MAX_STEPS) {
        // The servers of a cached delegation do not answer: forget it and go down from the root again.
        this.delegations.delete(p.zone);
        p.retried = true;
        return this.startIteration(p);
      }
      this.env.log(`client query ${p.query.qname}/${p.query.qtype}: ${p.phase === 'forward' ? 'all forwarders' : 'all servers'} failed (SERVFAIL)`);
      return this.fail(p.client, p.port, p.query);
    }
    p.steps += 1;
    p.server = server;
    const sport = FIRST_PORT + (this.nextPort++ % PORTS);
    this.pending.set(sport, p);
    this.env.send(server, sport, { ...p.query, qname: p.qname, id: sport, rd: p.phase === 'forward' });
    this.env.schedule(FORWARD_TIMEOUT_MS, () => {
      if (p.done || this.pending.get(sport) !== p) return;
      this.pending.delete(sport);
      p.index += 1;
      this.ask(p);
    });
  }

  /** An upstream answer from `from` arriving on `port`; false when it is not the answer to one of our questions. */
  onResponse(port: number, answer: DnsMessage, from?: number): boolean {
    const p = this.pending.get(port);
    if (!p || (from !== undefined && from !== p.server) || normalizeName(answer.qname) !== p.qname || answer.qtype !== p.query.qtype) return false;
    this.pending.delete(port);
    const failed = answer.rcode !== 'NOERROR' && answer.rcode !== 'NXDOMAIN';
    // forward first: a forwarder that refuses or fails is like one that does not answer.
    if (p.phase === 'forward' && failed && p.plan.iterate) { p.index += 1; this.ask(p); return true; }
    if (p.phase === 'forward') return this.finish(p, answer);
    const step = iterStep(answer, p.qname, p.query.qtype, p.zone);
    if (step.kind === 'answer') return this.finish(p, answer);
    if (step.kind === 'lame') { p.index += 1; this.ask(p); return true; }
    if (step.kind === 'cname') {
      p.prefix = [...p.prefix, ...step.answers];
      p.qname = step.target;
      this.startIteration(p);
      return true;
    }
    this.remember(step.zone, step.servers, Math.min(step.ttl, p.plan.maxTtl ?? DEFAULT_MAX_TTL));
    this.env.log(`  ${p.qname}: referral to ${step.zone}. (${step.names.slice(0, 2).join(', ')})`);
    p.zone = step.zone;
    p.servers = step.servers.slice(0, TRIES_PER_ZONE);
    p.index = 0;
    this.ask(p);
    return true;
  }

  /** Caches the servers of a zone for `ttl` seconds (also used by tests to plant a stale delegation). */
  remember(zone: string, servers: readonly number[], ttl: number): void {
    if (ttl <= 0) return;
    if (this.delegations.size >= MAX_CACHE) this.delegations.delete(this.delegations.keys().next().value ?? '');
    this.delegations.set(zone, { servers, expires: this.env.now() + ttl * 1000 });
  }

  private finish(p: Pending, answer: DnsMessage): true {
    p.done = true;
    const msg: DnsMessage = { ...answer, id: p.query.id, qname: p.query.qname, qtype: p.query.qtype, answers: [...p.prefix, ...(answer.answers ?? [])], additional: undefined, authoritative: false, ra: true, rd: p.query.rd };
    this.store(msg, p.plan.maxTtl ?? DEFAULT_MAX_TTL);
    this.env.reply(p.client, p.port, msg);
    return true;
  }

  private store(answer: DnsMessage, maxTtl: number): void {
    if (answer.rcode !== 'NOERROR' && answer.rcode !== 'NXDOMAIN') return;
    const ttl = Math.min(maxTtl, ...(answer.answers ?? []).map((a) => a.ttl), answer.answers?.length ? Infinity : NEGATIVE_TTL_S);
    if (ttl <= 0) return;
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value ?? '');
    this.cache.set(keyOf(answer.qname, answer.qtype), { msg: answer, expires: this.env.now() + ttl * 1000 });
  }
}
