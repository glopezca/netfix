/**
 * "Seguridad" tab of the management GUI (WRT300N style): nftables firewall (tables, chains, rules,
 * templates) and routing (ip_forward, sysctl, static routes). Same editing code as the Services tab.
 */
import { t } from '../i18n/t.ts';
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

const del = (base: string, pageId: string, action: string, key: string, label = t('fwa.delete')): Markup =>
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
  return h('table', { class: 'web-wrt-list' }, h('tr', {}, h('th', {}, t('fwa.rule')), h('th', {}, '')), rows.length ? rows : h('tr', {}, h('td', { colspan: 2 }, t('fwa.noRules'))));
}

function chainSection(server: Server, base: string, tb: Table, ch: Chain): Markup {
  const b = ch.base;
  const head = b ? `type ${b.type} hook ${b.hook} priority ${b.priority}` : t('fwa.regular');
  const policy = b ? form(base, 'firewall', 'fw-policy', h('input', { type: 'hidden', name: 'key', value: `${tb.family} ${tb.name} ${ch.name}` }),
    row(t('fwa.policy'), choose('policy', b.policy, [['accept', 'accept'], ['drop', 'drop']])), h('button', { type: 'submit', class: 'web-wrt-small' }, t('fwa.change'))) : null;
  return section(`${tb.family} ${tb.name} · ${ch.name}`, head, policy, ruleRows(server, base, tb, ch), del(base, 'firewall', 'fw-chain-del', `${tb.family} ${tb.name} ${ch.name}`, t('fwa.delChain')));
}

function ruleForm(server: Server, base: string): Markup {
  const chains = server.kernel.netfilter.ruleset.tables.flatMap((tb) => tb.chains.map((c) => [`${tb.family} ${tb.name} ${c.name}`, `${tb.family} ${tb.name} · ${c.name}`] as const));
  return form(base, 'firewall', 'fw-rule-add', h('table', {}, section(t('fwa.newRule'), t('fwa.newRuleHelp'),
    row(t('fwa.chain'), choose('target', chains[0]?.[0] ?? '', chains)), row(t('fwa.action'), choose('ruleAction', 'accept', ['accept', 'drop', 'reject', 'masquerade', 'snat', 'dnat'].map((a) => [a, a] as const))),
    row(t('fwa.iif'), text('iif', '', { placeholder: 'eth1' })), row(t('fwa.oif'), text('oif', '', { placeholder: 'eth0' })),
    row(t('fwa.saddr'), text('saddr', '', { placeholder: '192.168.1.0/24' })), row(t('fwa.daddr'), text('daddr', '')),
    row(t('fwa.proto'), choose('proto', '', [['', t('fwa.any')], ['tcp', 'tcp'], ['udp', 'udp'], ['icmp', 'icmp']])), row(t('fwa.dport'), text('dport', '', { placeholder: '22' })),
    row(t('fwa.to'), text('to', '', { placeholder: '172.16.0.80:80' })), row(t('fwa.log'), text('log', '')), row(t('fwa.comment'), text('comment', '')),
    check('ct_new', false, 'new'), check('ct_established', false, 'established'), check('ct_related', false, 'related'), check('ct_invalid', false, 'invalid'),
    check('counter', true, t('fwa.counter')), check('top', false, t('fwa.top')))), buttons());
}

export function firewallPage(server: Server, base: string): Child {
  if (server.os !== 'linux') return h('tr', {}, h('td', {}, t('fwa.ubuntuOnly')));
  const st = firewallStatus(server);
  const rs = server.kernel.netfilter.ruleset;
  const listed = runNft(rs, 'list ruleset');
  return [
    form(base, 'firewall', 'fw-service', h('table', {}, section(t('fwa.firewall'), t('fwa.serviceHelp'),
      check('enabled', st.active, t('fwa.enabled')), st.saved ? null : h('p', { class: 'web-wrt-error' }, t('fwa.unsaved')),
      locksOut(server) ? h('p', { class: 'web-wrt-error' }, t('fwa.lockWarn')) : null)), buttons()),
    form(base, 'firewall', 'fw-template', h('table', {}, section(t('fwa.template'), t('fwa.templateHelp'),
      choose('template', '', [['', '—'], ['hardening', t('fwa.tplHardening')], ['router', t('fwa.tplRouter')], ['open', t('fwa.tplOpen')]]))), buttons()),
    ...rs.tables.flatMap((tb) => [section(`table ${tb.family} ${tb.name}`, '', del(base, 'firewall', 'fw-table-del', `${tb.family} ${tb.name}`, t('fwa.delTable'))), ...tb.chains.map((ch) => chainSection(server, base, tb, ch))]),
    form(base, 'firewall', 'fw-table-add', h('table', {}, section(t('fwa.newTable'), t('fwa.familyHelp'), row(t('fwa.family'), choose('family', 'inet', [['inet', 'inet'], ['ip', 'ip']])), row(t('fwa.name'), text('name', '', { placeholder: 'filter' })))), buttons()),
    form(base, 'firewall', 'fw-chain-add', h('table', {}, section(t('fwa.newChain'), t('fwa.newChainHelp'),
      row(t('fwa.table'), choose('table', rs.tables[0] ? `${rs.tables[0].family} ${rs.tables[0].name}` : '', rs.tables.map((tb) => [`${tb.family} ${tb.name}`, `${tb.family} ${tb.name}`] as const))),
      row(t('fwa.name'), text('name', '')), row(t('fwa.type'), choose('type', 'filter', [['filter', 'filter'], ['nat', 'nat'], ['', 'normal']])),
      row(t('fwa.hook'), choose('hook', 'input', ['input', 'forward', 'output', 'prerouting', 'postrouting'].map((x) => [x, x] as const))), row(t('fwa.priority'), text('priority', '0')),
      row(t('fwa.policy'), choose('policy', 'accept', [['accept', 'accept'], ['drop', 'drop']])))), buttons()),
    ruleForm(server, base),
    section('nft list ruleset', '', h('pre', { class: 'web-wrt-log' }, listed.ok ? listed.output.join('\n') || t('fwa.empty') : '')),
  ];
}

export function routingPage(server: Server, base: string): Child {
  if (server.os !== 'linux') return h('tr', {}, h('td', {}, t('fwa.onlyUbuntu')));
  const sysctl = server.kernel.sysctl;
  const keys = SYSCTL_KEYS.filter((k) => k.effect || k.name.startsWith('net.ipv4.conf.all'));
  const routes = server.staticRoutes.map((r) => h('tr', {}, h('td', { class: 'web-wrt-mono' }, `${formatIp(r.net)}/${r.prefix}`), h('td', { class: 'web-wrt-mono' }, formatIp(r.via)),
    h('td', {}, del(base, 'routing', 'route-del', `${formatIp(r.net)}/${r.prefix}`))));
  return [
    form(base, 'routing', 'router-enable', h('table', {}, section(t('fwa.routerTitle'), t('fwa.routerHelp'),
      check('enabled', sysctl.enabled('net.ipv4.ip_forward'), t('fwa.router')))), buttons()),
    ...keys.map((k) => form(base, 'routing', 'sysctl-set', h('input', { type: 'hidden', name: 'key', value: k.name }),
      h('table', {}, section(k.name, k.effect ? t('fwa.effect') : t('fwa.noEffect'),
        Array.isArray(k.accepts) ? choose('value', sysctl.get(k.name) ?? '', k.accepts.map((v) => [v, v] as const)) : text('value', sysctl.get(k.name) ?? ''))), buttons())),
    section(t('fwa.routes'), t('fwa.routesHelp'), h('table', { class: 'web-wrt-list' }, h('tr', {}, h('th', {}, t('fwa.net')), h('th', {}, t('fwa.via')), h('th', {}, '')), routes.length ? routes : h('tr', {}, h('td', { colspan: 3 }, t('fwa.noRoutes'))))),
    form(base, 'routing', 'route-add', h('table', {}, section(t('fwa.newRoute'), t('fwa.newRouteHelp'), row(t('fwa.net'), text('to', '', { placeholder: '10.0.0.0/8' })), row(t('fwa.via'), text('via', '')))), buttons()),
  ];
}
