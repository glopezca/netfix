/**
 * Comprobación de una zona como named-checkzone (BIND 9.20): la carga (zone-parse.ts) y después las comprobaciones de
 * la zona cargada (un SOA, algún NS, direcciones de los NS, MX y SRV de dentro de la zona). Lo usan named-checkzone,
 * named-compilezone y named-checkconf -z.
 */
import { absolute, bare, inZone, loadZone } from './zone-parse.ts';
import type { ZoneReader, ZoneRecord } from './zone-parse.ts';

export interface ZoneCheck {
  readonly ok: boolean;
  /** Las líneas que escribe named-checkzone, sin el «OK» final. */
  readonly lines: readonly string[];
  readonly serial?: number;
  readonly records: readonly ZoneRecord[];
}

interface Findings { readonly errors: string[]; readonly warnings: string[] }

/** Comprobaciones de integridad: las de los NS son errores; las de MX y SRV, avisos (named-checkzone -M/-S warn). */
function integrity(apex: string, records: readonly ZoneRecord[], tag: string): Findings {
  const errors: string[] = [];
  const warnings: string[] = [];
  const at = (name: string, types: readonly string[]): boolean => records.some((r) => r.owner === name && types.includes(r.type));
  const target = (r: ZoneRecord): string => r.data[r.data.length - 1] ?? '.';
  const check = (r: ZoneRecord, label: string, out: string[]): void => {
    const t = target(r);
    if (t === '.' || !inZone(t, apex)) return;
    if (at(t, ['CNAME'])) out.push(`${tag}: ${label} '${bare(t)}' is a CNAME (illegal)`);
    else if (!at(t, ['A', 'AAAA'])) out.push(`${tag}: ${label} '${bare(t)}' has no address records (A or AAAA)`);
  };
  for (const r of records) if (r.type === 'NS' && r.owner === apex) check(r, 'NS', errors);
  for (const r of records) if (r.type === 'MX' || r.type === 'SRV') check(r, `${bare(r.owner)}/${r.type}`, warnings);
  return { errors, warnings };
}

/**
 * Comprueba el texto de una zona. `text` sin definir es que el archivo no se pudo leer y `readError` el motivo
 * («file not found», «permission denied»).
 */
export function checkZone(zone: string, file: string, text: string | undefined, readError = 'file not found', read?: ZoneReader): ZoneCheck {
  const apex = absolute(zone);
  const tag = `zone ${bare(apex)}/IN`;
  const notLoaded = `${tag}: not loaded due to errors.`;
  const failed = (reason: string): string => `${tag}: loading from master file ${file} failed: ${reason}`;
  if (text === undefined) return { ok: false, lines: [failed(readError), notLoaded], records: [] };
  const load = loadZone(zone, file, text, read);
  if (load.error) return { ok: false, lines: [...load.warnings, load.error.line, failed(load.error.reason), notLoaded], records: [] };
  const apexOf = (type: string): ZoneRecord[] => load.records.filter((r) => r.owner === apex && r.type === type);
  const soa = apexOf('SOA');
  const structural = [
    ...(soa.length === 0 ? [`${tag}: has 0 SOA records`] : []),
    ...(apexOf('NS').length === 0 ? [`${tag}: has no NS records`] : []),
  ];
  if (structural.length > 0) return { ok: false, lines: [...load.warnings, ...structural, notLoaded], records: load.records };
  const found = integrity(apex, load.records, tag);
  if (found.errors.length > 0) return { ok: false, lines: [...load.warnings, ...found.errors, ...found.warnings, notLoaded], records: load.records };
  const serial = Number(soa[0]?.data[2] ?? 0);
  return { ok: true, lines: [...load.warnings, ...found.warnings, `${tag}: loaded serial ${serial}`], serial, records: load.records };
}

const TYPE_RANK: Readonly<Record<string, number>> = { SOA: 0, NS: 1 };
const canonical = (name: string): string => name.split('.').reverse().join('\u0001');

/** La zona en forma canónica, como la escribe named-compilezone: nombres completos, el vértice primero. */
export function dumpZone(records: readonly ZoneRecord[]): string {
  const apex = records.find((r) => r.type === 'SOA')?.owner;
  const sorted = [...records].sort((a, b) => {
    if ((a.owner === apex) !== (b.owner === apex)) return a.owner === apex ? -1 : 1;
    const [ka, kb] = [canonical(a.owner), canonical(b.owner)];
    const byName = ka < kb ? -1 : ka > kb ? 1 : 0;
    return byName || (TYPE_RANK[a.type] ?? 2) - (TYPE_RANK[b.type] ?? 2);
  });
  return sorted.map((r) => `${r.owner}\t${r.ttl}\tIN ${r.type}\t${r.data.join(' ')}\n`).join('');
}
