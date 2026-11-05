/**
 * WINS (RFC 1001/1002, the NetBIOS Name Server): nmbd with `wins support = yes` keeps a database of the names its
 * clients register by unicast (so across routers), answers their queries (NAM_ERR when it does not know the name) and
 * drops a name when its owner releases it or its TTL runs out. Normal group names are kept as the broadcast address,
 * as Samba does. Not simulated: name conflicts and their challenge (the last registration wins), wins.dat, replication.
 * Which hosts serve is told from outside (shells/samba-wins.ts, as nmbd starts), so net/ does not read smb.conf.
 */
import type { Host } from '../devices/host.ts';
import type { IpPacket, NbnsMessage, NbnsName, NbnsOpcode } from './packets.ts';
import { nbnsAsk, nbnsQuery, netbiosName, ownNames, reply, speaksNetbios } from './netbios.ts';

/** Samba's «min wins ttl» and «max wins ttl» (6 hours, 6 days): what the server grants. */
export const WINS_MIN_TTL_S = 6 * 3600;
export const WINS_MAX_TTL_S = 6 * 24 * 3600;
/** At most this many names per server (a lab never gets near; a flood is refused with RFS_ERR). */
export const MAX_WINS_RECORDS = 512;
export const NAM_ERR = 3;
export const RFS_ERR = 5;
/** Samba keeps normal (not 1C) group names with this address: ask for one and broadcast. */
const GROUP_ADDRESS = 0xffffffff;

export interface WinsRecord {
  readonly name: string;
  readonly suffix: number;
  readonly group: boolean;
  readonly ips: readonly number[];
  /** Wall-clock ms (host.clock.now()) when the name expires. */
  readonly expires: number;
}

export type WinsOpcode = Exclude<NbnsOpcode, 'query'>;

const servers = new WeakSet<object>();
const databases = new WeakMap<object, Map<string, WinsRecord>>();

const key = (name: string, suffix: number): string => `${netbiosName(name)}<${suffix.toString(16).padStart(2, '0')}>`;

/** nmbd starts as a WINS server (on) or stops being one; the database starts empty either way (no wins.dat). */
export function setWinsServer(host: Host, on: boolean): void {
  databases.delete(host);
  if (on) servers.add(host);
  else servers.delete(host);
}

export const isWinsServer = (host: Host): boolean => servers.has(host) && speaksNetbios(host);

function database(host: Host): Map<string, WinsRecord> {
  const db = databases.get(host) ?? new Map<string, WinsRecord>();
  databases.set(host, db);
  const now = host.clock.now();
  for (const [k, r] of db) if (r.expires <= now) db.delete(k);
  return db;
}

/** The names the server holds now (expired ones are gone), sorted by name. */
export function winsRecords(host: Host): WinsRecord[] {
  if (!isWinsServer(host)) return [];
  return [...database(host).values()].sort((a, b) => key(a.name, a.suffix).localeCompare(key(b.name, b.suffix)));
}

const grantedTtl = (asked: number | undefined): number => Math.min(WINS_MAX_TTL_S, Math.max(WINS_MIN_TTL_S, Math.floor(asked ?? 0)));

/** Registration or refresh: the name now belongs to the address in the request, until its TTL runs out. */
function register(host: Host, q: NbnsMessage, from: number): NbnsMessage {
  const db = database(host);
  const k = key(q.name, q.suffix);
  if (!db.has(k) && db.size >= MAX_WINS_RECORDS) return { ...q, response: true, rcode: RFS_ERR };
  const ttl = grantedTtl(q.ttl);
  const group = q.group === true;
  const ip = q.addresses?.[0] ?? from;
  db.set(k, { name: netbiosName(q.name), suffix: q.suffix, group, ips: [group ? GROUP_ADDRESS : ip], expires: host.clock.now() + ttl * 1000 });
  return { ...q, response: true, ttl, rcode: 0, addresses: [ip] };
}

/** Release: the owner gives the name up (a release of a unique name from another address is ignored). */
function release(host: Host, q: NbnsMessage, from: number): NbnsMessage {
  const db = database(host);
  const k = key(q.name, q.suffix);
  const r = db.get(k);
  if (r && (r.group || r.ips.includes(q.addresses?.[0] ?? from))) db.delete(k);
  return { ...q, response: true, ttl: 0, rcode: r ? 0 : NAM_ERR };
}

/** A query: the server's own unique names, then the database; NAM_ERR when nobody has the name. */
function query(host: Host, iface: string, q: NbnsMessage): NbnsMessage {
  const name = netbiosName(q.name);
  const own = ownNames(host).some((n) => !n.group && n.name === name && n.suffix === q.suffix);
  const ownIp = host.l3Iface(iface)?.addrs[0]?.ip;
  if (own && ownIp !== undefined) return { ...q, response: true, ttl: WINS_MAX_TTL_S, rcode: 0, addresses: [ownIp] };
  const r = database(host).get(key(name, q.suffix));
  if (!r) return { ...q, response: true, rcode: NAM_ERR, addresses: [] };
  const ttl = Math.max(0, Math.round((r.expires - host.clock.now()) / 1000));
  return { ...q, response: true, ttl, rcode: 0, addresses: r.ips };
}

/** The WINS side of netbios.ts: unicast queries, registrations, refreshes and releases sent to this server. */
export function winsTake(host: Host, iface: string, p: IpPacket, q: NbnsMessage): boolean {
  if (!isWinsServer(host) || q.type !== 'NB') return false;
  const op = q.opcode ?? 'query';
  // A query without recursion desired is an ordinary one: the host answers it for its own names (netbios.ts).
  if (op === 'query' && (q.broadcast || q.rd !== true)) return false;
  const answer = op === 'query' ? query(host, iface, q) : op === 'release' ? release(host, q, p.src) : register(host, q, p.src);
  reply(host, iface, p, { ...answer, broadcast: false });
  return true;
}

/** The address a client puts in what it registers: that of its first interface with one (where nbnsQuery sends from). */
const clientAddress = (host: Host): number | undefined => host.l3Ifaces().find((i) => i.up && i.addrs.length > 0)?.addrs[0]?.ip;

/** Sends one registration, refresh or release of a name to the server; `done` gets the answer (or undefined). */
export function winsSend(host: Host, server: number, op: WinsOpcode, n: NbnsName, ttlS: number, done: (m: NbnsMessage | undefined) => void = () => undefined): void {
  const ip = clientAddress(host);
  if (ip === undefined) return done(undefined);
  nbnsQuery(host, { type: 'NB', name: n.name, suffix: n.suffix, broadcast: false, opcode: op, rd: true, group: n.group, ttl: ttlS, addresses: [ip] }, server, done);
}

/** The host's own names (NAME<00>, WORKGROUP<00>, NAME<20>) registered, refreshed or released with the server. */
export function winsSendAll(host: Host, server: number, op: WinsOpcode, ttlS: number): void {
  for (const n of ownNames(host)) winsSend(host, server, op, n, ttlS);
}

/** A unicast query to the WINS server, waiting for its answer (undefined: it did not answer). */
export function winsAsk(host: Host, server: number, name: string, suffix: number): NbnsMessage | undefined {
  return nbnsAsk(host, { type: 'NB', name, suffix, broadcast: false, rd: true }, server);
}
