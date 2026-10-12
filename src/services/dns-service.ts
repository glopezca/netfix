/** Authoritative DNS server built from a flat list of records (BIND-like answers). */
import type { DnsAnswer, DnsMessage, DnsType } from '../net/packets.ts';
import { normalizeName, ipFromReverse } from '../net/dns.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { validateName } from './dns-names.ts';
import type { DnsRecord } from './config.ts';

const MAX_CNAME_CHAIN = 8;
const SOA_SERIAL = 2026101101;
const NEGATIVE_TTL = 3600;

function toAnswer(r: DnsRecord): DnsAnswer {
  return { name: normalizeName(r.name), type: r.type, ttl: r.ttl, data: r.type === 'A' || r.type === 'TXT' ? r.value : normalizeName(r.value), priority: r.priority };
}

/** Zones this server is authoritative for: NS owners plus the parent domain of every record. */
export function zonesOf(records: readonly DnsRecord[]): string[] {
  const zones = new Set<string>();
  for (const r of records) {
    const name = normalizeName(r.name);
    const labels = name.split('.');
    if (r.type === 'NS') zones.add(name);
    zones.add(labels.length >= 3 ? labels.slice(1).join('.') : name);
  }
  return [...zones];
}

function zoneFor(name: string, zones: readonly string[]): string | undefined {
  return [...zones].sort((a, b) => b.length - a.length).find((z) => name === z || name.endsWith(`.${z}`));
}

function soaFor(zone: string, records: readonly DnsRecord[]): DnsAnswer {
  const ns = records.find((r) => r.type === 'NS' && normalizeName(r.name) === zone);
  const mname = ns ? normalizeName(ns.value) : `ns.${zone}`;
  return { name: zone, type: 'SOA', ttl: NEGATIVE_TTL, data: `${mname} admin.${zone} ${SOA_SERIAL} 604800 86400 2419200 ${NEGATIVE_TTL}` };
}

function ptrAnswers(qname: string, records: readonly DnsRecord[]): DnsAnswer[] {
  const ip = ipFromReverse(qname);
  if (ip === undefined) return [];
  const text = formatIp(ip);
  return records.filter((r) => r.type === 'A' && r.value === text && !r.name.startsWith('*.'))
    .map((r) => ({ name: qname, type: 'PTR' as const, ttl: r.ttl, data: normalizeName(r.name) }));
}

/** A name exists when it owns records or is an ancestor of an owner (empty non-terminal). */
function nodeExists(name: string, records: readonly DnsRecord[]): boolean {
  return records.some((r) => {
    const owner = normalizeName(r.name);
    return owner === name || owner.endsWith(`.${name}`);
  });
}

/**
 * RFC 4592: a name that does not exist is answered from `*.<closest encloser>`, the wildcard
 * directly below its nearest existing ancestor. The records keep the queried name as owner.
 */
function wildcardRecords(name: string, records: readonly DnsRecord[]): DnsRecord[] {
  const labels = name.split('.');
  for (let i = 1; i < labels.length; i++) {
    const encloser = labels.slice(i).join('.');
    if (!nodeExists(encloser, records)) continue;
    return records.filter((r) => normalizeName(r.name) === `*.${encloser}`).map((r) => ({ ...r, name }));
  }
  return [];
}

/** Records owned by `name`, synthesised from a wildcard when the name does not exist. */
function recordsAt(name: string, records: readonly DnsRecord[]): DnsRecord[] {
  const own = records.filter((r) => normalizeName(r.name) === name);
  return own.length > 0 || nodeExists(name, records) ? own : wildcardRecords(name, records);
}

function lookup(qname: string, qtype: DnsType, records: readonly DnsRecord[]): DnsAnswer[] {
  const answers: DnsAnswer[] = [];
  let name = qname;
  for (let i = 0; i < MAX_CNAME_CHAIN; i++) {
    const here = recordsAt(name, records);
    const exact = here.filter((r) => r.type === qtype);
    if (exact.length > 0) return [...answers, ...exact.map(toAnswer)];
    const cname = here.find((r) => r.type === 'CNAME');
    if (!cname || qtype === 'CNAME') return answers;
    answers.push(toAnswer(cname));
    name = normalizeName(cname.value);
  }
  return answers;
}

export function answerQuery(query: DnsMessage, records: readonly DnsRecord[], origin?: string): DnsMessage {
  const qname = normalizeName(query.qname);
  const base = { id: query.id, response: true, qname, qtype: query.qtype };
  if (query.qtype === 'PTR') {
    const ptr = ptrAnswers(qname, records);
    return ptr.length > 0 ? { ...base, rcode: 'NOERROR', authoritative: true, answers: ptr } : { ...base, rcode: 'NXDOMAIN', authoritative: true, answers: [] };
  }
  const zone = zoneFor(qname, origin ? [...zonesOf(records), origin] : zonesOf(records));
  if (!zone) return { ...base, rcode: 'REFUSED', answers: [] };
  const answers = lookup(qname, query.qtype, records);
  const exists = qname === zone || recordsAt(qname, records).length > 0 || nodeExists(qname, records);
  if (answers.length > 0) return { ...base, rcode: 'NOERROR', authoritative: true, answers };
  return { ...base, rcode: exists ? 'NOERROR' : 'NXDOMAIN', authoritative: true, answers: [], authority: [soaFor(zone, records)] };
}

/** Validation used by the GUI. Returns an error message or null. */
export function validateRecord(r: DnsRecord, origin?: string): string | null {
  const nameErr = validateName(r.name, origin);
  if (nameErr) return nameErr;
  if (r.type === 'A' && parseIp(r.value) === null) return 'Un registro A necesita una dirección IPv4.';
  const targetErr = r.type === 'CNAME' || r.type === 'NS' || r.type === 'MX' ? validateName(r.value, origin, false) : null;
  if (targetErr) return `Un registro ${r.type} necesita un nombre de host (relativo, absoluto con punto final o @): ${targetErr}`;
  if (r.type === 'MX' && (r.priority === undefined || r.priority < 0 || r.priority > 65535)) return 'La prioridad MX va de 0 a 65535.';
  return r.value.trim() === '' ? 'El valor no puede estar vacío.' : null;
}
