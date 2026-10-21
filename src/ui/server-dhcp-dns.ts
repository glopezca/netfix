/** Server → Servicios → DHCP panel (the DNS panel is in server-dns.ts). */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, select, button, onOff, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { PtDhcpPool } from '../services/config.ts';
import { DEFAULT_LEASE_MINUTES, DEFAULT_MAX_USERS } from '../services/config.ts';
import { validatePool } from '../services/dhcp-pt.ts';
import { reservationsPanel, leasesPanel } from './server-dhcp-res.ts';
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
