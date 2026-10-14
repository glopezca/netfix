/** Server → DHCP: reservations (by MAC or client-id) and the lease table. */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, select, button, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { DhcpReservation, LeaseIdentity, PtDhcpPool } from '../services/config.ts';
import { idKinds, setReservations, readIdentifier, identifierText, reserveLease } from '../services/dhcp-reservations.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { formatMacCisco, formatHexId } from '../core/mac.ts';
import { formatLeaseTime } from '../core/clock.ts';
import type { Binding } from '../dhcp/server.ts';

export function reservationsPanel(server: Server, pool: PtDhcpPool, app: AfterChange, refresh: () => void): HTMLElement {
  const ip = input({ placeholder: '192.168.1.20', inputmode: 'decimal' });
  const kind = select(idKinds(), 'mac');
  const id = input({ placeholder: '0001.42AB.CDEF' });
  const name = input({ placeholder: 'PC-profesor' });
  kind.addEventListener('change', () => { id.placeholder = kind.value === 'mac' ? '0001.42AB.CDEF' : kind.value === 'hex' ? '0100.0142.abcd.ef' : 'aula-pc-01'; });
  const msg = message();
  const apply = (list: readonly DhcpReservation[]): void => {
    const err = setReservations(server, pool.name, list);
    if (err) return msg.error(err);
    app.afterCommand();
    refresh();
  };
  const add = (): void => {
    const a = parseIp(ip.value.trim());
    if (a === null) return msg.error(t('res.badIp'));
    const ident = readIdentifier(kind.value, id.value.trim());
    if (typeof ident === 'string') return msg.error(ident);
    apply([...pool.reservations, { ip: a, ...ident, name: name.value.trim() || undefined }]);
  };
  return el('section', { class: 'subsection' },
    el('h3', {}, t('res.title', { pool: pool.name })),
    el('div', { class: 'grid3' }, field(t('res.ip'), ip), field(t('res.by'), kind), field(t('res.id'), id), field(t('res.desc'), name)),
    el('div', { class: 'actions' }, button(t('res.add'), add)), msg.el,
    el('p', { class: 'muted' }, t('res.hint')),
    table(pool.reservations, [
      { label: 'IP', value: (r) => formatIp(r.ip), mono: true },
      { label: t('res.identifier'), value: identifierText, mono: true },
      { label: t('res.desc'), value: (r) => r.name ?? '' },
    ], { empty: t('res.none'), onDelete: (r) => apply(pool.reservations.filter((x) => x !== r)) }));
}

function reservationKind(server: Server, b: Binding): string {
  const pool = server.services.dhcp.pools.find((p) => p.name === b.pool);
  const r = pool?.reservations.find((x) => x.ip === b.ip);
  if (!r) return t('res.auto');
  return r.clientId ? t('res.byId') : t('res.byMac');
}

export function leasesPanel(server: Server, app: AfterChange, refresh: () => void): HTMLElement {
  const msg = message();
  const reserve = (b: Binding, by: LeaseIdentity): void => {
    const err = reserveLease(server, b.ip, by);
    if (err) return msg.error(err);
    app.afterCommand();
    refresh();
  };
  const leases = server.dhcpEngine.allBindings(server.clock.now()).filter((b) => b.type === 'Automatic');
  return el('section', { class: 'subsection' },
    el('h3', {}, t('res.leases')), msg.el,
    table(leases, [
      { label: 'IP', value: (b) => formatIp(b.ip), mono: true },
      { label: 'MAC', value: (b) => formatMacCisco(b.mac), mono: true },
      { label: 'Client-ID', value: (b) => (b.clientId ? formatHexId(b.clientId) : '—'), mono: true },
      { label: t('res.host'), value: (b) => b.hostname ?? '' },
      { label: t('res.type'), value: (b) => reservationKind(server, b) },
      { label: t('res.expires'), value: (b) => (b.expiresAt === null ? t('res.infinite') : formatLeaseTime(b.expiresAt)) },
    ], {
      empty: t('res.noLeases'),
      actions: (b) => {
        const byMac = button(t('res.reserveMac'), () => reserve(b, 'mac'), 'btn btn-quiet btn-small');
        const byId = button(t('res.reserveId'), () => reserve(b, 'client-id'), 'btn btn-quiet btn-small');
        byId.disabled = !b.clientId;
        return [byMac, byId];
      },
    }));
}
