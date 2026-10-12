/** Server → DHCP: reservations (by MAC or client-id) and the lease table. */
import { el } from './dom.ts';
import { field, input, select, button, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { DhcpReservation, LeaseIdentity, PtDhcpPool } from '../services/config.ts';
import { ID_KINDS, setReservations, readIdentifier, identifierText, reserveLease } from '../services/dhcp-reservations.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { formatMacCisco, formatHexId } from '../core/mac.ts';
import { formatLeaseTime } from '../core/clock.ts';
import type { Binding } from '../dhcp/server.ts';

export function reservationsPanel(server: Server, pool: PtDhcpPool, app: AfterChange, refresh: () => void): HTMLElement {
  const ip = input({ placeholder: '192.168.1.20', inputmode: 'decimal' });
  const kind = select(ID_KINDS, 'mac');
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
    if (a === null) return msg.error('IP no válida.');
    const ident = readIdentifier(kind.value, id.value.trim());
    if (typeof ident === 'string') return msg.error(ident);
    apply([...pool.reservations, { ip: a, ...ident, name: name.value.trim() || undefined }]);
  };
  return el('section', { class: 'subsection' },
    el('h3', {}, `Reservas de ${pool.name}`),
    el('div', { class: 'grid3' }, field('IP reservada', ip), field('Identificar al cliente por', kind), field('MAC o Client-ID', id), field('Descripción', name)),
    el('div', { class: 'actions' }, button('Añadir reserva', add)), msg.el,
    el('p', { class: 'muted' }, 'Por MAC: coincide con la dirección física aunque el cliente envíe otro Client-ID (como «hw-address» en Kea). Por Client-ID: coincide con la opción 61 que envía el cliente.'),
    table(pool.reservations, [
      { label: 'IP', value: (r) => formatIp(r.ip), mono: true },
      { label: 'Identificador', value: identifierText, mono: true },
      { label: 'Descripción', value: (r) => r.name ?? '' },
    ], { empty: 'Sin reservas. La MAC y el Client-ID de cada equipo están en su pestaña Configuración IP.', onDelete: (r) => apply(pool.reservations.filter((x) => x !== r)) }));
}

function reservationKind(server: Server, b: Binding): string {
  const pool = server.services.dhcp.pools.find((p) => p.name === b.pool);
  const r = pool?.reservations.find((x) => x.ip === b.ip);
  if (!r) return 'Automática';
  return r.clientId ? 'Reserva (Client-ID)' : 'Reserva (MAC)';
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
    el('h3', {}, 'Concesiones'), msg.el,
    table(leases, [
      { label: 'IP', value: (b) => formatIp(b.ip), mono: true },
      { label: 'MAC', value: (b) => formatMacCisco(b.mac), mono: true },
      { label: 'Client-ID', value: (b) => (b.clientId ? formatHexId(b.clientId) : '—'), mono: true },
      { label: 'Equipo', value: (b) => b.hostname ?? '' },
      { label: 'Tipo', value: (b) => reservationKind(server, b) },
      { label: 'Expira', value: (b) => (b.expiresAt === null ? 'Infinita' : formatLeaseTime(b.expiresAt)) },
    ], {
      empty: 'Aún no hay concesiones.',
      actions: (b) => {
        const byMac = button('Reservar por MAC', () => reserve(b, 'mac'), 'btn btn-quiet btn-small');
        const byId = button('Reservar por Client-ID', () => reserve(b, 'client-id'), 'btn btn-quiet btn-small');
        byId.disabled = !b.clientId;
        return [byMac, byId];
      },
    }));
}
