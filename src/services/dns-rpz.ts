/**
 * «Nombres públicos» of the DNS service: a BIND response policy zone (RPZ) with local data. The file
 * /etc/bind/db.rpz.publicos has one «name [ttl] [IN] A address» per line (`*.domain` covers the names below it); with
 * `response-policy { zone "rpz.publicos"; };` the server answers those names in recursive queries itself, without
 * asking anybody. Undefined entries are the initial list (src/net/public-names.ts and the names the emulated
 * Internet already knew), so a topology only saves a list that was changed.
 */
import type { DnsAnswer, DnsMessage } from '../net/packets.ts';
import type { DnsSettings } from './config.ts';
import { publicRecords } from '../net/internet-zones.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export interface RpzEntry {
  readonly name: string;
  readonly ip: number;
  readonly ttl: number;
}

export interface PublicNames {
  readonly enabled: boolean;
  /** undefined = the initial list. */
  readonly entries?: readonly RpzEntry[];
}

export const RPZ_ZONE = 'rpz.publicos';
export const RPZ_FILE = '/etc/bind/db.rpz.publicos';
export const MAX_RPZ_ENTRIES = 2000;
const MAX_RPZ_TEXT = 256 * 1024;
const RPZ_TTL = 300;
const MAX_TTL = 2_147_483_647;
const MAX_NAME = 253;
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const RPZ_NAME = new RegExp(`^(?:\\*\\.)?(?:${LABEL}\\.)*${LABEL}$`);

export const validRpzName = (name: string): boolean => name.length <= MAX_NAME && RPZ_NAME.test(name);

let initial: readonly RpzEntry[] | undefined;

/** The initial list: every public name of the emulated Internet with its address. */
export function initialEntries(): readonly RpzEntry[] {
  initial ??= publicRecords().map((r) => ({ name: r.name, ip: parseIp(r.value) ?? 0, ttl: RPZ_TTL }));
  return initial;
}

export const rpzEntries = (s: DnsSettings): readonly RpzEntry[] => s.publicNames?.entries ?? initialEntries();

export function rpzFile(s: DnsSettings): string {
  const lines = rpzEntries(s).map((e) => `${e.name.padEnd(28)} ${e.ttl === RPZ_TTL ? '' : `${e.ttl} `}A ${formatIp(e.ip)}`);
  return [
    '; Nombres públicos (Netfix: Servicios → DNS → Nombres públicos)',
    '; Zona de política de respuesta (RPZ) con datos locales: cada línea «nombre A dirección» es la respuesta que da',
    '; este servidor a ese nombre en las consultas recursivas, sin preguntar a nadie. «*.dominio» cubre los nombres',
    '; que hay debajo. Se usa con response-policy { zone "rpz.publicos"; }; en named.conf.options.',
    `$TTL ${RPZ_TTL}`,
    '@ IN SOA localhost. root.localhost. ( 1 3600 900 604800 300 )',
    '  IN NS  localhost.',
    ...lines,
    '',
  ].join('\n');
}

const fail = (n: number, what: string): { error: string } => ({ error: `dns_rdata_fromtext: ${RPZ_FILE}:${n}: ${what}` });

/** A token of the file as it goes into a message: short and without control characters. */
const shown = (token: string | undefined): string => (token ?? '').slice(0, 64).replace(/[\x00-\x1f\x7f]/g, '?');

/** One record line → entry, null for lines that are not data (SOA, NS, $TTL), or an error. */
function parseLine(tokens: readonly string[], n: number): RpzEntry | null | { error: string } {
  const [owner = ''] = tokens;
  if (owner.startsWith('$') || owner === '@' || tokens.includes('NS') || tokens.includes('SOA')) return null;
  let i = 1;
  const ttl = /^\d+$/.test(tokens[i] ?? '') ? Number(tokens[i++]) : RPZ_TTL;
  if (tokens[i]?.toUpperCase() === 'IN') i++;
  if (tokens[i]?.toUpperCase() !== 'A') return fail(n, `near '${shown(tokens[i])}': only A records are supported here`);
  const name = owner.toLowerCase().replace(new RegExp(`\\.${RPZ_ZONE.replace('.', '\\.')}\\.$`), '');
  if (!validRpzName(name)) return fail(n, `near '${shown(owner)}': bad owner name`);
  const addr = parseIp(tokens[i + 1] ?? '');
  if (addr === null) return fail(n, `near '${shown(tokens[i + 1])}': bad dotted quad`);
  if (ttl > MAX_TTL) return fail(n, 'TTL out of range');
  return { name, ip: addr, ttl };
}

/** The entries of an RPZ file; comments and parenthesised continuations (the SOA) are skipped. */
export function parseRpz(text: string): readonly RpzEntry[] | { error: string } {
  if (text.length > MAX_RPZ_TEXT) return { error: `${RPZ_FILE}: file too large` };
  const entries: RpzEntry[] = [];
  let open = false;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/;.*$/, '');
    const wasOpen = open;
    open = (open || line.includes('(')) && !line.includes(')');
    if (wasOpen || line.trim() === '') continue;
    const r = parseLine(line.trim().split(/\s+/), index + 1);
    if (r === null) continue;
    if ('error' in r) return r;
    // The same record twice is one record (as BIND loads it).
    if (entries.some((e) => e.name === r.name && e.ip === r.ip)) continue;
    if (entries.length >= MAX_RPZ_ENTRIES) return { error: `${RPZ_FILE}: too many records (${MAX_RPZ_ENTRIES} at most)` };
    entries.push(r);
  }
  return entries;
}

/** Turns the list on or off; `list` keeps the entries, puts the initial list back, or reads a file. */
export function setPublicNames(s: DnsSettings, enabled: boolean, list: 'keep' | 'initial' | string = 'keep'): DnsSettings | { error: string } {
  if (list === 'keep') return { ...s, publicNames: { ...s.publicNames, enabled } };
  if (list === 'initial') return { ...s, publicNames: { enabled } };
  const entries = parseRpz(list);
  if ('error' in entries) return entries;
  // The initial list sent back unchanged stays implicit, so names added in later versions still reach it.
  return sameEntries(entries, initialEntries()) ? { ...s, publicNames: { enabled } } : { ...s, publicNames: { enabled, entries } };
}

function sameEntries(a: readonly RpzEntry[], b: readonly RpzEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.name === b[i]?.name && e.ip === b[i]?.ip && e.ttl === b[i]?.ttl);
}

/** The entries that answer `qname`: the exact name, or the longest `*.domain` above it. */
function matching(entries: readonly RpzEntry[], qname: string): { via: string; hits: RpzEntry[] } | undefined {
  const exact = entries.filter((e) => e.name === qname);
  if (exact.length) return { via: qname, hits: exact };
  const wild = entries.filter((e) => e.name.startsWith('*.') && qname.endsWith(e.name.slice(1)));
  const longest = Math.max(...wild.map((e) => e.name.length));
  const hits = wild.filter((e) => e.name.length === longest);
  return hits.length ? { via: hits[0]?.name ?? qname, hits } : undefined;
}

/** The rewritten answer for a recursive query, with the name of the policy record (for the log). */
export function rpzAnswer(s: DnsSettings, q: DnsMessage, qname: string): { msg: DnsMessage; via: string } | undefined {
  if (s.publicNames?.enabled !== true) return undefined;
  const m = matching(rpzEntries(s), qname);
  if (!m) return undefined;
  const answers: DnsAnswer[] = q.qtype === 'A' ? m.hits.map((e) => ({ name: qname, type: 'A', ttl: e.ttl, data: formatIp(e.ip) })) : [];
  return { msg: { id: q.id, response: true, qname, qtype: q.qtype, rcode: 'NOERROR', answers, authoritative: false, rd: q.rd, ra: true }, via: `${m.via}.${RPZ_ZONE}` };
}

/** Saved form: the switch and, only when changed, the list (addresses as text). */
export function publicNamesToJson(p: PublicNames | undefined): unknown {
  if (!p) return undefined;
  return { enabled: p.enabled, ...(p.entries ? { entries: p.entries.map((e) => ({ name: e.name, ip: formatIp(e.ip), ttl: e.ttl })) } : {}) };
}

/** A saved list is validated as a file would be: names, addresses, TTLs and how many. */
export function publicNamesFromJson(v: unknown, error: string): PublicNames {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(error);
  const o = v as Record<string, unknown>;
  if (o.entries === undefined) return { enabled: o.enabled === true };
  if (!Array.isArray(o.entries) || o.entries.length > MAX_RPZ_ENTRIES) throw new Error(error);
  const entries = o.entries.map((x): RpzEntry => {
    const e = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    const addr = typeof e.ip === 'string' ? parseIp(e.ip) : null;
    const ttl = e.ttl === undefined ? RPZ_TTL : typeof e.ttl === 'number' ? e.ttl : NaN;
    if (typeof e.name !== 'string' || !validRpzName(e.name) || addr === null || !Number.isInteger(ttl) || ttl < 0 || ttl > MAX_TTL) throw new Error(error);
    return { name: e.name, ip: addr, ttl };
  });
  return { enabled: o.enabled === true, entries };
}
