/** Pages of the Server management GUI (forms filled with the live configuration). */
import { t } from '../i18n/t.ts';
import { sshAuthMethods } from '../services/ssh-auth-settings.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { cards, section, row, text, check, choose, form, buttons } from './admin-layout.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { UNITS, unitActive } from '../services/units.ts';
import type { WebAppAccess } from '../services/config.ts';
import { idKinds, identifierText } from '../services/dhcp-reservations.ts';
import { formatMacCisco, formatHexId } from '../core/mac.ts';
import { listenForm } from './admin-listen.ts';

const ip = (n: number | undefined): string => (n === undefined ? '' : formatIp(n));

function del(base: string, pageId: string, action: string, key: string): Markup {
  return form(base, pageId, action, h('input', { type: 'hidden', name: 'key', value: key }), h('button', { type: 'submit', class: 'web-adm-small' }, t('wa.remove')));
}

function table(head: readonly string[], rows: readonly (readonly Child[])[], empty: string): Markup {
  if (!rows.length) return h('p', { class: 'web-adm-muted' }, empty);
  return h('table', { class: 'web-adm-grid' }, h('tr', {}, head.map((c) => h('th', {}, c))), rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))));
}

export function setupPage(server: Server, base: string): Child {
  const c = server.config;
  return form(base, 'setup', 'setup', h('table', {},
    section(t('wa.name'), t('wa.hostnameHelp'), row(t('wa.hostname'), text('hostname', server.name))),
    section(t('wa.internet'), t('wa.internetHelp'),
      row(t('wa.connType'), choose('mode', c.mode, [['static', t('wa.staticIp')], ['dhcp', t('wa.autoDhcp')]])),
      row(t('wa.ip'), text('ip', ip(c.ip))), row(t('wa.mask'), text('mask', c.prefix !== undefined ? formatMask(c.prefix) : '')),
      row(t('wa.gateway'), text('gateway', ip(c.gateway))), row('DNS', text('dns', ip(c.dns))))), buttons());
}

function reservations(server: Server, base: string): Child {
  const pools = server.services.dhcp.pools;
  const rows = pools.flatMap((p) => p.reservations.map((r) => [p.name, formatIp(r.ip), identifierText(r), r.name ?? '', del(base, 'dhcp', 'res-del', `${p.name}|${formatIp(r.ip)}`)]));
  return [
    cards(section(t('wa.reservations'), t('wa.resHelp'), table(['Pool', 'IP', t('wa.identifier'), t('wa.description'), ''], rows, t('wa.noRes')))),
    pools.length ? form(base, 'dhcp', 'res-add', cards(section(t('wa.newRes'), t('wa.newResHelp'),
      row('Pool', choose('pool', pools[0]?.name ?? '', pools.map((p) => [p.name, p.name]))), row(t('wa.reservedIp'), text('ip', '')),
      row(t('wa.identifyBy'), choose('kind', 'mac', idKinds().map(([v, l]) => [v, l]))), row(t('wa.macOrId'), text('id', '')), row(t('wa.description'), text('name', '')))), buttons()) : null,
  ];
}

function leases(server: Server, base: string): Child {
  const list = server.dhcpEngine.allBindings(server.clock.now()).filter((b) => b.type === 'Automatic');
  const reserve = (ipText: string, by: 'mac' | 'client-id', label: string): Child => form(base, 'dhcp', 'lease-reserve',
    h('input', { type: 'hidden', name: 'ip', value: ipText }), h('input', { type: 'hidden', name: 'by', value: by }), h('button', { type: 'submit', class: 'web-adm-small' }, label));
  const rows = list.map((b) => [formatIp(b.ip), formatMacCisco(b.mac), b.clientId ? formatHexId(b.clientId) : '—', b.hostname ?? '',
    [reserve(formatIp(b.ip), 'mac', t('wa.reserveMac')), b.clientId ? reserve(formatIp(b.ip), 'client-id', t('wa.reserveId')) : null]]);
  return cards(section(t('wa.leases'), t('wa.leasesHelp'), table(['IP', 'MAC', 'Client-ID', t('wa.device'), ''], rows, t('wa.noLeases'))));
}

export function dhcpPage(server: Server, base: string): Child {
  const d = server.services.dhcp;
  const rows = d.pools.map((p) => [p.name, formatIp(p.start), String(p.maxUsers), ip(p.gateway), ip(p.dns), del(base, 'dhcp', 'pool-del', p.name)]);
  return [
    form(base, 'dhcp', 'dhcp', cards(section(t('wa.dhcpServer'), t('wa.dhcpHelp'), check('enabled', d.enabled, t('wa.enabled')))), buttons()),
    listenForm(server, base, 'dhcp'),
    cards(section(t('wa.pools'), t('wa.poolsHelp'), table([t('wa.name'), t('wa.start'), t('wa.users'), t('wa.gateway'), 'DNS', ''], rows, t('wa.noPools')))),
    form(base, 'dhcp', 'pool-add', cards(section(t('wa.newPool'), t('wa.newPoolHelp'),
      row(t('wa.name'), text('name', '')), row(t('wa.start'), text('start', '')), row(t('wa.maskShort'), text('mask', '255.255.255.0')), row(t('wa.maxUsers'), text('max', '50')),
      row(t('wa.gateway'), text('gateway', '')), row('DNS', text('dns', '')), row(t('wa.domain'), text('domain', '')),
      row(t('wa.leasesBy'), choose('identify', 'client-id', [['client-id', t('wa.byIdOrMac')], ['mac', 'MAC']])))), buttons()),
    reservations(server, base),
    leases(server, base),
  ];
}

function accessRows(prefix: string, a: WebAppAccess): Child {
  return [check(`${prefix}_enabled`, a.enabled, t('wa.enabled')), row(t('wa.access'), choose(`${prefix}_mode`, a.mode, [['alias', t('wa.aliasMode')], ['port', t('wa.portMode')]])),
    row(t('wa.alias'), text(`${prefix}_alias`, a.alias)), row(t('wa.port'), text(`${prefix}_port`, String(a.port)))];
}

export function webPage(server: Server, base: string): Child {
  const s = server.services;
  return form(base, 'web', 'web', h('table', {},
    section(t('wa.webServer'), t('wa.webHelp'), check('http', s.http.enabled, t('wa.enabled'))),
    section('Roundcube', t('wa.rcHelp'), accessRows('rc', s.webapps.roundcube))), buttons());
}

function accounts(base: string, pageId: string, list: readonly { name: string }[]): Child {
  return [
    cards(section(t('wa.users'), t('wa.accountsHelp'), table([t('wa.user'), ''], list.map((u) => [u.name, del(base, pageId, 'user-del', u.name)]), t('wa.noUsers')))),
    form(base, pageId, 'user-add', cards(section(t('wa.newUser'), t('wa.userRule'), row(t('wa.user'), text('name', '')), row(t('wa.password'), h('input', { type: 'password', name: 'password' })))), buttons()),
  ];
}

export function mailPage(server: Server, base: string): Child {
  const m = server.services.mail;
  return [form(base, 'mail', 'mail', cards(section(t('wa.mail'), t('wa.mailHelp'),
    check('smtp', m.smtp, 'SMTP (25)'), check('pop3', m.pop3, 'POP3 (110)'), check('imap', m.imap, 'IMAP (143)'), row(t('wa.domain'), text('domain', m.domain)))), buttons()), accounts(base, 'mail', m.users)];
}

export function sshPage(server: Server, base: string): Child {
  const s = server.services.ssh;
  const auth = sshAuthMethods(server);
  const methods = auth ? [section(t('wa.auth'), t('wa.authHelp'),
    h('input', { type: 'hidden', name: 'auth', value: '1' }), check('password', auth.password, t('wa.authPassword')),
    check('pubkey', auth.pubkey, t('wa.authPubkey')))] : [];
  return [form(base, 'ssh', 'ssh', cards(section('SSH', t('wa.sshHelp'), check('enabled', s.enabled, t('wa.enabled'))), ...methods), buttons()), accounts(base, 'ssh', s.users)];
}

export function adminPage(server: Server, base: string): Child {
  const a = server.services.webapps.admin;
  return form(base, 'admin', 'admin', h('table', {},
    section(t('wa.routerAccess'), t('wa.routerAccessHelp'), row(t('wa.user'), text('user', a.user)), row(t('wa.password'), h('input', { type: 'password', name: 'password', placeholder: t('wa.unchanged') }))),
    section(t('wa.webAdmin'), t('wa.webAdminHelp'), row(t('wa.access'), choose('mode', a.mode, [['port', t('wa.portMode')], ['alias', t('wa.aliasMode')]])),
      row(t('wa.port'), text('port', String(a.port))), row(t('wa.alias'), text('alias', a.alias)))), buttons());
}

export function statusPage(server: Server): Child {
  const c = server.config;
  const leases = server.dhcpEngine.allBindings(server.clock.now()).map((b) => [formatIp(b.ip), b.mac.match(/../g)?.join(':') ?? b.mac, b.hostname ?? '', b.type]);
  return h('table', {},
    section(t('wa.device'), t('wa.deviceHelp'), table([t('wa.field'), t('wa.value')], [[t('wa.name'), server.name], [t('wa.system'), server.os === 'windows' ? 'Windows Server' : 'Ubuntu 26.04 LTS'], ['MAC', server.mac.match(/../g)?.join(':') ?? ''],
      [t('wa.ip'), ip(c.ip)], [t('wa.maskShort'), c.prefix !== undefined ? formatMask(c.prefix) : ''], [t('wa.gateway'), ip(c.gateway)], ['DNS', ip(c.dns)], [t('wa.mode'), c.mode === 'dhcp' ? 'DHCP' : t('wa.static')]], '')),
    section(t('wa.services'), t('wa.servicesHelp'), table([t('wa.service'), t('wa.state')], UNITS.map((u) => [u.linux, unitActive(server.services, u.id) ? t('wa.active') : t('wa.stopped')]), '')),
    section(t('wa.dhcpLeases'), t('wa.dhcpLeasesHelp'), table(['IP', 'MAC', t('wa.name'), t('wa.type')], leases, t('wa.noDhcpLeases'))));
}

export function logPage(server: Server): Child {
  const lines = server.logs.slice(-40).map((l) => `${new Date(l.time).toISOString().slice(11, 19)} ${l.unit}: ${l.line}`);
  return cards(section(t('wa.records'), t('wa.logHelp'), h('pre', { class: 'web-adm-log' }, lines.join('\n') || t('wa.empty'))));
}
