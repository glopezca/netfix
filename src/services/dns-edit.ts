/**
 * Editing bind9 by operating mode and the zone wizard (SOA → NS → kind → records). Shared by the Services tab and
 * the web GUI so both validate alike. Every function returns new settings or a translated error.
 */
import { t } from '../i18n/t.ts';
import type { DnsRecord, DnsSettings, DnsZone } from './config.ts';
import { applyRecursion } from './dns-recursion.ts';
import { DEFAULT_MAX_CACHE_TTL, iterates } from './named-options.ts';
import { MAX_RECORDS, MAX_ZONES, emailToRname, isReverseZone, newZone, nextSerial, recordTypesFor, reverseZoneName, validateZone } from './dns-zones.ts';
import { validateRecord } from './dns-service.ts';
import { validateName } from './dns-names.ts';
import { normalizeName } from '../net/dns.ts';

const MAX_TTL = 2_147_483_647;
const MAX_NS = 8;

export type Edited = DnsSettings | { readonly error: string };

export type DnsMode = 'cache' | 'forwarder' | 'authoritative' | 'iterative' | 'recursive';

/** The order of the mode blocks everywhere: Services tab, web GUI and documentation (iterative after recursive: it depends on it). */
export const DNS_MODES: readonly DnsMode[] = ['cache', 'forwarder', 'authoritative', 'recursive', 'iterative'];

/** What each mode looks like in named.conf. */
export const MODE_DIRECTIVES: Readonly<Record<DnsMode, string>> = {
  cache: 'max-cache-ttl', forwarder: 'forwarders { … };', authoritative: 'zone "…" { type master; };',
  iterative: 'forward first | only; zone "." { type hint; };', recursive: 'recursion yes | no; allow-recursion { … };',
};

export interface ModeState {
  readonly on: boolean;
  /** Why the switch cannot be changed (iterative mode follows recursion and forwarding). */
  readonly locked?: string;
}

export interface DnsModes {
  readonly cache: ModeState;
  readonly forwarder: ModeState;
  readonly authoritative: ModeState;
  readonly iterative: ModeState;
  readonly recursive: ModeState;
}

/** The zone wizard as typed: step 1 (SOA), step 2 (NS), step 3 (kind). */
export interface ZoneDraft {
  readonly name: string;
  readonly mname: string;
  readonly email: string;
  readonly refresh: string;
  readonly retry: string;
  readonly expire: string;
  readonly minimum: string;
  readonly ns: string;
  readonly kind: DnsZone['kind'];
}

export function dnsModes(s: DnsSettings): DnsModes {
  const recursion = s.recursion === true;
  const forwarders = (s.forwarders ?? []).length > 0;
  const locked = !recursion ? t('dnsm.lock.needsRecursion') : !forwarders ? t('dnsm.lock.noForwarders') : undefined;
  return {
    cache: { on: (s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL) > 0 },
    forwarder: { on: forwarders },
    authoritative: { on: s.authoritative !== false },
    iterative: { on: iterates(s), ...(locked ? { locked } : {}) },
    recursive: { on: recursion },
  };
}

/** YYYYMMDD of a simulated instant (UTC), for SOA serials. */
export function ymdOf(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function setCache(s: DnsSettings, on: boolean, ttlText?: string): Edited {
  if (!on) return { ...s, maxCacheTtl: 0 };
  const text = (ttlText ?? '').trim();
  const ttl = text === '' ? ((s.maxCacheTtl ?? 0) > 0 ? s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL : DEFAULT_MAX_CACHE_TTL) : Number(text);
  return Number.isInteger(ttl) && ttl > 0 && ttl <= MAX_TTL ? { ...s, maxCacheTtl: ttl } : { error: t('dnsm.err.ttl') };
}

export function setForwarders(s: DnsSettings, text: string): Edited {
  return applyRecursion(s, { forwarders: text, forwardOnly: s.forwardOnly !== false, allowRecursion: s.allowRecursion ?? 'localnets' });
}

/** Iterative on = `forward first` (only when there are forwarders: otherwise it follows recursion). */
export function setIterative(s: DnsSettings, on: boolean): Edited {
  const locked = dnsModes(s).iterative.locked;
  return locked ? { error: locked } : { ...s, forwardOnly: !on };
}

export const setRecursion = (s: DnsSettings, on: boolean, allow: 'localnets' | 'any'): Edited => ({ ...s, recursion: on, allowRecursion: allow });

export const setAuthoritative = (s: DnsSettings, on: boolean): Edited => ({ ...s, authoritative: on });

const nsList = (text: string): string[] => [...new Set(text.split(/[\s,;]+/).map(normalizeName).filter(Boolean))];

/** Name of the zone in the draft (a network typed for a reverse zone becomes its in-addr.arpa name). */
function draftName(d: ZoneDraft): string {
  const name = normalizeName(d.name);
  return d.kind === 'reverse' && !isReverseZone(name) ? reverseZoneName(name) ?? name : name;
}

function draftZone(d: ZoneDraft, ymd: number): DnsZone {
  const name = draftName(d);
  const timer = (x: string): number => (/^\d+$/.test(x.trim()) ? Number(x) : -1);
  const soa = { mname: normalizeName(d.mname), rname: emailToRname(d.email), serial: ymd * 100 + 1, refresh: timer(d.refresh), retry: timer(d.retry), expire: timer(d.expire), minimum: timer(d.minimum) };
  return { ...newZone(name, d.kind, nsList(d.ns).slice(0, MAX_NS)), soa };
}

/** The error of a wizard step (1 SOA, 2 NS, 3 kind and the whole zone), or null to go on. */
export function draftStep(d: ZoneDraft, step: 1 | 2 | 3, others: readonly DnsZone[] = []): string | null {
  const z = draftZone(d, 0);
  const soaOnly = validateZone({ ...z, kind: isReverseZone(z.name) ? 'reverse' : 'forward', ns: ['ns.invalid'] }, others);
  if (step === 1) return reverseZoneName(d.name) !== null && /^[\d./]+$/.test(d.name.trim()) ? null : validateName(`${normalizeName(d.name)}.`, undefined, false) ? t('zone.err.name', { name: d.name }) : soaOnly;
  if (step === 2) return nsList(d.ns).length === 0 ? t('zone.err.ns') : validateZone({ ...z, kind: isReverseZone(z.name) ? 'reverse' : 'forward' }, others);
  return validateZone(z, others);
}

export function addZone(s: DnsSettings, d: ZoneDraft, ymd: number): Edited {
  if (s.zones.length >= MAX_ZONES) return { error: t('dnsm.err.maxZones', { max: MAX_ZONES }) };
  const err = draftStep(d, 3, s.zones);
  return err ? { error: err } : { ...s, zones: [...s.zones, draftZone(d, ymd)] };
}

export const removeZone = (s: DnsSettings, name: string): Edited => ({ ...s, zones: s.zones.filter((z) => z.name !== name) });

/** Replaces a zone through `change`, raising its SOA serial (YYYYMMDDnn). */
function withZone(s: DnsSettings, name: string, ymd: number, change: (z: DnsZone) => DnsZone | string): Edited {
  const zone = s.zones.find((z) => z.name === name);
  if (!zone) return { error: t('dnsm.err.noZone', { name }) };
  const next = change(zone);
  if (typeof next === 'string') return { error: next };
  const bumped = { ...next, soa: { ...next.soa, serial: nextSerial(zone.soa.serial, ymd) } };
  return { ...s, zones: s.zones.map((z) => (z.name === name ? bumped : z)) };
}

export function addRecord(s: DnsSettings, zoneName: string, rec: DnsRecord, ymd: number): Edited {
  return withZone(s, zoneName, ymd, (z) => {
    if (z.records.length >= MAX_RECORDS) return t('dnsm.err.maxRecords', { max: MAX_RECORDS });
    if (!recordTypesFor(z.kind).includes(rec.type)) return t('zone.err.type', { kind: t(z.kind === 'reverse' ? 'zone.kind.reverse' : 'zone.kind.forward'), type: rec.type });
    return validateRecord(rec, z.name) ?? { ...z, records: [...z.records, rec] };
  });
}

export const removeRecord = (s: DnsSettings, zoneName: string, index: number, ymd: number): Edited =>
  withZone(s, zoneName, ymd, (z) => (Number.isInteger(index) && index >= 0 && index < z.records.length ? { ...z, records: z.records.filter((_, i) => i !== index) } : t('dnsm.err.noRecord')));

export function setZoneNs(s: DnsSettings, zoneName: string, text: string, ymd: number): Edited {
  return withZone(s, zoneName, ymd, (z) => {
    const next = { ...z, ns: nsList(text).slice(0, MAX_NS) };
    return validateZone(next, s.zones.filter((o) => o.name !== zoneName)) ?? next;
  });
}
