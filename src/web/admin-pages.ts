/** Pages of the Server-PT management GUI (forms filled with the live configuration). */
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { section, row, text, check, choose, form, buttons } from './admin-layout.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { UNITS, unitActive } from '../services/units.ts';
import type { WebAppAccess } from '../services/config.ts';

const ip = (n: number | undefined): string => (n === undefined ? '' : formatIp(n));

function del(base: string, pageId: string, action: string, key: string): Markup {
  return form(base, pageId, action, h('input', { type: 'hidden', name: 'key', value: key }), h('button', { type: 'submit', class: 'web-wrt-small' }, 'Eliminar'));
}

function table(head: readonly string[], rows: readonly (readonly Child[])[], empty: string): Markup {
  if (!rows.length) return h('p', { class: 'web-wrt-muted' }, empty);
  return h('table', { class: 'web-wrt-grid' }, h('tr', {}, head.map((c) => h('th', {}, c))), rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))));
}

export function setupPage(server: Server, base: string): Child {
  const c = server.config;
  return form(base, 'setup', 'setup', h('table', {},
    section('Nombre', 'Nombre de host del servidor (RFC 1123).', row('Nombre de host', text('hostname', server.name))),
    section('Dirección de Internet', 'DHCP: el servidor pide su dirección. Estática: escríbela tú.',
      row('Tipo de conexión', choose('mode', c.mode, [['static', 'IP estática'], ['dhcp', 'Configuración automática - DHCP']])),
      row('Dirección IP', text('ip', ip(c.ip))), row('Máscara de subred', text('mask', c.prefix !== undefined ? formatMask(c.prefix) : '')),
      row('Puerta de enlace', text('gateway', ip(c.gateway))), row('DNS', text('dns', ip(c.dns))))), buttons());
}

export function dhcpPage(server: Server, base: string): Child {
  const d = server.services.dhcp;
  const rows = d.pools.map((p) => [p.name, formatIp(p.start), String(p.maxUsers), ip(p.gateway), ip(p.dns), del(base, 'dhcp', 'pool-del', p.name)]);
  return [
    form(base, 'dhcp', 'dhcp', h('table', {}, section('Servidor DHCP', 'Activa o para kea-dhcp4-server.', check('enabled', d.enabled, 'Activado'))), buttons()),
    h('table', {}, section('Pools', 'Rangos de direcciones que reparte el servidor.', table(['Nombre', 'IP inicial', 'Usuarios', 'Puerta de enlace', 'DNS', ''], rows, 'Sin pools.'))),
    form(base, 'dhcp', 'pool-add', h('table', {}, section('Nuevo pool', 'IP inicial y número máximo de usuarios, como en Packet Tracer.',
      row('Nombre', text('name', '')), row('IP inicial', text('start', '')), row('Máscara', text('mask', '255.255.255.0')), row('Usuarios máximos', text('max', '50')),
      row('Puerta de enlace', text('gateway', '')), row('DNS', text('dns', '')), row('Dominio', text('domain', '')))), buttons()),
  ];
}

export function dnsPage(server: Server, base: string): Child {
  const d = server.services.dns;
  const rows = d.records.map((r, i) => [r.name, r.type, `${r.priority !== undefined ? `${r.priority} ` : ''}${r.value}`, String(r.ttl), del(base, 'dns', 'record-del', String(i))]);
  return [
    form(base, 'dns', 'dns', h('table', {}, section('Servidor DNS', 'bind9. Dominio de la zona para nombres relativos (@, www, *).',
      check('enabled', d.enabled, 'Activado'), row('Dominio de la zona', text('origin', d.origin ?? '')))), buttons()),
    h('table', {}, section('Registros', 'Registros de la zona.', table(['Nombre', 'Tipo', 'Valor', 'TTL', ''], rows, 'Sin registros.'))),
    form(base, 'dns', 'record-add', h('table', {}, section('Nuevo registro', 'A, CNAME, MX, NS o TXT. Prioridad solo para MX.',
      row('Nombre', text('name', '')), row('Tipo', choose('type', 'A', [['A', 'A'], ['CNAME', 'CNAME'], ['MX', 'MX'], ['NS', 'NS'], ['TXT', 'TXT']])),
      row('Valor', text('value', '')), row('Prioridad (MX)', text('priority', '10')))), buttons()),
  ];
}

function accessRows(prefix: string, a: WebAppAccess): Child {
  return [check(`${prefix}_enabled`, a.enabled, 'Activado'), row('Acceso', choose(`${prefix}_mode`, a.mode, [['alias', 'Alias URL en Apache'], ['port', 'Puerto propio']])),
    row('Alias URL', text(`${prefix}_alias`, a.alias)), row('Puerto', text(`${prefix}_port`, String(a.port)))];
}

export function webPage(server: Server, base: string): Child {
  const s = server.services;
  return form(base, 'web', 'web', h('table', {},
    section('Servidor web', 'Apache2 (Ubuntu) o IIS (Windows). La configuración de Apache está en /etc/apache2.', check('http', s.http.enabled, 'Activado')),
    section('Roundcube', 'Correo web sobre el IMAP y el SMTP de este servidor.', accessRows('rc', s.webapps.roundcube))), buttons());
}

function accounts(base: string, pageId: string, list: readonly { name: string }[]): Child {
  return [
    h('table', {}, section('Usuarios', 'Cuentas del servicio.', table(['Usuario', ''], list.map((u) => [u.name, del(base, pageId, 'user-del', u.name)]), 'Sin usuarios.'))),
    form(base, pageId, 'user-add', h('table', {}, section('Nuevo usuario', 'Letras, números, punto, guion o guion bajo.', row('Usuario', text('name', '')), row('Contraseña', h('input', { type: 'password', name: 'password' })))), buttons()),
  ];
}

export function mailPage(server: Server, base: string): Child {
  const m = server.services.mail;
  return [form(base, 'mail', 'mail', h('table', {}, section('Correo', 'postfix (SMTP) y dovecot (POP3, IMAP).',
    check('smtp', m.smtp, 'SMTP (25)'), check('pop3', m.pop3, 'POP3 (110)'), check('imap', m.imap, 'IMAP (143)'), row('Dominio', text('domain', m.domain)))), buttons()), accounts(base, 'mail', m.users)];
}

export function sshPage(server: Server, base: string): Child {
  const s = server.services.ssh;
  return [form(base, 'ssh', 'ssh', h('table', {}, section('SSH', 'OpenSSH: shell remota del servidor.', check('enabled', s.enabled, 'Activado'))), buttons()), accounts(base, 'ssh', s.users)];
}

export function adminPage(server: Server, base: string): Child {
  const a = server.services.webapps.admin;
  return form(base, 'admin', 'admin', h('table', {},
    section('Acceso al router', 'Usuario y contraseña de esta interfaz web.', row('Usuario', text('user', a.user)), row('Contraseña', h('input', { type: 'password', name: 'password', placeholder: 'sin cambios' }))),
    section('Gestión web', 'Puerto propio (independiente de Apache) o alias URL en Apache.', row('Acceso', choose('mode', a.mode, [['port', 'Puerto propio'], ['alias', 'Alias URL en Apache']])),
      row('Puerto', text('port', String(a.port))), row('Alias URL', text('alias', a.alias)))), buttons());
}

export function statusPage(server: Server): Child {
  const c = server.config;
  const leases = server.dhcpEngine.allBindings(server.clock.now()).map((b) => [formatIp(b.ip), b.mac.match(/../g)?.join(':') ?? b.mac, b.hostname ?? '', b.type]);
  return h('table', {},
    section('Equipo', 'Datos del servidor.', table(['Campo', 'Valor'], [['Nombre', server.name], ['Sistema', server.os === 'windows' ? 'Windows Server' : 'Ubuntu 26.04 LTS'], ['MAC', server.mac.match(/../g)?.join(':') ?? ''],
      ['Dirección IP', ip(c.ip)], ['Máscara', c.prefix !== undefined ? formatMask(c.prefix) : ''], ['Puerta de enlace', ip(c.gateway)], ['DNS', ip(c.dns)], ['Modo', c.mode === 'dhcp' ? 'DHCP' : 'Estática']], '')),
    section('Servicios', 'Estado de las unidades.', table(['Servicio', 'Estado'], UNITS.map((u) => [u.linux, unitActive(server.services, u.id) ? 'activo' : 'parado']), '')),
    section('Concesiones DHCP', 'Clientes con dirección asignada.', table(['IP', 'MAC', 'Nombre', 'Tipo'], leases, 'Sin concesiones.')));
}

export function logPage(server: Server): Child {
  const lines = server.logs.slice(-40).map((l) => `${new Date(l.time).toISOString().slice(11, 19)} ${l.unit}: ${l.line}`);
  return h('table', {}, section('Registros', 'Últimos mensajes de los servicios (journalctl).', h('pre', { class: 'web-wrt-log' }, lines.join('\n') || '(vacío)')));
}
