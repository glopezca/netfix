/**
 * NetBIOS over TCP/IP (RFC 1001/1002), as a Windows host has it built in and a GNU/Linux host with samba (nmbd, smbd):
 * names are found by a broadcast query to the subnet on UDP 137 (B-node, so never past a router) and answered by the
 * owner with a unicast reply; a node status request (NBSTAT) asks a host for its name table and MAC. Each host keeps a
 * cache of what it found (nbtstat -c). SMB servers listen on TCP 139 and 445.
 */
import type { Host } from '../devices/host.ts';
import type { IpPacket, NbnsMessage, NbnsName } from './packets.ts';
import type { StackHost } from './ipstack.ts';
import { registerLocalSockets } from './ipstack.ts';
import { hasPackage } from './host-packages.ts';
import { runSync } from './sync.ts';
import { broadcastOf } from '../core/ip.ts';

export const NBNS_PORT = 137;
const SMB_PORTS = [139, 445] as const;
/** Windows asks three times, 750 ms apart. */
const QUERY_MS = 2250;
/** Names stay ten minutes in the cache (NetBT's default). */
export const CACHE_MS = 600_000;
export const WORKGROUP = 'WORKGROUP';
export const WORKSTATION = 0x00;
export const FILE_SERVER = 0x20;
const MAX_NAME = 15;

/** NetBIOS over TCP/IP is on in Windows; on GNU/Linux nmbd (samba) gives it. */
const windows = (h: object): boolean => (h as { readonly os?: string }).os === 'windows';
export const speaksNetbios = (h: object): boolean => windows(h) || hasPackage(h, 'samba');

export const netbiosName = (name: string): string => name.toUpperCase().slice(0, MAX_NAME);

/** A host's own names: NAME<00>, WORKGROUP<00> (group) and NAME<20> (its SMB server). */
export function ownNames(host: Host): NbnsName[] {
  const name = netbiosName(host.runtimeName());
  return [{ name, suffix: WORKSTATION, group: false }, { name: WORKGROUP, suffix: WORKSTATION, group: true }, { name, suffix: FILE_SERVER, group: false }];
}

const waiting = new WeakMap<object, Map<number, (m: NbnsMessage) => void>>();
interface CacheEntry { readonly ip: number; readonly suffix: number; readonly until: number }
const caches = new WeakMap<object, Map<string, CacheEntry>>();
let nextId = 0x8000;

function reply(host: Host, iface: string, p: IpPacket, msg: NbnsMessage): void {
  const own = host.l3Iface(iface)?.addrs[0]?.ip;
  if (own === undefined || !p.udp) return;
  host.sendUdp(p.src, NBNS_PORT, p.udp.sport, { nbns: msg }, own, iface);
}

function answer(host: Host, iface: string, p: IpPacket, q: NbnsMessage): void {
  const own = host.l3Iface(iface)?.addrs[0]?.ip;
  if (own === undefined) return;
  if (q.type === 'NBSTAT') {
    if (p.dst === own) reply(host, iface, p, { ...q, response: true, broadcast: false, names: ownNames(host), mac: host.l3Iface(iface)?.mac ?? '' });
    return;
  }
  const mine = ownNames(host).some((n) => !n.group && n.name === netbiosName(q.name) && n.suffix === q.suffix);
  if (mine) reply(host, iface, p, { ...q, response: true, broadcast: false, addresses: [own] });
}

function take(host: StackHost, iface: string, p: IpPacket): boolean {
  const q = p.udp?.nbns;
  if (!q || p.udp?.dport !== NBNS_PORT) return false;
  if (q.response) {
    const done = waiting.get(host)?.get(q.id);
    if (done) done(q);
    return true;
  }
  if (!speaksNetbios(host)) return false;
  answer(host as Host, iface, p, q);
  return true;
}

let registered = false;

/** NBNS and the SMB ports of a host (topology.ts calls it for every host it adds). */
export function attachNetbios(host: Host): void {
  if (!registered) {
    registered = true;
    registerLocalSockets({ member: () => false, take });
  }
  for (const port of SMB_PORTS) host.tcp.listen(port, () => null, () => speaksNetbios(host));
}

/** Sends a question (to the subnet broadcast, or to one address); `done` gets the first answer or undefined. */
export function nbnsQuery(host: Host, q: Omit<NbnsMessage, 'id' | 'response'>, to: number | undefined, done: (m: NbnsMessage | undefined) => void): void {
  const id = nextId++ & 0xffff || 1;
  const pending = waiting.get(host) ?? new Map<number, (m: NbnsMessage) => void>();
  waiting.set(host, pending);
  let over = false;
  const finish = (m: NbnsMessage | undefined): void => {
    if (over) return;
    over = true;
    pending.delete(id);
    done(m);
  };
  const msg: NbnsMessage = { ...q, id, response: false, name: q.name === '*' ? '*' : netbiosName(q.name) };
  pending.set(id, finish);
  host.hooks.schedule(QUERY_MS, () => finish(undefined));
  for (const i of host.l3Ifaces().filter((x) => x.up && x.addrs.length)) {
    const a = i.addrs[0];
    if (!a) continue;
    host.sendUdp(to ?? broadcastOf(a.ip, a.prefix), NBNS_PORT, NBNS_PORT, { nbns: msg }, a.ip, i.name);
    if (to !== undefined) break;
  }
}

/** nbnsQuery, waiting for the answer. */
export function nbnsAsk(host: Host, q: Omit<NbnsMessage, 'id' | 'response'>, to?: number): NbnsMessage | undefined {
  return runSync<NbnsMessage | undefined>(host.hooks, (done) => nbnsQuery(host, q, to, done), QUERY_MS + 500);
}

function cacheOf(host: Host): Map<string, CacheEntry> {
  const cache = caches.get(host) ?? new Map<string, CacheEntry>();
  caches.set(host, cache);
  return cache;
}

/** The address of NAME<suffix>, asynchronously: the cache first, then a broadcast query (cached when answered). */
export function nbnsLookup(host: Host, name: string, suffix: number, done: (ip: number | undefined) => void): void {
  const key = `${netbiosName(name)}<${suffix}>`;
  const hit = cacheOf(host).get(key);
  if (hit && hit.until > host.clock.now()) {
    done(hit.ip);
    return;
  }
  nbnsQuery(host, { type: 'NB', name, suffix, broadcast: true }, undefined, (r) => {
    const ip = r?.addresses?.[0];
    if (ip !== undefined) cacheOf(host).set(key, { ip, suffix, until: host.clock.now() + CACHE_MS });
    done(ip);
  });
}

/** nbnsLookup, waiting for the answer (what Windows does after DNS). */
export function nbnsResolve(host: Host, name: string, suffix = WORKSTATION): number | undefined {
  return runSync<number | undefined>(host.hooks, (done) => nbnsLookup(host, name, suffix, done), QUERY_MS + 500);
}

export const NBNS_WAIT_MS = QUERY_MS;

/** nbtstat -c: [name, suffix, address, seconds left]. */
export function nbnsCache(host: Host): [string, number, number, number][] {
  const now = host.clock.now();
  return [...(caches.get(host) ?? [])].filter(([, e]) => e.until > now).map(([k, e]) => [k.replace(/<\d+>$/, ''), e.suffix, e.ip, Math.round((e.until - now) / 1000)]);
}

/** nbtstat -R. */
export function purgeNbnsCache(host: Host): void {
  caches.delete(host);
}
