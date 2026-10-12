/** Standard IP access lists (numbered 1-99 and named), used by NAT to select inside sources. */
import { formatIp, parseIp } from '../core/ip.ts';

export interface AclEntry {
  readonly seq: number;
  readonly action: 'permit' | 'deny' | 'remark';
  /** Address and wildcard bits; any = 0.0.0.0 255.255.255.255. */
  readonly ip: number;
  readonly wildcard: number;
  readonly remark?: string;
}

export type AccessLists = ReadonlyMap<string, readonly AclEntry[]>;

const ANY_WILDCARD = 0xffffffff;
const SEQ_STEP = 10;

export function isNumberedStandard(name: string): boolean {
  return /^\d+$/.test(name) && Number(name) >= 1 && Number(name) <= 99;
}

/** "any" | "host A.B.C.D" | "A.B.C.D [wildcard]" → address and wildcard, or an IOS error. */
export function parseSource(words: readonly string[]): { ip: number; wildcard: number } | string {
  const [first, second] = words;
  if (first === 'any') return { ip: 0, wildcard: ANY_WILDCARD };
  if (first === 'host') {
    const ip = parseIp(second ?? '');
    return ip === null ? '% Invalid input detected.' : { ip, wildcard: 0 };
  }
  const ip = parseIp(first ?? '');
  const wildcard = second === undefined ? 0 : parseIp(second);
  if (ip === null || wildcard === null) return '% Invalid input detected.';
  return { ip: (ip & ~wildcard) >>> 0, wildcard };
}

export function aclEntryMatches(e: AclEntry, ip: number): boolean {
  return e.action !== 'remark' && ((ip & ~e.wildcard) >>> 0) === ((e.ip & ~e.wildcard) >>> 0);
}

/** First matching entry (implicit deny when none). */
export function aclFirstMatch(entries: readonly AclEntry[] | undefined, ip: number): AclEntry | undefined {
  return entries?.find((e) => aclEntryMatches(e, ip));
}

export function aclPermits(entries: readonly AclEntry[] | undefined, ip: number): boolean {
  return aclFirstMatch(entries, ip)?.action === 'permit';
}

export function nextSeq(entries: readonly AclEntry[]): number {
  return (entries.reduce((m, e) => Math.max(m, e.seq), 0) + SEQ_STEP);
}

export function sourceText(e: AclEntry, style: 'config' | 'show'): string {
  if (e.wildcard === ANY_WILDCARD) return 'any';
  if (e.wildcard === 0) return style === 'config' ? `host ${formatIp(e.ip)}` : formatIp(e.ip);
  return style === 'config' ? `${formatIp(e.ip)} ${formatIp(e.wildcard)}` : `${formatIp(e.ip)}, wildcard bits ${formatIp(e.wildcard)}`;
}

function entryBody(e: AclEntry): string {
  return e.action === 'remark' ? `remark ${e.remark ?? ''}` : `${e.action} ${sourceText(e, 'config')}`;
}

/** Running-config lines: numbered lists as `access-list N …`, named ones as blocks. */
export function aclConfigLines(lists: AccessLists): { numbered: string[]; named: string[] } {
  const numbered: string[] = [];
  const named: string[] = [];
  for (const [name, entries] of [...lists.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    if (isNumberedStandard(name)) numbered.push(...entries.map((e) => `access-list ${name} ${entryBody(e)}`));
    else named.push(`ip access-list standard ${name}`, ...entries.map((e) => ` ${entryBody(e)}`));
  }
  return { numbered, named };
}

export function showAccessLists(lists: AccessLists, hits: ReadonlyMap<string, number>): string[] {
  const out: string[] = [];
  for (const [name, entries] of [...lists.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    out.push(`Standard IP access list ${name}`);
    for (const e of entries) {
      if (e.action === 'remark') continue;
      const n = hits.get(`${name}:${e.seq}`) ?? 0;
      out.push(`    ${e.seq} ${e.action} ${sourceText(e, 'show')}${n ? ` (${n} match(es))` : ''}`);
    }
  }
  return out;
}
