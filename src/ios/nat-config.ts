/** IOS NAT configuration (pools, dynamic and static rules) and its show/running-config output. */
import { formatIp, formatMask } from '../core/ip.ts';
import type { NatEntry, NatTable, StaticNat } from '../net/nat.ts';

export interface NatPool {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly prefix: number;
}

export interface NatDynamic {
  readonly acl: string;
  readonly iface?: string;
  readonly pool?: string;
  readonly overload: boolean;
}

export interface NatStaticRule {
  readonly local: number;
  /** Global address, or the address of `globalIface` (static … interface G0/1 80). */
  readonly global?: number;
  readonly globalIface?: string;
  readonly proto?: 'tcp' | 'udp';
  readonly localPort?: number;
  readonly globalPort?: number;
}

export interface NatConfig {
  readonly pools: readonly NatPool[];
  readonly dynamic: readonly NatDynamic[];
  readonly statics: readonly NatStaticRule[];
}

export const EMPTY_NAT: NatConfig = { pools: [], dynamic: [], statics: [] };

export function sameStatic(a: NatStaticRule, b: NatStaticRule): boolean {
  return a.local === b.local && a.proto === b.proto && a.localPort === b.localPort;
}

function staticLine(s: NatStaticRule): string {
  const global = s.globalIface ? `interface ${s.globalIface}` : formatIp(s.global ?? 0);
  if (!s.proto) return `ip nat inside source static ${formatIp(s.local)} ${global}`;
  return `ip nat inside source static ${s.proto} ${formatIp(s.local)} ${s.localPort ?? 0} ${global} ${s.globalPort ?? 0}`;
}

export function natConfigLines(nat: NatConfig): string[] {
  return [
    ...nat.pools.map((p) => `ip nat pool ${p.name} ${formatIp(p.start)} ${formatIp(p.end)} netmask ${formatMask(p.prefix)}`),
    ...nat.dynamic.map((d) => `ip nat inside source list ${d.acl} ${d.iface ? `interface ${d.iface}` : `pool ${d.pool ?? ''}`}${d.overload ? ' overload' : ''}`),
    ...nat.statics.map(staticLine),
  ];
}

const W = 21;
const ep = (ip: number | undefined, port: number | undefined): string => (ip === undefined ? '---' : port === undefined ? formatIp(ip) : `${formatIp(ip)}:${port}`);

function row(pro: string, ig: string, il: string, ol: string, og: string): string {
  return `${pro.padEnd(4)} ${ig.padEnd(W)} ${il.padEnd(W)} ${ol.padEnd(W)} ${og}`;
}

export function showNatTranslations(dynamic: readonly NatEntry[], statics: readonly StaticNat[]): string[] {
  const lines = [row('Pro', 'Inside global', 'Inside local', 'Outside local', 'Outside global')];
  for (const e of dynamic) {
    const out = ep(e.outside, e.outsidePort);
    lines.push(row(e.proto ?? '---', ep(e.insideGlobal, e.globalPort), ep(e.insideLocal, e.localPort), e.proto ? out : '---', e.proto ? out : '---'));
  }
  for (const s of statics) {
    lines.push(row(s.proto ?? '---', ep(s.global, s.globalPort), ep(s.local, s.localPort), '---', '---'));
  }
  return lines;
}

export interface NatStatsInput {
  readonly table: NatTable;
  readonly statics: readonly StaticNat[];
  readonly inside: readonly string[];
  readonly outside: readonly string[];
  readonly nat: NatConfig;
  readonly poolUse: (pool: NatPool) => number;
}

export function showNatStatistics(i: NatStatsInput): string[] {
  const dyn = i.table.entries();
  const extended = dyn.filter((e) => e.proto !== null).length + i.statics.filter((s) => s.proto).length;
  const lines = [
    `Total active translations: ${dyn.length + i.statics.length} (${i.statics.length} static, ${dyn.length} dynamic; ${extended} extended)`,
    'Outside interfaces:', ...i.outside.map((n) => `  ${n}`),
    'Inside interfaces: ', ...i.inside.map((n) => `  ${n}`),
    `Hits: ${i.table.hits}  Misses: ${i.table.misses}`,
    `CEF Translated packets: ${i.table.hits + i.table.misses}, CEF Punted packets: 0`,
    'Expired translations: 0',
    'Dynamic mappings:',
    '-- Inside Source',
  ];
  i.nat.dynamic.forEach((d, n) => {
    const refs = dyn.filter((e) => (d.iface ? true : i.nat.pools.some((p) => p.name === d.pool && e.insideGlobal >= p.start && e.insideGlobal <= p.end))).length;
    lines.push(`[Id: ${n + 1}] access-list ${d.acl} ${d.iface ? `interface ${d.iface}` : `pool ${d.pool ?? ''}`} refcount ${refs}`);
    const pool = i.nat.pools.find((p) => p.name === d.pool);
    if (!pool) return;
    const total = pool.end - pool.start + 1;
    const used = i.poolUse(pool);
    lines.push(` pool ${pool.name}: netmask ${formatMask(pool.prefix)}`, `\tstart ${formatIp(pool.start)} end ${formatIp(pool.end)}`,
      `\ttype generic, total addresses ${total}, allocated ${used} (${Math.round((used * 100) / Math.max(total, 1))}%), misses 0`);
  });
  return lines;
}
