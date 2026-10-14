/** `nft list …` output, as nftables 1.1 prints it (tabs, priority names, `# handle N` with -a). */
import type { BaseChain, Chain, Family, Match, Rule, Ruleset, Table, Value, Verdict } from './model.ts';
import { PRIORITY_NAMES } from './model.ts';
import { formatIp } from '../../core/ip.ts';

export interface Counter {
  packets: number;
  bytes: number;
}

export interface FormatOptions {
  /** -a: show handles. */
  readonly handles?: boolean;
  readonly counters?: ReadonlyMap<number, Counter>;
}

function priorityText(p: number): string {
  const named = Object.entries(PRIORITY_NAMES).find(([, v]) => v === p);
  if (named) return named[0];
  const near = Object.entries(PRIORITY_NAMES).find(([, v]) => Math.abs(p - v) <= 10 && p !== v);
  if (near) return `${near[0]} ${p > near[1] ? '+' : '-'} ${Math.abs(p - near[1])}`;
  return String(p);
}

function baseLine(b: BaseChain): string {
  return `type ${b.type} hook ${b.hook} priority ${priorityText(b.priority)}; policy ${b.policy};`;
}

function valueText(v: Value, field: string): string {
  switch (v.kind) {
    case 'addr': return v.prefix === 32 ? formatIp(v.ip) : `${formatIp(v.ip)}/${v.prefix}`;
    case 'num': return String(v.n);
    case 'range': return `${v.from}-${v.to}`;
    case 'word': return field.startsWith('iif') || field.startsWith('oif') ? `"${v.w}"` : v.w;
    case 'set': {
      const items = v.items.map((i) => valueText(i, field));
      return field === 'ct state' ? items.join(',') : `{ ${items.join(', ')} }`;
    }
  }
}

function matchText(m: Match): string {
  return `${m.field} ${m.negate ? '!= ' : ''}${valueText(m.value, m.field)}`;
}

function verdictText(v: Verdict, family: Family): string {
  const ip = family === 'inet' ? ' ip' : '';
  switch (v.kind) {
    case 'jump': case 'goto': return `${v.kind} ${v.chain}`;
    case 'reject': return v.with ? `reject with ${family === 'inet' && v.with.startsWith('icmp ') ? v.with.replace('icmp ', 'icmpx ') : v.with}` : 'reject';
    case 'snat': case 'dnat': return `${v.kind}${ip} to ${formatIp(v.ip)}${v.port !== undefined ? `:${v.port}` : ''}`;
    default: return v.kind;
  }
}

export function ruleText(r: Rule, family: Family, counters?: ReadonlyMap<number, Counter>): string {
  const parts = r.matches.map(matchText);
  if (r.counter) {
    const c = counters?.get(r.handle) ?? { packets: 0, bytes: 0 };
    parts.push(`counter packets ${c.packets} bytes ${c.bytes}`);
  }
  if (r.log !== undefined) parts.push(r.log ? `log prefix "${r.log}"` : 'log');
  if (r.verdict) parts.push(verdictText(r.verdict, family));
  if (r.comment !== undefined) parts.push(`comment "${r.comment}"`);
  return parts.join(' ');
}

const handle = (o: FormatOptions, h: number): string => (o.handles ? ` # handle ${h}` : '');

export function chainText(c: Chain, family: Family, o: FormatOptions, indent = '\t'): string[] {
  const lines = [`${indent}chain ${c.name} {${handle(o, c.handle)}`];
  if (c.base) lines.push(`${indent}\t${baseLine(c.base)}`);
  for (const r of c.rules) lines.push(`${indent}\t${ruleText(r, family, o.counters)}${handle(o, r.handle)}`);
  lines.push(`${indent}}`);
  return lines;
}

export function tableText(t: Table, o: FormatOptions): string[] {
  const lines = [`table ${t.family} ${t.name} {${handle(o, t.handle)}`];
  t.chains.forEach((c, i) => {
    if (i > 0) lines.push('');
    lines.push(...chainText(c, t.family, o));
  });
  lines.push('}');
  return lines;
}

export function rulesetText(rs: Ruleset, o: FormatOptions = {}): string[] {
  return rs.tables.flatMap((t) => tableText(t, o));
}

/** A chain listed alone (`nft list chain inet filter input`) is wrapped in its table. */
export function singleChainText(t: Table, c: Chain, o: FormatOptions): string[] {
  return [`table ${t.family} ${t.name} {`, ...chainText(c, t.family, o), '}'];
}
