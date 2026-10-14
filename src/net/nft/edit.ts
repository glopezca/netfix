/**
 * Ruleset editing for the GUI and the web admin: forms become nft rule text that goes through the same
 * parser as the CLI (so the GUI never writes what `nft` could not read), plus reordering and templates.
 */
import type { Family, Ruleset } from './model.ts';
import { findChain, findTable, withChain, withTable } from './model.ts';
import { runNft } from './apply.ts';
import { parseIp } from '../../core/ip.ts';

export type FormAction = 'accept' | 'drop' | 'reject' | 'masquerade' | 'snat' | 'dnat';

export interface RuleForm {
  readonly iif?: string;
  readonly oif?: string;
  readonly saddr?: string;
  readonly daddr?: string;
  readonly proto?: '' | 'tcp' | 'udp' | 'icmp';
  /** Port, range (1000-2000) or comma list (22,80). */
  readonly dport?: string;
  readonly ct?: readonly string[];
  readonly action: FormAction;
  /** snat/dnat target: IP or IP:port. */
  readonly to?: string;
  readonly counter?: boolean;
  readonly log?: string;
  readonly comment?: string;
}

export type EditResult = { ok: true; ruleset: Ruleset } | { ok: false; error: string };

const IFACE = /^[a-z][a-z0-9.-]{0,14}$/i;
const ADDR = /^\d+\.\d+\.\d+\.\d+(\/\d{1,2})?$/;
const PORTS = /^\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*$/;
const STATES = new Set(['new', 'established', 'related', 'invalid']);
const MAX_TEXT = 64;

function quoted(text: string): string | null {
  return text.length <= MAX_TEXT && !/["\\\n]/.test(text) ? `"${text}"` : null;
}

/** nft text of a form, or the first invalid field. */
export function ruleFromForm(f: RuleForm): string | { error: string } {
  const parts: string[] = [];
  const iface = (k: 'iif' | 'oif', v?: string): string | null => {
    if (!v) return '';
    return IFACE.test(v) ? `${k}name "${v}"` : null;
  };
  for (const [k, v] of [['iif', f.iif], ['oif', f.oif]] as const) {
    const x = iface(k, v);
    if (x === null) return { error: k };
    if (x) parts.push(x);
  }
  for (const [k, v] of [['saddr', f.saddr], ['daddr', f.daddr]] as const) {
    if (!v) continue;
    if (!ADDR.test(v) || parseIp(v.split('/')[0] ?? '') === null) return { error: k };
    parts.push(`ip ${k} ${v}`);
  }
  if (f.dport) {
    if (f.proto !== 'tcp' && f.proto !== 'udp') return { error: 'proto' };
    if (!PORTS.test(f.dport)) return { error: 'dport' };
    parts.push(`${f.proto} dport ${f.dport.includes(',') ? `{ ${f.dport.split(',').join(', ')} }` : f.dport}`);
  } else if (f.proto) parts.push(f.proto === 'icmp' ? 'ip protocol icmp' : `meta l4proto ${f.proto}`);
  if (f.ct?.length) {
    if (!f.ct.every((s) => STATES.has(s))) return { error: 'ct' };
    parts.push(`ct state ${f.ct.join(',')}`);
  }
  if (f.counter) parts.push('counter');
  if (f.log) {
    const q = quoted(f.log);
    if (!q) return { error: 'log' };
    parts.push(`log prefix ${q}`);
  }
  if (f.action === 'snat' || f.action === 'dnat') {
    if (!f.to || !/^\d+\.\d+\.\d+\.\d+(:\d{1,5})?$/.test(f.to)) return { error: 'to' };
    parts.push(`${f.action} to ${f.to}`);
  } else parts.push(f.action);
  if (f.comment) {
    const q = quoted(f.comment);
    if (!q) return { error: 'comment' };
    parts.push(`comment ${q}`);
  }
  return parts.join(' ');
}

/** Runs one nft command against the ruleset (the GUI's only way to change it). */
export function nftEdit(rs: Ruleset, command: string): EditResult {
  const r = runNft(rs, command);
  return r.ok ? { ok: true, ruleset: r.ruleset } : { ok: false, error: r.error };
}

/** Moves a rule one place up or down inside its chain (nft has no move: the GUI rewrites the chain). */
export function moveRule(rs: Ruleset, family: Family, table: string, chain: string, handle: number, delta: -1 | 1): Ruleset {
  const t = findTable(rs, family, table);
  const c = t ? findChain(t, chain) : undefined;
  if (!t || !c) return rs;
  const i = c.rules.findIndex((r) => r.handle === handle);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= c.rules.length) return rs;
  const rules = [...c.rules];
  [rules[i], rules[j]] = [rules[j] as (typeof rules)[number], rules[i] as (typeof rules)[number]];
  return withTable(rs, withChain(t, { ...c, rules }));
}

/** Starting points offered by the GUI (they replace the ruleset; WAN = eth0). */
export const NFT_TEMPLATES: Readonly<Record<string, string>> = {
  hardening: `flush ruleset
table inet filter {
\tchain input {
\t\ttype filter hook input priority filter; policy drop;
\t\tct state established,related accept
\t\tct state invalid drop
\t\tiif "lo" accept
\t\ticmp type echo-request accept
\t\ttcp dport 22 accept
\t}
\tchain forward {
\t\ttype filter hook forward priority filter; policy drop;
\t}
\tchain output {
\t\ttype filter hook output priority filter; policy accept;
\t}
}`,
  router: `flush ruleset
table inet filter {
\tchain input {
\t\ttype filter hook input priority filter; policy drop;
\t\tct state established,related accept
\t\tiif "lo" accept
\t\tiifname != "eth0" accept
\t\ticmp type echo-request accept
\t}
\tchain forward {
\t\ttype filter hook forward priority filter; policy drop;
\t\tct state established,related accept
\t\tiifname != "eth0" oifname "eth0" accept
\t}
}
table ip nat {
\tchain postrouting {
\t\ttype nat hook postrouting priority srcnat; policy accept;
\t\toifname "eth0" masquerade
\t}
}`,
  open: `flush ruleset
table inet filter {
\tchain input {
\t\ttype filter hook input priority filter; policy accept;
\t}
\tchain forward {
\t\ttype filter hook forward priority filter; policy accept;
\t}
\tchain output {
\t\ttype filter hook output priority filter; policy accept;
\t}
}`,
};
