/**
 * Los archivos de BIND editados desde la consola (named.conf.local, named.conf.options y las zonas db.*), ya
 * comprobados como los carga named, al modelo DNS de Netfix: una zona por cada zona primaria declarada, con su SOA,
 * sus NS y los registros que el modelo conoce. Una zona que no cargó queda sin cargar al arrancar (responde SERVFAIL) y
 * conserva la versión que tenía en una recarga, como named. Los límites son los de persist.ts: lo que entra aquí lo
 * escribió un usuario y se guarda con el laboratorio.
 */
import type { DnsRecord, DnsSettings, DnsZone } from './config.ts';
import { MAX_RECORDS, MAX_ZONES, SAFE_ZONE, isReverseZone, recordTypesFor, servedZones, validateZone } from './dns-zones.ts';
import { validateRecord } from './dns-service.ts';
import { normalizeName } from '../net/dns.ts';
import { absolute, inZone } from './zone-parse.ts';
import type { ZoneRecord } from './zone-parse.ts';
import { parseNamedOptions } from './named-options.ts';
import { RPZ_ZONE, setPublicNames } from './dns-rpz.ts';
import type { ListenChoice } from './listen.ts';

/** A primary zone declared in named.conf, after named tried to load it. */
export interface ZoneResult {
  readonly name: string;
  readonly ok: boolean;
  readonly records: readonly ZoneRecord[];
  /** Its file is still the one Netfix generates from the model. */
  readonly generated: boolean;
}

export interface BindRead {
  readonly zones: readonly ZoneResult[];
  /** named.conf.options, when it was edited. */
  readonly options?: string;
  /** The policy zone's file, when it was edited. */
  readonly rpz?: string;
}

/** Ubuntu's own zones (named.conf.default-zones) and the policy zone: none is a zone of the model. */
const NOT_MODEL = new Set(['localhost', '127.in-addr.arpa', '0.in-addr.arpa', '255.in-addr.arpa', '', RPZ_ZONE]);
const MAX_NAME = 253;
const MAX_VALUE = 1024;
const MAX_TTL = 2_147_483_647;
const MAX_U16 = 65_535;

const strip = (name: string): string => name.replace(/\.$/, '');
/** A TXT string as the model keeps it: without its quotes and with \" and \\ as the characters. */
const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\([\\"])/g, '$1') : s);

/** The record as the zone file of the model writes it: owner relative to the zone (`@` the apex), targets absolute. */
function recordOf(r: ZoneRecord, apex: string): DnsRecord | undefined {
  const name = r.owner === apex ? '@' : inZone(r.owner, apex) ? r.owner.slice(0, -(apex.length + 1)) : r.owner;
  const base = { name, type: r.type as DnsRecord['type'], ttl: r.ttl };
  if (r.type === 'MX') {
    const priority = Number(r.data[0]);
    return Number.isInteger(priority) && priority >= 0 && priority <= MAX_U16 ? { ...base, value: r.data[1] ?? '', priority } : undefined;
  }
  const value = r.type === 'TXT' ? r.data.map(unquote).join('') : r.data[0] ?? '';
  return { ...base, value };
}

const fits = (r: DnsRecord, zone: string): boolean =>
  r.name.length <= MAX_NAME && r.value.length <= MAX_VALUE && r.ttl >= 0 && r.ttl <= MAX_TTL && validateRecord(r, zone) === null;

/** The loaded zone as a zone of the model, or undefined when the model cannot hold it (name, SOA, no NS). */
export function zoneFromRecords(name: string, records: readonly ZoneRecord[]): DnsZone | undefined {
  const zone = normalizeName(name);
  if (!SAFE_ZONE.test(zone)) return undefined;
  const apex = absolute(zone);
  const soa = records.find((r) => r.owner === apex && r.type === 'SOA')?.data;
  if (!soa) return undefined;
  const kind = isReverseZone(zone) ? 'reverse' : 'forward';
  const allowed: readonly string[] = recordTypesFor(kind);
  const atApex = (r: ZoneRecord): boolean => r.owner === apex && (r.type === 'SOA' || r.type === 'NS');
  const ns = [...new Set(records.filter((r) => r.owner === apex && r.type === 'NS').map((r) => strip(r.data[0] ?? '')))].slice(0, MAX_RECORDS);
  const own = records.filter((r) => !atApex(r) && allowed.includes(r.type));
  const recs = own.flatMap((r) => recordOf(r, apex) ?? []).filter((r) => fits(r, zone)).slice(0, MAX_RECORDS);
  const [mname = '', rname = '', ...timers] = soa;
  const [serial = -1, refresh = -1, retry = -1, expire = -1, minimum = -1] = timers.map(Number);
  const z: DnsZone = { name: zone, kind, ns, records: recs, soa: { mname: strip(mname), rname: strip(rname), serial, refresh, retry, expire, minimum } };
  return z.soa.rname.length <= MAX_NAME && validateZone(z, []) === null ? z : undefined;
}

interface Taken { readonly zone?: DnsZone; readonly unloaded: boolean }

/** What named keeps of one declared zone: start leaves a failed one unloaded; reload keeps the version it served. */
function take(r: ZoneResult, current: DnsSettings, mode: 'start' | 'reload', autos: ReadonlySet<string>): Taken {
  const name = normalizeName(r.name);
  const old = current.zones.find((z) => z.name === name);
  if (!r.ok) {
    const served = mode === 'reload' && old !== undefined && !(current.unloaded ?? []).includes(name);
    return { ...(old ? { zone: old } : {}), unloaded: !served };
  }
  // A generated file says what the model already holds; an automatic reverse zone stays automatic.
  if (r.generated && (old || autos.has(name))) return { ...(old ? { zone: old } : {}), unloaded: false };
  const zone = zoneFromRecords(name, r.records) ?? old;
  return { ...(zone ? { zone } : {}), unloaded: false };
}

/** The policy zone: its list from the edited file once it loaded; not applied while it is unloaded. */
function policy(s: DnsSettings, read: BindRead, mode: 'start' | 'reload', before: DnsSettings): { s: DnsSettings; unloaded: boolean } {
  const r = read.zones.find((z) => normalizeName(z.name) === RPZ_ZONE);
  if (r && !r.ok) return { s, unloaded: mode === 'start' || (before.unloaded ?? []).includes(RPZ_ZONE) };
  if (!r || read.rpz === undefined) return { s, unloaded: false };
  const next = setPublicNames(s, s.publicNames?.enabled === true, read.rpz);
  return { s: 'error' in next ? s : next, unloaded: false };
}

/** The DNS settings the checked BIND files describe. */
export function importBind(current: DnsSettings, read: BindRead, mode: 'start' | 'reload', choices: readonly ListenChoice[] = []): DnsSettings {
  const { authoritative: _a, unloaded: _u, ...rest } = current;
  const parsed = read.options === undefined ? undefined : parseNamedOptions(read.options, rest, choices);
  const opts = parsed === undefined || 'error' in parsed ? rest : parsed;
  const pol = policy(opts, read, mode, current);
  const declared = read.zones.filter((z) => !NOT_MODEL.has(normalizeName(z.name)));
  const autos = new Set(servedZones(current).filter((z) => z.auto).map((z) => z.zone.name));
  const zones: DnsZone[] = [];
  const unloaded = new Set<string>(pol.unloaded ? [RPZ_ZONE] : []);
  for (const r of declared) {
    const got = take(r, current, mode, autos);
    if (got.unloaded) unloaded.add(normalizeName(r.name));
    if (got.zone && zones.length < MAX_ZONES && validateZone(got.zone, zones) === null) zones.push(got.zone);
  }
  // No zone declared: named serves none; the model keeps its zones (the "authoritative" switch off).
  const base = declared.length === 0 ? { ...pol.s, zones: current.zones, authoritative: false } : { ...pol.s, zones };
  return unloaded.size > 0 ? { ...base, unloaded: [...unloaded] } : base;
}
