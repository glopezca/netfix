/**
 * IP access lists: standard (1-99, `ip access-list standard`) and extended (100-199, `ip access-list
 * extended`); used by NAT, `ip access-group` and crypto maps.
 */
import { formatIp } from '../core/ip.ts';
import type { IpPacket } from '../net/packets.ts';
import { ANY_WILDCARD, parseSource } from './acl-addr.ts';
import { extMatches, extText } from './acl-ext.ts';
import type { ExtFields } from './acl-ext.ts';

export interface AclEntry {
  readonly seq: number;
  readonly action: 'permit' | 'deny' | 'remark';
  /** Address and wildcard bits; any = 0.0.0.0 255.255.255.255. */
  readonly ip: number;
  readonly wildcard: number;
  readonly remark?: string;
  /** Extended entries: protocol, destination, ports… (the source is ip/wildcard above). */
  readonly ext?: ExtFields;
}

export type AccessLists = ReadonlyMap<string, readonly AclEntry[]>;

const SEQ_STEP = 10;

export { parseSource };

export function isNumberedStandard(name: string): boolean {
  return /^\d+$/.test(name) && Number(name) >= 1 && Number(name) <= 99;
}

export function isNumberedExtended(name: string): boolean {
  return /^\d+$/.test(name) && ((Number(name) >= 100 && Number(name) <= 199) || (Number(name) >= 2000 && Number(name) <= 2699));
}

/** An extended list: numbered 100-199/2000-2699, a named one declared extended, or one with extended entries. */
export function isExtendedList(name: string, entries: readonly AclEntry[], named: ReadonlySet<string> = new Set()): boolean {
  return isNumberedExtended(name) || named.has(name) || entries.some((e) => e.ext !== undefined);
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

/** First entry matching a whole packet (standard entries look at the source only). */
export function aclPacketMatch(entries: readonly AclEntry[] | undefined, p: IpPacket): AclEntry | undefined {
  return entries?.find((e) => e.action !== 'remark' && (e.ext ? extMatches(e, e.ext, p) : aclEntryMatches(e, p.src)));
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
  if (e.action === 'remark') return `remark ${e.remark ?? ''}`;
  return e.ext ? `${e.action} ${extText(e, e.ext)}` : `${e.action} ${sourceText(e, 'config')}`;
}

const byName = (lists: AccessLists): [string, readonly AclEntry[]][] => [...lists.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));

/** Running-config lines: numbered lists as `access-list N …`, named ones as blocks. */
export function aclConfigLines(lists: AccessLists, extendedNamed: ReadonlySet<string> = new Set()): { numbered: string[]; named: string[] } {
  const numbered: string[] = [];
  const named: string[] = [];
  for (const [name, entries] of byName(lists)) {
    if (isNumberedStandard(name) || isNumberedExtended(name)) numbered.push(...entries.map((e) => `access-list ${name} ${entryBody(e)}`));
    else named.push(`ip access-list ${isExtendedList(name, entries, extendedNamed) ? 'extended' : 'standard'} ${name}`, ...entries.map((e) => ` ${entryBody(e)}`));
  }
  return { numbered, named };
}

export function showAccessLists(lists: AccessLists, hits: ReadonlyMap<string, number>, extendedNamed: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (const [name, entries] of byName(lists)) {
    const ext = isExtendedList(name, entries, extendedNamed);
    out.push(`${ext ? 'Extended' : 'Standard'} IP access list ${name}`);
    for (const e of entries) {
      if (e.action === 'remark') continue;
      const n = hits.get(`${name}:${e.seq}`) ?? 0;
      const body = e.ext ? extText(e, e.ext) : sourceText(e, 'show');
      out.push(`    ${e.seq} ${e.action} ${body}${n ? ` (${n} match(es))` : ''}`);
    }
  }
  return out;
}
