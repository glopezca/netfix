/** Server → Servicios → DHCP and DNS panels. */
import { el } from './dom.ts';
import { field, input, select, button, onOff, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { PtDhcpPool, DnsRecord, DnsRecordType } from '../services/config.ts';
import { DEFAULT_LEASE_MINUTES, DEFAULT_MAX_USERS, DEFAULT_TTL } from '../services/config.ts';
import { validatePool } from '../services/dhcp-pt.ts';
import { reservationsPanel, leasesPanel } from './server-dhcp-res.ts';
import { validateRecord } from '../services/dns-service.ts';
import { cleanOrigin, displayName, validateOrigin } from '../services/dns-names.ts';
import { formatIp, formatMask, parseIp, parseMask, networkOf } from '../core/ip.ts';

/** A panel that rebuilds itself after each change. */
export function livePanel(render: (refresh: () => void) => HTMLElement[]): HTMLElement {
  const root = el('div', { class: 'pane' });
  const refresh = (): void => root.replaceChildren(...render(refresh));
  refresh();
  return root;
}

const IDENTIFY: readonly (readonly [string, string])[] = [['client-id', 'Client-ID (opción 61) o, si no la envía, MAC'], ['mac', 'Dirección MAC']];

const ipOrEmpty = (n: number | undefined): string => (n === undefined ? '' : formatIp(n));

type PoolFields = ReturnType<typeof poolFields>;

function poolFields(server: Server, pool: PtDhcpPool | undefined) {
  const s = server.services;
  return {
    name: input({ value: pool?.name ?? (s.dhcp.pools.length ? '' : 'serverPool') }),
    start: input({ value: ipOrEmpty(pool?.start), placeholder: '192.168.1.100', inputmode: 'decimal' }),
    mask: input({ value: pool ? formatMask(pool.prefix) : '255.255.255.0', inputmode: 'decimal' }),
    max: input({ value: String(pool?.maxUsers ?? DEFAULT_MAX_USERS), inputmode: 'numeric' }),
    gw: input({ value: ipOrEmpty(pool?.gateway), inputmode: 'decimal' }),
    dns: input({ value: ipOrEmpty(pool?.dns ?? (s.dns.enabled ? server.config.ip : undefined)), inputmode: 'decimal' }),
    domain: input({ value: pool?.domain ?? '' }),
    tftp: input({ value: ipOrEmpty(pool?.tftp), inputmode: 'decimal' }),
    lease: input({ value: String(pool?.leaseMinutes ?? DEFAULT_LEASE_MINUTES), inputmode: 'numeric' }),
    identify: select(IDENTIFY, pool?.identifyBy ?? 'client-id'),
  };
}

function readPool(f: PoolFields, pool: PtDhcpPool | undefined): PtDhcpPool | string {
  const opt = (i: HTMLInputElement): number | undefined | null => (i.value.trim() ? parseIp(i.value.trim()) : undefined);
  const start = parseIp(f.start.value.trim());
  const prefix = parseMask(f.mask.value.trim());
  const vals = { gw: opt(f.gw), dns: opt(f.dns), tftp: opt(f.tftp) };
  if (start === null) return 'La IP inicial no es válida.';
  if (prefix === null) return 'La máscara no es válida.';
  if (Object.values(vals).some((v) => v === null)) return 'Revisa la puerta de enlace, el DNS o el TFTP (formato 192.168.1.1).';
  const maxUsers = Number(f.max.value);
  const lease = Number(f.lease.value);
  if (!Number.isInteger(maxUsers) || !Number.isInteger(lease) || lease < 1) return 'Usuarios máximos y concesión deben ser números enteros.';
  return { name: f.name.value.trim(), start, prefix, maxUsers, gateway: vals.gw ?? undefined, dns: vals.dns ?? undefined, tftp: vals.tftp ?? undefined, domain: f.domain.value.trim() || undefined, leaseMinutes: lease, reservations: pool?.reservations ?? [], identifyBy: f.identify.value === 'mac' ? 'mac' : undefined };
}

function poolsTable(pools: readonly PtDhcpPool[], editing: string | null, onSelect: (p: PtDhcpPool) => void, onDelete: (p: PtDhcpPool) => void): HTMLElement {
  return table(pools, [
    { label: 'Nombre', value: (p) => p.name },
    { label: 'Red', value: (p) => `${formatIp(networkOf(p.start, p.prefix))}/${p.prefix}`, mono: true },
    { label: 'Rango', value: (p) => `${formatIp(p.start)} – ${formatIp(p.start + p.maxUsers - 1)}`, mono: true },
    { label: 'Gateway', value: (p) => ipOrEmpty(p.gateway), mono: true },
    { label: 'DNS', value: (p) => ipOrEmpty(p.dns), mono: true },
    { label: 'Reservas', value: (p) => String(p.reservations.length) },
    { label: 'Concesiones por', value: (p) => (p.identifyBy === 'mac' ? 'MAC' : 'Client-ID') },
  ], { empty: 'No hay pools. Añade uno con la IP inicial y el número de usuarios.', onSelect, onDelete, selected: (p) => p.name === editing });
}

export function dhcpPanel(server: Server, app: AfterChange): HTMLElement {
  let editing: string | null = null;
  return livePanel((refresh) => {
    const s = server.services;
    const pool = s.dhcp.pools.find((p) => p.name === editing);
    const f = poolFields(server, pool);
    const msg = message();
    const read = (): PtDhcpPool | string => readPool(f, pool);
    const save = (): void => {
      const p = read();
      if (typeof p === 'string') return msg.error(p);
      const others = s.dhcp.pools.filter((o) => o.name !== editing);
      const err = validatePool(p, others);
      if (err) return msg.error(err);
      const pools = editing ? s.dhcp.pools.map((o) => (o.name === editing ? p : o)) : [...s.dhcp.pools, p];
      server.setServices({ ...s, dhcp: { ...s.dhcp, pools } });
      editing = p.name;
      app.afterCommand();
      refresh();
    };
    const remove = (p: PtDhcpPool): void => {
      server.setServices({ ...s, dhcp: { ...s.dhcp, pools: s.dhcp.pools.filter((o) => o.name !== p.name) } });
      if (editing === p.name) editing = null;
      app.afterCommand();
      refresh();
    };
    return [
      onOff('Servicio DHCP', s.dhcp.enabled, (on) => { server.setUnit('dhcp', on); app.afterCommand(); refresh(); }),
      el('h3', {}, pool ? `Editar pool ${pool.name}` : 'Nuevo pool'),
      el('div', { class: 'grid3' }, field('Nombre del pool', f.name), field('IP inicial', f.start), field('Máscara de subred', f.mask),
        field('Usuarios máximos', f.max), field('Puerta de enlace', f.gw), field('Servidor DNS', f.dns),
        field('Dominio', f.domain), field('Servidor TFTP (opción 150)', f.tftp), field('Concesión (minutos)', f.lease),
        field('Identificar concesiones automáticas por', f.identify, 'Kea «match-client-id»: con MAC, un equipo que cambia de Client-ID conserva su IP.')),
      el('div', { class: 'actions' }, button(pool ? 'Guardar cambios' : 'Añadir pool', save), pool ? button('Nuevo pool', () => { editing = null; refresh(); }, 'btn btn-quiet') : null),
      msg.el,
      el('h3', {}, 'Pools'),
      poolsTable(s.dhcp.pools, editing, (p) => { editing = p.name; refresh(); }, remove),
      pool ? reservationsPanel(server, pool, app, refresh) : el('p', { class: 'muted' }, 'Selecciona un pool para gestionar sus reservas por MAC o Client-ID.'),
      leasesPanel(server, app, refresh),
    ];
  });
}

const TYPES: readonly (readonly [DnsRecordType, string])[] = [['A', 'A · dirección'], ['CNAME', 'CNAME · alias'], ['MX', 'MX · correo'], ['NS', 'NS · servidor de nombres'], ['TXT', 'TXT · texto']];

function recordForm(server: Server, app: AfterChange, refresh: () => void): HTMLElement[] {
  const s = server.services;
  const origin = s.dns.origin;
  const name = input({ placeholder: origin ? 'www  ·  @  ·  *  ·  host.otro.dom.' : 'www.aula.lab' });
  const type = select(TYPES);
  const value = input({ placeholder: '192.168.1.10' });
  const prio = input({ value: '10', inputmode: 'numeric' });
  const ttl = input({ value: String(DEFAULT_TTL), inputmode: 'numeric' });
  const preview = el('p', { class: 'muted', 'aria-live': 'polite' });
  const prioField = field('Prioridad (MX)', prio);
  prioField.hidden = true;
  const showPreview = (): void => {
    const target = type.value === 'CNAME' || type.value === 'MX' || type.value === 'NS';
    const owner = name.value.trim() ? displayName(name.value, origin) : '';
    const dest = target && value.value.trim() ? displayName(value.value, origin) : '';
    preview.textContent = owner ? `Nombre completo: ${owner}${dest ? `  →  ${dest}` : ''}` : '';
  };
  type.addEventListener('change', () => {
    prioField.hidden = type.value !== 'MX';
    value.placeholder = type.value === 'A' ? '192.168.1.10' : type.value === 'TXT' ? 'v=spf1 mx -all' : origin ? 'srv  ·  @  ·  srv.otro.dom.' : 'srv.aula.lab';
    showPreview();
  });
  name.addEventListener('input', showPreview);
  value.addEventListener('input', showPreview);
  const msg = message();
  const add = (): void => {
    const rec: DnsRecord = { name: name.value.trim().toLowerCase(), type: type.value as DnsRecordType, value: value.value.trim(), priority: type.value === 'MX' ? Number(prio.value) : undefined, ttl: Number(ttl.value) || DEFAULT_TTL };
    const err = validateRecord(rec, origin);
    if (err) return msg.error(err);
    server.setServices({ ...s, dns: { ...s.dns, records: [...s.dns.records, rec] } });
    app.afterCommand();
    refresh();
  };
  return [
    el('h3', {}, 'Nuevo registro'),
    el('div', { class: 'grid3' }, field('Nombre', name), field('Tipo', type), field('Valor', value), prioField, field('TTL (s)', ttl)),
    preview,
    el('div', { class: 'actions' }, button('Añadir registro', add)), msg.el,
  ];
}

function originForm(server: Server, app: AfterChange, refresh: () => void): HTMLElement[] {
  const s = server.services;
  const originIn = input({ value: s.dns.origin ?? '', placeholder: 'aula.lab' });
  const msg = message();
  const save = (): void => {
    const err = validateOrigin(originIn.value);
    if (err) return msg.error(err);
    server.setServices({ ...s, dns: { ...s.dns, origin: cleanOrigin(originIn.value) } });
    app.afterCommand();
    refresh();
  };
  return [
    el('div', { class: 'grid3' }, field('Dominio de la zona ($ORIGIN)', originIn, 'Con dominio: «www» = www.dominio, «@» = el dominio (también como valor), «*» o «*.sub» = comodín para nombres que no existen, «host.otro.» (con punto final) = absoluto.')),
    el('div', { class: 'actions' }, button('Guardar dominio', save, 'btn btn-quiet')), msg.el,
  ];
}

export function dnsPanel(server: Server, app: AfterChange): HTMLElement {
  return livePanel((refresh) => {
    const s = server.services;
    const origin = s.dns.origin;
    return [
      onOff('Servicio DNS', s.dns.enabled, (on) => { server.setUnit('dns', on); app.afterCommand(); refresh(); }),
      ...originForm(server, app, refresh),
      ...recordForm(server, app, refresh),
      el('p', { class: 'muted' }, 'Los registros PTR se generan solos a partir de los A (prueba dig -x IP). El servidor es autoritativo: no resuelve nombres de Internet.'),
      el('h3', {}, 'Registros'),
      table(s.dns.records, [
        { label: 'Nombre', value: (r) => r.name, mono: true },
        { label: 'Nombre completo', value: (r) => displayName(r.name, origin), mono: true },
        { label: 'Tipo', value: (r) => r.type },
        { label: 'Valor', value: (r) => (r.type === 'MX' ? `${r.priority ?? 10} ${r.value}` : r.value), mono: true },
        { label: 'TTL', value: (r) => String(r.ttl) },
      ], { empty: 'Sin registros. Añade un A (www → IP) y prueba nslookup desde un PC.', onDelete: (r) => {
        server.setServices({ ...s, dns: { ...s.dns, records: s.dns.records.filter((x) => x !== r) } });
        app.afterCommand();
        refresh();
      } }),
    ];
  });
}
