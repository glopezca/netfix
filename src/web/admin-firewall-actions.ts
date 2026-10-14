/** Form actions of the "Seguridad" pages: they go through nft/edit.ts and save like the Services tab. */
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

const SAVED: Outcome = { ok: 'Los cambios se han guardado correctamente.' };
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const KEY = /^(inet|ip) ([A-Za-z][\w-]{0,31})(?: ([A-Za-z][\w-]{0,31}))?(?: (\d{1,6}))?$/;

const LOCKOUT = 'Este cambio te dejaría sin acceso a esta página: la cadena input descartaría el puerto de la gestión web. Añade antes una regla que lo acepte.';

function commit(server: Server, command: string): Outcome {
  const r = nftEdit(server.kernel.netfilter.ruleset, command);
  if (!r.ok) return { error: r.error };
  if (locksOut(server, r.ruleset) && !locksOut(server)) return { error: LOCKOUT };
  applyAndSave(server, r.ruleset);
  return SAVED;
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
  if (!KEY.test(target)) return { error: 'Elige la cadena.' };
  const form: RuleForm = {
    iif: f.get('iif')?.trim() || undefined, oif: f.get('oif')?.trim() || undefined, saddr: f.get('saddr')?.trim() || undefined, daddr: f.get('daddr')?.trim() || undefined,
    proto: (['tcp', 'udp', 'icmp'].includes(f.get('proto') ?? '') ? f.get('proto') : '') as RuleForm['proto'], dport: f.get('dport')?.trim() || undefined,
    ct: ['new', 'established', 'related', 'invalid'].filter((s) => f.has(`ct_${s}`)), action: (f.get('ruleAction') ?? 'accept') as FormAction,
    to: f.get('to')?.trim() || undefined, counter: f.has('counter'), log: f.get('log') || undefined, comment: f.get('comment') || undefined,
  };
  if (!['accept', 'drop', 'reject', 'masquerade', 'snat', 'dnat'].includes(form.action)) return { error: 'Acción no válida.' };
  const body = ruleFromForm(form);
  if (typeof body !== 'string') return { error: `Revisa el campo «${body.error}».` };
  return commit(server, `${f.has('top') ? 'insert' : 'add'} rule ${target} ${body}`);
}

function chainAdd(server: Server, f: Fields): Outcome {
  const k = parseKey(f);
  const name = (f.get('name') ?? '').trim();
  if (!k || !NAME.test(name)) return { error: 'Revisa la tabla y el nombre de la cadena.' };
  const type = f.get('type') ?? '';
  const prio = (f.get('priority') ?? '0').trim();
  if (type && (!['filter', 'nat'].includes(type) || !/^-?\d{1,4}$/.test(prio))) return { error: 'Revisa el tipo y la prioridad.' };
  const spec = type ? ` { type ${type} hook ${f.get('hook') ?? 'input'} priority ${prio}; policy ${f.get('policy') === 'drop' ? 'drop' : 'accept'}; }` : '';
  return commit(server, `add chain ${k.family} ${k.table} ${name}${spec}`);
}

function policy(server: Server, f: Fields): Outcome {
  const k = parseKey(f);
  const t = k ? server.kernel.netfilter.ruleset.tables.find((x) => x.family === k.family && x.name === k.table) : undefined;
  const b = t?.chains.find((c) => c.name === k?.chain)?.base;
  if (!k || !b) return { error: 'Cadena no encontrada.' };
  return commit(server, `add chain ${k.family} ${k.table} ${k.chain ?? ''} { type ${b.type} hook ${b.hook} priority ${b.priority}; policy ${f.get('policy') === 'drop' ? 'drop' : 'accept'}; }`);
}

function template(server: Server, f: Fields): Outcome {
  const text = NFT_TEMPLATES[f.get('template') ?? ''];
  if (!text) return { error: 'Elige una plantilla.' };
  const r = runNft(EMPTY_RULESET, text);
  if (!r.ok) return { error: r.error };
  const kept = keepAccess(server, r.ruleset);
  applyAndSave(server, kept.ruleset);
  return kept.added ? { ok: `Plantilla aplicada. Se ha añadido una regla que acepta el puerto ${adminPort(server)} para no perder el acceso a esta página.` } : SAVED;
}

function move(server: Server, f: Fields, delta: -1 | 1): Outcome {
  const k = parseKey(f);
  if (!k?.chain || k.handle === undefined) return { error: 'Regla no encontrada.' };
  const next = moveRule(server.kernel.netfilter.ruleset, k.family, k.table, k.chain, k.handle, delta);
  if (locksOut(server, next) && !locksOut(server)) return { error: LOCKOUT };
  applyAndSave(server, next);
  return SAVED;
}

function routeAdd(server: Server, f: Fields): Outcome {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec((f.get('to') ?? '').trim());
  const net = m ? parseIp(m[1] ?? '') : null;
  const via = parseIp((f.get('via') ?? '').trim());
  const prefix = Number(m?.[2]);
  const reachable = via !== null && server.nics().some((n) => n.ip !== undefined && n.prefix !== undefined && inSubnet(via, n.ip, n.prefix));
  if (net === null || via === null || prefix > 32 || !reachable) return { error: 'Ruta no válida: red CIDR y un siguiente salto alcanzable por una interfaz.' };
  const r = routeTo(net, prefix, via);
  server.setStaticRoutes([...server.staticRoutes.filter((x) => !(x.net === r.net && x.prefix === r.prefix)), r]);
  return SAVED;
}

/** Runs a "Seguridad" action; null when `action` is not one of them. */
export function securityAction(server: Server, f: Fields): Outcome | null {
  const k = parseKey(f);
  switch (f.get('action')) {
    case 'fw-service': setFirewallActive(server, f.has('enabled')); return SAVED;
    case 'fw-template': return template(server, f);
    case 'fw-table-add': return NAME.test((f.get('name') ?? '').trim()) ? commit(server, `add table ${f.get('family') === 'ip' ? 'ip' : 'inet'} ${(f.get('name') ?? '').trim()}`) : { error: 'Nombre de tabla no válido.' };
    case 'fw-table-del': return k ? commit(server, `delete table ${k.family} ${k.table}`) : { error: 'Tabla no encontrada.' };
    case 'fw-chain-add': return chainAdd(server, f);
    case 'fw-chain-del': return k?.chain ? commit(server, `flush chain ${k.family} ${k.table} ${k.chain}\ndelete chain ${k.family} ${k.table} ${k.chain}`) : { error: 'Cadena no encontrada.' };
    case 'fw-policy': return policy(server, f);
    case 'fw-rule-add': return ruleAdd(server, f);
    case 'fw-rule-del': return k?.chain && k.handle !== undefined ? commit(server, `delete rule ${k.family} ${k.table} ${k.chain} handle ${k.handle}`) : { error: 'Regla no encontrada.' };
    case 'fw-rule-up': return move(server, f, -1);
    case 'fw-rule-down': return move(server, f, 1);
    case 'sysctl-set': { const err = saveSysctl(server, (f.get('key') ?? '').trim(), (f.get('value') ?? '').trim()); return err ? { error: err } : SAVED; }
    case 'route-add': return routeAdd(server, f);
    case 'route-del': { const to = (f.get('key') ?? '').trim(); server.setStaticRoutes(server.staticRoutes.filter((r) => `${formatIp(r.net)}/${r.prefix}` !== to)); return SAVED; }
    default: return null;
  }
}
