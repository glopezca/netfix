/**
 * "Seguridad" tab of the management GUI (WRT300N style): nftables firewall (tables, chains, rules,
 * templates) and routing (ip_forward, sysctl, static routes). Same editing code as the Services tab.
 */
import type { Server } from '../devices/server.ts';
import type { Chain, Rule, Ruleset, Table, Value } from '../net/nft/model.ts';
import { ruleText } from '../net/nft/format.ts';
import { runNft } from '../net/nft/apply.ts';
import { firewallStatus } from '../shells/firewall-save.ts';
import { SYSCTL_KEYS } from '../net/sysctl.ts';
import { formatIp } from '../core/ip.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, check, choose, form, row, section, text } from './admin-layout.ts';

const del = (base: string, pageId: string, action: string, key: string, label = 'Borrar'): Markup =>
  form(base, pageId, action, h('input', { type: 'hidden', name: 'key', value: key }), h('button', { type: 'submit', class: 'web-wrt-small' }, label));

/** Port the management GUI needs (its own port, or Apache's 80 when it lives under an alias). */
export function adminPort(server: Server): number {
  const a = server.services.webapps.admin;
  return a.mode === 'port' ? a.port : 80;
}

/** True when an input chain drops by default and no accepting rule names the GUI's port. */
export function locksOut(server: Server, rs: Ruleset = server.kernel.netfilter.ruleset): boolean {
  const port = adminPort(server);
  const names = (v: Value): boolean => (v.kind === 'num' ? v.n === port : v.kind === 'range' ? v.from <= port && port <= v.to : v.kind === 'set' && v.items.some(names));
  return rs.tables.some((t) => t.chains.some((c) => c.base?.hook === 'input' && c.base.policy === 'drop'
    && !c.rules.some((r) => r.verdict?.kind === 'accept' && r.matches.some((m) => m.field.endsWith('dport') && !m.negate && names(m.value)))));
}

function ruleRows(server: Server, base: string, tb: Table, ch: Chain): Markup {
  const key = (r: Rule): string => `${tb.family} ${tb.name} ${ch.name} ${r.handle}`;
  const rows = ch.rules.map((r) => h('tr', {},
    h('td', { class: 'web-wrt-mono' }, ruleText(r, tb.family, server.kernel.netfilter.counters)),
    h('td', {}, del(base, 'firewall', 'fw-rule-up', key(r), '↑'), del(base, 'firewall', 'fw-rule-down', key(r), '↓'), del(base, 'firewall', 'fw-rule-del', key(r)))));
  return h('table', { class: 'web-wrt-list' }, h('tr', {}, h('th', {}, 'Regla'), h('th', {}, '')), rows.length ? rows : h('tr', {}, h('td', { colspan: 2 }, 'Sin reglas: se aplica la política.')));
}

function chainSection(server: Server, base: string, tb: Table, ch: Chain): Markup {
  const b = ch.base;
  const head = b ? `type ${b.type} hook ${b.hook} priority ${b.priority}` : 'cadena normal';
  const policy = b ? form(base, 'firewall', 'fw-policy', h('input', { type: 'hidden', name: 'key', value: `${tb.family} ${tb.name} ${ch.name}` }),
    row('Política', choose('policy', b.policy, [['accept', 'accept'], ['drop', 'drop']])), h('button', { type: 'submit', class: 'web-wrt-small' }, 'Cambiar')) : null;
  return section(`${tb.family} ${tb.name} · ${ch.name}`, head, policy, ruleRows(server, base, tb, ch), del(base, 'firewall', 'fw-chain-del', `${tb.family} ${tb.name} ${ch.name}`, 'Borrar cadena'));
}

function ruleForm(server: Server, base: string): Markup {
  const chains = server.kernel.netfilter.ruleset.tables.flatMap((tb) => tb.chains.map((c) => [`${tb.family} ${tb.name} ${c.name}`, `${tb.family} ${tb.name} · ${c.name}`] as const));
  return form(base, 'firewall', 'fw-rule-add', h('table', {}, section('Nueva regla', 'Se añade al final (o al principio) de la cadena elegida y se guarda en /etc/nftables.conf.',
    row('Cadena', choose('target', chains[0]?.[0] ?? '', chains)), row('Acción', choose('ruleAction', 'accept', ['accept', 'drop', 'reject', 'masquerade', 'snat', 'dnat'].map((a) => [a, a] as const))),
    row('Interfaz de entrada', text('iif', '', { placeholder: 'eth1' })), row('Interfaz de salida', text('oif', '', { placeholder: 'eth0' })),
    row('Origen', text('saddr', '', { placeholder: '192.168.1.0/24' })), row('Destino', text('daddr', '')),
    row('Protocolo', choose('proto', '', [['', 'Cualquiera'], ['tcp', 'tcp'], ['udp', 'udp'], ['icmp', 'icmp']])), row('Puerto destino', text('dport', '', { placeholder: '22' })),
    row('Traducir a', text('to', '', { placeholder: '172.16.0.80:80' })), row('Prefijo de log', text('log', '')), row('Comentario', text('comment', '')),
    check('ct_new', false, 'new'), check('ct_established', false, 'established'), check('ct_related', false, 'related'), check('ct_invalid', false, 'invalid'),
    check('counter', true, 'Contador'), check('top', false, 'Al principio'))), buttons());
}

export function firewallPage(server: Server, base: string): Child {
  if (server.os !== 'linux') return h('tr', {}, h('td', {}, 'El cortafuegos nftables solo está en los equipos Ubuntu.'));
  const st = firewallStatus(server);
  const rs = server.kernel.netfilter.ruleset;
  const listed = runNft(rs, 'list ruleset');
  return [
    form(base, 'firewall', 'fw-service', h('table', {}, section('Cortafuegos', 'nftables.service carga /etc/nftables.conf al arrancar. Los cambios de esta página se aplican y se guardan.',
      check('enabled', st.active, 'Activado'), st.saved ? null : h('p', { class: 'web-wrt-error' }, 'Hay cambios hechos con «nft» sin guardar.'),
      locksOut(server) ? h('p', { class: 'web-wrt-error' }, 'Cuidado: la cadena input descarta por defecto y ninguna regla acepta el puerto de esta página: podrías perder el acceso.') : null)), buttons()),
    form(base, 'firewall', 'fw-template', h('table', {}, section('Plantilla', 'Sustituye todas las reglas.',
      choose('template', '', [['', '—'], ['hardening', 'Servidor bastionado'], ['router', 'Router con NAT por eth0'], ['open', 'Todo permitido']]))), buttons()),
    ...rs.tables.flatMap((tb) => [section(`table ${tb.family} ${tb.name}`, '', del(base, 'firewall', 'fw-table-del', `${tb.family} ${tb.name}`, 'Borrar tabla')), ...tb.chains.map((ch) => chainSection(server, base, tb, ch))]),
    form(base, 'firewall', 'fw-table-add', h('table', {}, section('Nueva tabla', 'Familia inet (IPv4 e IPv6) o ip.', row('Familia', choose('family', 'inet', [['inet', 'inet'], ['ip', 'ip']])), row('Nombre', text('name', '', { placeholder: 'filter' })))), buttons()),
    form(base, 'firewall', 'fw-chain-add', h('table', {}, section('Nueva cadena', 'Las cadenas base se enganchan a un punto del recorrido de los paquetes.',
      row('Tabla', choose('table', rs.tables[0] ? `${rs.tables[0].family} ${rs.tables[0].name}` : '', rs.tables.map((tb) => [`${tb.family} ${tb.name}`, `${tb.family} ${tb.name}`] as const))),
      row('Nombre', text('name', '')), row('Tipo', choose('type', 'filter', [['filter', 'filter'], ['nat', 'nat'], ['', 'normal']])),
      row('Gancho', choose('hook', 'input', ['input', 'forward', 'output', 'prerouting', 'postrouting'].map((x) => [x, x] as const))), row('Prioridad', text('priority', '0')),
      row('Política', choose('policy', 'accept', [['accept', 'accept'], ['drop', 'drop']])))), buttons()),
    ruleForm(server, base),
    section('nft list ruleset', '', h('pre', { class: 'web-wrt-log' }, listed.ok ? listed.output.join('\n') || '(vacío)' : '')),
  ];
}

export function routingPage(server: Server, base: string): Child {
  if (server.os !== 'linux') return h('tr', {}, h('td', {}, 'Solo en los equipos Ubuntu.'));
  const sysctl = server.kernel.sysctl;
  const keys = SYSCTL_KEYS.filter((k) => k.effect || k.name.startsWith('net.ipv4.conf.all'));
  const routes = server.staticRoutes.map((r) => h('tr', {}, h('td', { class: 'web-wrt-mono' }, `${formatIp(r.net)}/${r.prefix}`), h('td', { class: 'web-wrt-mono' }, formatIp(r.via)),
    h('td', {}, del(base, 'routing', 'route-del', `${formatIp(r.net)}/${r.prefix}`))));
  return [
    ...keys.map((k) => form(base, 'routing', 'sysctl-set', h('input', { type: 'hidden', name: 'key', value: k.name }),
      h('table', {}, section(k.name, k.effect ? 'Cambia el comportamiento en Netfix.' : 'Se guarda (sin efecto en Netfix).',
        Array.isArray(k.accepts) ? choose('value', sysctl.get(k.name) ?? '', k.accepts.map((v) => [v, v] as const)) : text('value', sysctl.get(k.name) ?? ''))), buttons())),
    section('Rutas estáticas', 'Redes que se alcanzan por otro router.', h('table', { class: 'web-wrt-list' }, h('tr', {}, h('th', {}, 'Red'), h('th', {}, 'Siguiente salto'), h('th', {}, '')), routes.length ? routes : h('tr', {}, h('td', { colspan: 3 }, 'Sin rutas.')))),
    form(base, 'routing', 'route-add', h('table', {}, section('Nueva ruta', 'Red en formato CIDR y siguiente salto alcanzable.', row('Red', text('to', '', { placeholder: '10.0.0.0/8' })), row('Siguiente salto', text('via', '')))), buttons()),
  ];
}
