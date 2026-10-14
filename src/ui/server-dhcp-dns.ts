/** Server → Servicios → DHCP and DNS panels. */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, select, button, onOff, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { PtDhcpPool, DnsRecord, DnsRecordType } from '../services/config.ts';
import { DEFAULT_LEASE_MINUTES, DEFAULT_MAX_USERS, DEFAULT_TTL } from '../services/config.ts';
import { validatePool } from '../services/dhcp-pt.ts';
import { reservationsPanel, leasesPanel } from './server-dhcp-res.ts';
import { recursionForm } from './server-dns-recursion.ts';
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

const identify = (): readonly (readonly [string, string])[] => [['client-id', t('dhcp.byClientId')], ['mac', t('dhcp.byMac')]];

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
    identify: select(identify(), pool?.identifyBy ?? 'client-id'),
  };
}

function readPool(f: PoolFields, pool: PtDhcpPool | undefined): PtDhcpPool | string {
  const opt = (i: HTMLInputElement): number | undefined | null => (i.value.trim() ? parseIp(i.value.trim()) : undefined);
  const start = parseIp(f.start.value.trim());
  const prefix = parseMask(f.mask.value.trim());
  const vals = { gw: opt(f.gw), dns: opt(f.dns), tftp: opt(f.tftp) };
  if (start === null) return t('dhcp.badStart');
  if (prefix === null) return t('dhcp.badMask');
  if (Object.values(vals).some((v) => v === null)) return t('dhcp.badOptions');
  const maxUsers = Number(f.max.value);
  const lease = Number(f.lease.value);
  if (!Number.isInteger(maxUsers) || !Number.isInteger(lease) || lease < 1) return t('dhcp.badNumbers');
  return { name: f.name.value.trim(), start, prefix, maxUsers, gateway: vals.gw ?? undefined, dns: vals.dns ?? undefined, tftp: vals.tftp ?? undefined, domain: f.domain.value.trim() || undefined, leaseMinutes: lease, reservations: pool?.reservations ?? [], identifyBy: f.identify.value === 'mac' ? 'mac' : undefined };
}

function poolsTable(pools: readonly PtDhcpPool[], editing: string | null, onSelect: (p: PtDhcpPool) => void, onDelete: (p: PtDhcpPool) => void): HTMLElement {
  return table(pools, [
    { label: t('dhcp.name'), value: (p) => p.name },
    { label: t('dhcp.net'), value: (p) => `${formatIp(networkOf(p.start, p.prefix))}/${p.prefix}`, mono: true },
    { label: t('dhcp.range'), value: (p) => `${formatIp(p.start)} – ${formatIp(p.start + p.maxUsers - 1)}`, mono: true },
    { label: 'Gateway', value: (p) => ipOrEmpty(p.gateway), mono: true },
    { label: 'DNS', value: (p) => ipOrEmpty(p.dns), mono: true },
    { label: t('dhcp.reservations'), value: (p) => String(p.reservations.length) },
    { label: t('dhcp.leasesBy'), value: (p) => (p.identifyBy === 'mac' ? 'MAC' : 'Client-ID') },
  ], { empty: t('dhcp.noPools'), onSelect, onDelete, selected: (p) => p.name === editing });
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
      onOff(t('dhcp.service'), s.dhcp.enabled, (on) => { server.setUnit('dhcp', on); app.afterCommand(); refresh(); }),
      el('h3', {}, pool ? t('dhcp.editPool', { name: pool.name }) : t('dhcp.newPool')),
      el('div', { class: 'grid3' }, field(t('dhcp.poolName'), f.name), field(t('dhcp.start'), f.start), field(t('dhcp.mask'), f.mask),
        field(t('dhcp.maxUsers'), f.max), field(t('dhcp.gateway'), f.gw), field(t('dhcp.dns'), f.dns),
        field(t('dhcp.domain'), f.domain), field(t('dhcp.tftp'), f.tftp), field(t('dhcp.lease'), f.lease),
        field(t('dhcp.identify'), f.identify, t('dhcp.identifyHint'))),
      el('div', { class: 'actions' }, button(pool ? t('dhcp.saveChanges') : t('dhcp.addPool'), save), pool ? button(t('dhcp.newPool'), () => { editing = null; refresh(); }, 'btn btn-quiet') : null),
      msg.el,
      el('h3', {}, t('dhcp.pools')),
      poolsTable(s.dhcp.pools, editing, (p) => { editing = p.name; refresh(); }, remove),
      pool ? reservationsPanel(server, pool, app, refresh) : el('p', { class: 'muted' }, t('dhcp.pickPool')),
      leasesPanel(server, app, refresh),
    ];
  });
}

const recordTypes = (): readonly (readonly [DnsRecordType, string])[] => [['A', t('dns.typeA')], ['CNAME', t('dns.typeCname')], ['MX', t('dns.typeMx')], ['NS', t('dns.typeNs')], ['TXT', t('dns.typeTxt')]];

function recordForm(server: Server, app: AfterChange, refresh: () => void): HTMLElement[] {
  const s = server.services;
  const origin = s.dns.origin;
  const name = input({ placeholder: origin ? 'www  ·  @  ·  *  ·  host.otro.dom.' : 'www.aula.lab' });
  const type = select(recordTypes());
  const value = input({ placeholder: '192.168.1.10' });
  const prio = input({ value: '10', inputmode: 'numeric' });
  const ttl = input({ value: String(DEFAULT_TTL), inputmode: 'numeric' });
  const preview = el('p', { class: 'muted', 'aria-live': 'polite' });
  const prioField = field(t('dns.priority'), prio);
  prioField.hidden = true;
  const showPreview = (): void => {
    const target = type.value === 'CNAME' || type.value === 'MX' || type.value === 'NS';
    const owner = name.value.trim() ? displayName(name.value, origin) : '';
    const dest = target && value.value.trim() ? displayName(value.value, origin) : '';
    preview.textContent = owner ? t('dns.fullName', { name: `${owner}${dest ? `  →  ${dest}` : ''}` }) : '';
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
    el('h3', {}, t('dns.newRecord')),
    el('div', { class: 'grid3' }, field(t('dns.name'), name), field(t('dns.type'), type), field(t('dns.value'), value), prioField, field('TTL (s)', ttl)),
    preview,
    el('div', { class: 'actions' }, button(t('dns.addRecord'), add)), msg.el,
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
    el('div', { class: 'grid3' }, field(t('dns.origin'), originIn, t('dns.originHint'))),
    el('div', { class: 'actions' }, button(t('dns.saveOrigin'), save, 'btn btn-quiet')), msg.el,
  ];
}

export function dnsPanel(server: Server, app: AfterChange): HTMLElement {
  return livePanel((refresh) => {
    const s = server.services;
    const origin = s.dns.origin;
    return [
      onOff(t('dns.service'), s.dns.enabled, (on) => { server.setUnit('dns', on); app.afterCommand(); refresh(); }),
      ...originForm(server, app, refresh),
      ...recordForm(server, app, refresh),
      el('p', { class: 'muted' }, t('dns.ptrHint')),
      ...recursionForm(server, app, refresh),
      el('h3', {}, t('dns.records')),
      table(s.dns.records, [
        { label: t('dns.name'), value: (r) => r.name, mono: true },
        { label: t('dns.fullNameCol'), value: (r) => displayName(r.name, origin), mono: true },
        { label: t('dns.type'), value: (r) => r.type },
        { label: t('dns.value'), value: (r) => (r.type === 'MX' ? `${r.priority ?? 10} ${r.value}` : r.value), mono: true },
        { label: 'TTL', value: (r) => String(r.ttl) },
      ], { empty: t('dns.noRecords'), onDelete: (r) => {
        server.setServices({ ...s, dns: { ...s.dns, records: s.dns.records.filter((x) => x !== r) } });
        app.afterCommand();
        refresh();
      } }),
    ];
  });
}
