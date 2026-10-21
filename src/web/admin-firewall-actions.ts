/** Form actions of the "Seguridad" pages: they go through nft/edit.ts and save like the Services tab. */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import type { Family, Ruleset } from '../net/nft/model.ts';
import { adminPort, locksOut } from './admin-firewall.ts';
import { EMPTY_RULESET } from '../net/nft/model.ts';
import { runNft } from '../net/nft/apply.ts';
import { moveRule, nftEdit, NFT_TEMPLATES, ruleFromForm } from '../net/nft/edit.ts';
import type { FormAction, RuleForm } from '../net/nft/edit.ts';
import { applyAndSave, setFirewallActive } from '../shells/firewall-save.ts';
import { saveSysctl } from '../shells/kernel-save.ts';
import { routeTo } from '../devices/host-nics.ts';
import { formatIp, inSubnet, parseIp } from '../core/ip.ts';

export type Fields = ReadonlyMap<string, string>;
export interface Outcome {
  readonly ok?: string;
  readonly error?: string;
}

const saved = (): Outcome => ({ ok: t('wa.saved') });
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const KEY = /^(inet|ip) ([A-Za-z][\w-]{0,31})(?: ([A-Za-z][\w-]{0,31}))?(?: (\d{1,6}))?$/;

const HOOKS: ReadonlySet<string> = new Set(['prerouting', 'input', 'forward', 'output', 'postrouting']);
const lockout = (): string => t('fwa.lockout');

function commit(server: Server, command: string): Outcome {
  const r = nftEdit(server.kernel.netfilter.ruleset, command);
  if (!r.ok) return { error: r.error };
  if (locksOut(server, r.ruleset) && !locksOut(server)) return { error: lockout() };
  applyAndSave(server, r.ruleset);
  return saved();
}

/** Keeps the GUI reachable after a template: accepts its port at the top of every dropping input chain. */
function keepAccess(server: Server, rs: Ruleset): { ruleset: Ruleset; added: boolean } {
  if (!locksOut(server, rs)) return { ruleset: rs, added: false };
  const port = adminPort(server);
  const cmds = rs.tables.flatMap((t) => t.chains.filter((c) => c.base?.hook === 'input' && c.base.policy === 'drop')
    .map((c) => `insert rule ${t.family} ${t.name} ${c.name} tcp dport ${port} accept comment "gestion web"`));
  const r = nftEdit(rs, cmds.join('\n'));
  return r.ok ? { ruleset: r.ruleset, added: true } : { ruleset: rs, added: false };
}

function parseKey(f: Fields): { family: Family; table: string; chain?: string; handle?: number } | null {
  const m = KEY.exec((f.get('key') ?? f.get('table') ?? '').trim());
  if (!m) return null;
  return { family: m[1] as Family, table: m[2] ?? '', chain: m[3], handle: m[4] === undefined ? undefined : Number(m[4]) };
}

function ruleAdd(server: Server, f: Fields): Outcome {
  const target = (f.get('target') ?? '').trim();
  if (!KEY.test(target)) return { error: t('fwa.pickChain') };
  const form: RuleForm = {
    iif: f.get('iif')?.trim() || undefined, oif: f.get('oif')?.trim() || undefined, saddr: f.get('saddr')?.trim() || undefined, daddr: f.get('daddr')?.trim() || undefined,
    proto: (['tcp', 'udp', 'icmp'].includes(f.get('proto') ?? '') ? f.get('proto') : '') as RuleForm['proto'], dport: f.get('dport')?.trim() || undefined,
    ct: ['new', 'established', 'related', 'invalid'].filter((s) => f.has(`ct_${s}`)), action: (f.get('ruleAction') ?? 'accept') as FormAction,
    to: f.get('to')?.trim() || undefined, counter: f.has('counter'), log: f.get('log') || undefined, comment: f.get('comment') || undefined,
  };
  if (!['accept', 'drop', 'reject', 'masquerade', 'snat', 'dnat'].includes(form.action)) return { error: t('fwa.badAction') };
  const body = ruleFromForm(form);
  if (typeof body !== 'string') return { error: t('fwa.badField', { field: body.error }) };
  return commit(server, `${f.has('top') ? 'insert' : 'add'} rule ${target} ${body}`);
}

function chainAdd(server: Server, f: Fields): Outcome {
  const k = parseKey(f);
  const name = (f.get('name') ?? '').trim();
  if (!k || !NAME.test(name)) return { error: t('fwa.badChain') };
  const type = f.get('type') ?? '';
  const prio = (f.get('priority') ?? '0').trim();
  if (type && (!['filter', 'nat'].includes(type) || !/^-?\d{1,4}$/.test(prio))) return { error: t('fwa.badType') };
  const hook = f.get('hook') ?? 'input';
  if (type && !HOOKS.has(hook)) return { error: t('fwa.badType') };
  const spec = type ? ` { type ${type} hook ${hook} priority ${prio}; policy ${f.get('policy') === 'drop' ? 'drop' : 'accept'}; }` : '';
  return commit(server, `add chain ${k.family} ${k.table} ${name}${spec}`);
}

function policy(server: Server, f: Fields): Outcome {
  const k = parseKey(f);
  const tb = k ? server.kernel.netfilter.ruleset.tables.find((x) => x.family === k.family && x.name === k.table) : undefined;
  const b = tb?.chains.find((c) => c.name === k?.chain)?.base;
  if (!k || !b) return { error: t('fwa.noChain') };
  return commit(server, `add chain ${k.family} ${k.table} ${k.chain ?? ''} { type ${b.type} hook ${b.hook} priority ${b.priority}; policy ${f.get('policy') === 'drop' ? 'drop' : 'accept'}; }`);
}

function template(server: Server, f: Fields): Outcome {
  const text = NFT_TEMPLATES[f.get('template') ?? ''];
  if (!text) return { error: t('fwa.pickTemplate') };
  const r = runNft(EMPTY_RULESET, text);
  if (!r.ok) return { error: r.error };
  const kept = keepAccess(server, r.ruleset);
  applyAndSave(server, kept.ruleset);
  return kept.added ? { ok: t('fwa.templateKept', { port: adminPort(server) }) } : saved();
}

function move(server: Server, f: Fields, delta: -1 | 1): Outcome {
  const k = parseKey(f);
  if (!k?.chain || k.handle === undefined) return { error: t('fwa.noRule') };
  const next = moveRule(server.kernel.netfilter.ruleset, k.family, k.table, k.chain, k.handle, delta);
  if (locksOut(server, next) && !locksOut(server)) return { error: lockout() };
  applyAndSave(server, next);
  return saved();
}

function routeAdd(server: Server, f: Fields): Outcome {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec((f.get('to') ?? '').trim());
  const net = m ? parseIp(m[1] ?? '') : null;
  const via = parseIp((f.get('via') ?? '').trim());
  const prefix = Number(m?.[2]);
  const reachable = via !== null && server.nics().some((n) => n.ip !== undefined && n.prefix !== undefined && inSubnet(via, n.ip, n.prefix));
  if (net === null || via === null || prefix > 32 || !reachable) return { error: t('fwa.badRoute') };
  const r = routeTo(net, prefix, via);
  server.setStaticRoutes([...server.staticRoutes.filter((x) => !(x.net === r.net && x.prefix === r.prefix)), r]);
  return saved();
}

/** Runs a "Seguridad" action; null when `action` is not one of them. */
export function securityAction(server: Server, f: Fields): Outcome | null {
  const k = parseKey(f);
  switch (f.get('action')) {
    case 'fw-service': setFirewallActive(server, f.has('enabled')); return saved();
    case 'fw-template': return template(server, f);
    case 'fw-table-add': return NAME.test((f.get('name') ?? '').trim()) ? commit(server, `add table ${f.get('family') === 'ip' ? 'ip' : 'inet'} ${(f.get('name') ?? '').trim()}`) : { error: t('fwa.badTable') };
    case 'fw-table-del': return k ? commit(server, `delete table ${k.family} ${k.table}`) : { error: t('fwa.noTable') };
    case 'fw-chain-add': return chainAdd(server, f);
    case 'fw-chain-del': return k?.chain ? commit(server, `flush chain ${k.family} ${k.table} ${k.chain}\ndelete chain ${k.family} ${k.table} ${k.chain}`) : { error: t('fwa.noChain') };
    case 'fw-policy': return policy(server, f);
    case 'fw-rule-add': return ruleAdd(server, f);
    case 'fw-rule-del': return k?.chain && k.handle !== undefined ? commit(server, `delete rule ${k.family} ${k.table} ${k.chain} handle ${k.handle}`) : { error: t('fwa.noRule') };
    case 'fw-rule-up': return move(server, f, -1);
    case 'fw-rule-down': return move(server, f, 1);
    case 'router-enable': { const err = saveSysctl(server, 'net.ipv4.ip_forward', f.get('enabled') === '1' ? '1' : '0'); return err ? { error: err } : saved(); }
    case 'sysctl-set': { const err = saveSysctl(server, (f.get('key') ?? '').trim(), (f.get('value') ?? '').trim()); return err ? { error: err } : saved(); }
    case 'route-add': return routeAdd(server, f);
    case 'route-del': { const to = (f.get('key') ?? '').trim(); server.setStaticRoutes(server.staticRoutes.filter((r) => `${formatIp(r.net)}/${r.prefix}` !== to)); return saved(); }
    default: return null;
  }
}
