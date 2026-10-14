/** DHCP reservations of a Server (by MAC or by client-identifier): shared by its window and its web GUI. */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import type { DhcpReservation, LeaseIdentity } from './config.ts';
import { validatePool, leaseToReservation } from './dhcp-pt.ts';
import { parseMac, parseHexId, asciiToHex, formatMacCisco, formatHexId } from '../core/mac.ts';

/** How the identifier of a new reservation is written. */
export type IdentifierKind = 'mac' | 'hex' | 'ascii';

export const idKinds = (): readonly (readonly [IdentifierKind, string])[] => [['mac', 'MAC'], ['hex', t('res.kindHex')], ['ascii', t('res.kindAscii')]];

/** Replaces the reservations of a pool after validating them; returns an error message or null. */
export function setReservations(server: Server, poolName: string, list: readonly DhcpReservation[]): string | null {
  const s = server.services;
  const pool = s.dhcp.pools.find((p) => p.name === poolName);
  if (!pool) return t('res.err.noPool');
  const err = validatePool({ ...pool, reservations: list }, s.dhcp.pools.filter((p) => p.name !== poolName));
  if (err) return err;
  server.setServices({ ...s, dhcp: { ...s.dhcp, pools: s.dhcp.pools.map((p) => (p.name === poolName ? { ...p, reservations: list } : p)) } });
  return null;
}

/** "0001.42AB.CDEF" (MAC), "0100.0142.abcd.ef" (hex) or "aula-pc-01" (ASCII) → the reservation key. */
export function readIdentifier(kind: string, text: string): Pick<DhcpReservation, 'mac' | 'clientId'> | string {
  if (kind === 'mac') {
    const mac = parseMac(text);
    return mac ? { mac } : t('res.err.mac');
  }
  const id = kind === 'ascii' ? (text ? asciiToHex(text) : null) : parseHexId(text);
  return id ? { clientId: id } : t('res.err.id');
}

export function identifierText(r: Pick<DhcpReservation, 'mac' | 'clientId'>): string {
  return r.clientId ? `Client-ID ${formatHexId(r.clientId)}` : `MAC ${formatMacCisco(r.mac ?? '')}`;
}

/** Turns the automatic lease of `ip` into a reservation of its pool. */
export function reserveLease(server: Server, ip: number, by: LeaseIdentity): string | null {
  const lease = server.dhcpEngine.allBindings(server.clock.now()).find((b) => b.ip === ip && b.type === 'Automatic');
  if (!lease) return t('res.err.noLease');
  const pool = server.services.dhcp.pools.find((p) => p.name === lease.pool);
  const r = leaseToReservation(lease, by);
  if (!pool || !r) return t('res.err.noId');
  return setReservations(server, pool.name, [...pool.reservations.filter((x) => x.ip !== ip), r]);
}
