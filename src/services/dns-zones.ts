/**
 * bind9 zones: SOA and NS first, then forward (A, CNAME, MX, NS, TXT) or reverse (`*.in-addr.arpa`, PTR) records.
 * Every forward zone generates the reverse zones of its A records (one per /24 network, with their PTRs) unless the
 * user has made that reverse zone by hand. Pure functions: the settings are replaced, never changed.
 */
import { t } from '../i18n/t.ts';
import type { DnsRecord, DnsRecordType, DnsSettings, DnsSoa, DnsZone } from './config.ts';
import { DEFAULT_TTL } from './config.ts';
import { cleanOrigin, qualify, validateName } from './dns-names.ts';
import { normalizeName } from '../net/dns.ts';
import { parseIp } from '../core/ip.ts';

const SOA_REFRESH = 604800;
const SOA_RETRY = 86400;
const SOA_EXPIRE = 2419200;
const SOA_MINIMUM = 3600;
const FIRST_SERIAL = 2026102101;
const MAX_TIMER = 2_147_483_647;
const REVERSE = /\.in-addr\.arpa$/;
const FORWARD_TYPES: readonly DnsRecordType[] = ['A', 'CNAME', 'MX', 'NS', 'TXT'];
const REVERSE_TYPES: readonly DnsRecordType[] = ['PTR'];
const TARGET_TYPES: ReadonlySet<DnsRecordType> = new Set(['CNAME', 'MX', 'NS', 'PTR']);
/** Mailbox part: the characters RFC 5322 allows unquoted (and \. for a dot), then a domain. */
const RNAME = /^(?:[a-z0-9!#%&'*+/=?^_`{|}~-]|\\\.)+\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i;
/** A zone name that is safe as part of a file name (/etc/bind/db.<zone>). */
export const SAFE_ZONE = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i;
export const MAX_ZONES = 64;
export const MAX_RECORDS = 500;

/** A zone that bind loads: hand-made, or generated from the A records of forward zones. */
export interface ServedZone {
  readonly zone: DnsZone;
  readonly auto: boolean;
}

export const isReverseZone = (name: string): boolean => REVERSE.test(normalizeName(name));

export const recordTypesFor = (kind: DnsZone['kind']): readonly DnsRecordType[] => (kind === 'reverse' ? REVERSE_TYPES : FORWARD_TYPES);

export function defaultSoa(zone: string, serial = FIRST_SERIAL): DnsSoa {
  const z = normalizeName(zone);
  return { mname: `ns.${z}`, rname: `admin.${z}`, serial, refresh: SOA_REFRESH, retry: SOA_RETRY, expire: SOA_EXPIRE, minimum: SOA_MINIMUM };
}

export function newZone(name: string, kind: DnsZone['kind'] = 'forward', ns: readonly string[] = [], soa?: Partial<DnsSoa>): DnsZone {
  const z = normalizeName(name);
  const servers = ns.map(normalizeName);
  return { name: z, kind, soa: { ...defaultSoa(z), ...(servers[0] ? { mname: servers[0] } : {}), ...soa }, ns: servers, records: [] };
}

/** `ns.aula.lab. admin.aula.lab. 2026102101 604800 86400 2419200 3600` (the SOA as dig prints it). */
export function soaText(s: DnsSoa): string {
  return `${s.mname}. ${s.rname}. ${s.serial} ${s.refresh} ${s.retry} ${s.expire} ${s.minimum}`;
}

/** admin@aula.lab → admin.aula.lab (a dot in the mailbox is escaped: jose\.luis.aula.lab). */
export function emailToRname(mail: string): string {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(mail.trim());
  if (!m) return normalizeName(mail);
  return `${(m[1] ?? '').replace(/\./g, '\\.')}.${normalizeName(m[2] ?? '')}`;
}

export function rnameToEmail(rname: string): string {
  const m = /^((?:[^.\\]|\\.)+)\.(.+)$/.exec(rname);
  return m ? `${(m[1] ?? '').replace(/\\\./g, '.')}@${m[2]}` : rname;
}

/** Serial in the YYYYMMDDnn convention: the next change of the day, or 01 of a new day. */
export function nextSerial(serial: number, ymd: number): number {
  return serial >= ymd * 100 ? serial + 1 : ymd * 100 + 1;
}

/** 192.168.1 / 192.168.1.0 / 192.168.1.0/24 → 1.168.192.in-addr.arpa (null when it is not a network). */
export function reverseZoneName(net: string): string | null {
  const octets = net.trim().replace(/\/\d+$/, '').split('.').slice(0, 3);
  if (octets.length < 3 || parseIp([...octets, '0'].join('.')) === null) return null;
  return `${octets.reverse().join('.')}.in-addr.arpa`;
}

/** The zone's records with absolute owners and targets, plus its NS list at the apex. */
export function zoneRecords(zone: DnsZone): DnsRecord[] {
  const out: DnsRecord[] = zone.ns.map((ns) => ({ name: zone.name, type: 'NS', value: ns, ttl: DEFAULT_TTL }));
  for (const r of zone.records) {
    const name = qualify(r.name, zone.name);
    const value = TARGET_TYPES.has(r.type) ? qualify(r.value, zone.name) : r.value;
    if (name !== null && value !== null) out.push({ ...r, name, value });
  }
  return out;
}

const inZone = (name: string, zone: string): boolean => name === zone || name.endsWith(`.${zone}`);

/** Reverse zones generated from the A records of the forward zones (wildcards have no PTR). */
export function autoReverseZones(zones: readonly DnsZone[]): DnsZone[] {
  // Collected in place and sorted once: thousands of A records stay cheap (this runs on every query).
  const out = new Map<string, { zone: DnsZone; serial: number; ptrs: DnsRecord[] }>();
  for (const z of zones.filter((x) => x.kind === 'forward')) {
    for (const r of zoneRecords(z).filter((x) => x.type === 'A' && !x.name.startsWith('*.') && inZone(x.name, z.name))) {
      const name = reverseZoneName(r.value);
      if (name === null) continue;
      const entry = out.get(name) ?? { zone: newZone(name, 'reverse', z.ns, z.soa), serial: 0, ptrs: [] };
      entry.serial = Math.max(entry.serial, z.soa.serial);
      entry.ptrs.push({ name: r.value.split('.')[3] ?? '', type: 'PTR', value: `${r.name}.`, ttl: r.ttl });
      out.set(name, entry);
    }
  }
  return [...out.values()].map((e) => ({ ...e.zone, soa: { ...e.zone.soa, serial: e.serial }, records: e.ptrs.sort((a, b) => Number(a.name) - Number(b.name)) }));
}

/** The zones bind loads: none when it is not authoritative; a hand-made zone wins over a generated one. */
export function servedZones(dns: Pick<DnsSettings, 'zones' | 'authoritative'>): ServedZone[] {
  if (dns.authoritative === false) return [];
  const own = new Set(dns.zones.map((z) => z.name));
  return [...dns.zones.map((zone) => ({ zone, auto: false })), ...autoReverseZones(dns.zones).filter((z) => !own.has(z.name)).map((zone) => ({ zone, auto: true }))];
}

function validateSoa(s: DnsSoa): string | null {
  if (validateName(`${s.mname}.`, undefined, false)) return t('zone.err.mname', { name: s.mname });
  if (!RNAME.test(s.rname)) return t('zone.err.rname', { value: rnameToEmail(s.rname) });
  const timers = [s.serial, s.refresh, s.retry, s.expire, s.minimum];
  return timers.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_TIMER) ? null : t('zone.err.timer');
}

/** A new or edited zone: valid name for its kind, not repeated, a valid SOA and at least one NS. */
export function validateZone(zone: DnsZone, others: readonly DnsZone[]): string | null {
  const name = cleanOrigin(zone.name);
  if (name === undefined || validateName(`${name}.`, undefined, false)) return t('zone.err.name', { name: zone.name });
  if (others.some((o) => o.name === name)) return t('zone.err.exists', { name });
  if (zone.kind === 'reverse' && !isReverseZone(name)) return t('zone.err.reverseName');
  if (zone.kind === 'forward' && isReverseZone(name)) return t('zone.err.forwardName', { name });
  if (zone.ns.length === 0) return t('zone.err.ns');
  const bad = zone.ns.find((ns) => validateName(`${normalizeName(ns)}.`, undefined, false));
  return bad !== undefined ? t('zone.err.nsName', { name: bad }) : validateSoa(zone.soa);
}

/** Problems named-checkzone would report (shown next to the zone; the zone is still served). */
export function zoneProblems(zone: DnsZone): string[] {
  const records = zoneRecords(zone);
  const kind = t(zone.kind === 'reverse' ? 'zone.kind.reverse' : 'zone.kind.forward');
  const allowed = recordTypesFor(zone.kind);
  const glue = zone.ns.filter((ns) => inZone(ns, zone.name) && !records.some((r) => r.type === 'A' && r.name === ns)).map((ns) => t('zone.chk.glue', { ns }));
  const types = zone.records.filter((r) => !allowed.includes(r.type)).map((r) => t('zone.chk.type', { type: r.type, name: r.name, kind }));
  const owners = records.filter((r) => r.type === 'CNAME').map((r) => r.name);
  const cname = [...new Set(owners.filter((o) => records.some((r) => r.name === o && r.type !== 'CNAME')))].map((name) => t('zone.chk.cname', { name }));
  const out = records.filter((r) => !inZone(r.name, zone.name)).map((r) => t('zone.chk.out', { name: r.name, zone: zone.name }));
  return [...glue, ...types, ...cname, ...out];
}

/** Zone of a legacy absolute name: an NS owner is a zone; otherwise the parent domain (www.aula.lab → aula.lab). */
function legacyZoneOf(r: DnsRecord, nsOwners: ReadonlySet<string> = new Set()): string {
  const labels = r.name.split('.');
  return r.type === 'NS' || nsOwners.has(r.name) || labels.length < 3 ? r.name : labels.slice(1).join('.');
}

/** Name relative to its zone (`@` for the apex), as a zone file would write it. */
const relative = (name: string, zone: string): string => (name === zone ? '@' : name.slice(0, -(zone.length + 1)));

/** Settings of Netfix ≤ 0.11 (one origin and a flat list of records) as zones. */
export function zonesFromLegacy(origin: string | undefined, records: readonly DnsRecord[]): DnsZone[] {
  const o = cleanOrigin(origin);
  const absolute = records.map((r) => ({ typed: r, name: qualify(r.name, o), value: TARGET_TYPES.has(r.type) ? qualify(r.value, o) : r.value }))
    .filter((x): x is { typed: DnsRecord; name: string; value: string } => x.name !== null && x.value !== null);
  const nsOwners = new Set(absolute.filter((x) => x.typed.type === 'NS').map((x) => x.name));
  const zoneOf = (x: { typed: DnsRecord; name: string }): string => legacyZoneOf({ ...x.typed, name: x.name }, nsOwners);
  const names: string[] = o ? [o] : [];
  for (const x of absolute) {
    const owner = o && inZone(x.name, o) ? o : zoneOf(x);
    if (!names.includes(owner)) names.push(owner);
  }
  return names.map((zone) => {
    const mine = absolute.filter((x) => (o && zone === o ? inZone(x.name, o) : !(o && inZone(x.name, o)) && zoneOf(x) === zone));
    const ns = mine.filter((x) => x.typed.type === 'NS' && x.name === zone).map((x) => x.value);
    const rest = mine.filter((x) => !(x.typed.type === 'NS' && x.name === zone));
    const recs = rest.map((x) => (zone === o ? x.typed : { ...x.typed, name: relative(x.name, zone), value: TARGET_TYPES.has(x.typed.type) ? `${x.value}.` : x.value }));
    return { ...newZone(zone, isReverseZone(zone) ? 'reverse' : 'forward', ns.length ? ns : [`ns.${zone}`]), records: recs };
  });
}
