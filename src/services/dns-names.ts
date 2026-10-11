/**
 * Zone-file name rules (BIND): `@` is the origin, a name ending in "." is absolute, any other
 * name is relative and gets the origin appended. Without an origin (files from netsim ≤ 0.2)
 * every name is taken as absolute.
 */
import type { DnsRecord } from './config.ts';

const LABEL = /^(?:\*|[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)$/i;
const MAX_NAME = 253;
const TARGET_TYPES: ReadonlySet<DnsRecord['type']> = new Set(['CNAME', 'MX', 'NS']);

/** Origin without the final dot, lowercase; undefined when empty. */
export function cleanOrigin(origin: string | undefined): string | undefined {
  const o = (origin ?? '').trim().toLowerCase().replace(/\.$/, '');
  return o === '' ? undefined : o;
}

/** Absolute name (lowercase, no final dot) or null when `@` is used without an origin. */
export function qualify(name: string, origin: string | undefined): string | null {
  const n = name.trim().toLowerCase();
  const o = cleanOrigin(origin);
  if (n === '@') return o ?? null;
  if (n.endsWith('.')) return n.slice(0, -1);
  return o ? `${n}.${o}` : n;
}

function validLabels(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME && name.split('.').every((l) => LABEL.test(l));
}

export function validateOrigin(origin: string | undefined): string | null {
  const o = cleanOrigin(origin);
  return o === undefined || validLabels(o) ? null : 'Origen de zona no válido (por ejemplo aula.lab).';
}

/** Validates a name as typed in a record (owner or target). */
export function validateName(name: string, origin: string | undefined): string | null {
  const n = name.trim();
  if (n === '@') return cleanOrigin(origin) ? null : '«@» necesita el origen de la zona (campo Dominio de la zona).';
  const body = n.endsWith('.') ? n.slice(0, -1) : n;
  if (!validLabels(body)) return `Nombre no válido: «${n}». Usa www (relativo), www.aula.lab. (absoluto) o @.`;
  const full = qualify(n, origin);
  return full !== null && full.length <= MAX_NAME ? null : `Nombre demasiado largo: «${n}».`;
}

/** Records with every owner and CNAME/MX/NS target made absolute (invalid ones are skipped). */
export function effectiveRecords(dns: { readonly origin?: string; readonly records: readonly DnsRecord[] }): DnsRecord[] {
  const out: DnsRecord[] = [];
  for (const r of dns.records) {
    const name = qualify(r.name, dns.origin);
    const value = TARGET_TYPES.has(r.type) ? qualify(r.value, dns.origin) : r.value;
    if (name !== null && value !== null) out.push({ ...r, name, value });
  }
  return out;
}

/** FQDN with the final dot, as BIND would print it (used as a preview in the GUI). */
export function displayName(name: string, origin: string | undefined): string {
  const q = qualify(name, origin);
  return q === null ? '' : `${q}.`;
}
