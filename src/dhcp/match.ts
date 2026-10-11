/**
 * Client matching rules for manual bindings and reservations.
 *
 * - `client-identifier X` matches option 61 == X; a client that sends no option 61 is
 *   treated as having client-id "01" + MAC.
 * - `hardware-address M` matches chaddr == M when the client sends no option 61 or its
 *   option 61 is just "01" + MAC (Windows/PC style). Clients with other identifiers
 *   (e.g. Cisco routers: "cisco-<mac>-<if>") need `client-identifier`, as on real IOS.
 */
import type { IpWithPrefix } from '../core/ip.ts';
import { inSubnet } from '../core/ip.ts';
import { clientIdFromMac } from '../core/mac.ts';
import type { PoolConfig, Reservation } from './pool.ts';
import { poolNetworks } from './pool.ts';

export interface ClientIdentity {
  readonly clientId?: string;
  readonly mac: string;
  /** Stable key for offers and bindings. */
  readonly key: string;
  /** How IOS prints this client (dotted client-id or MAC). */
  readonly display: string;
}

interface Criteria {
  readonly clientId?: string;
  readonly mac?: string;
}

export function matchesClient(criteria: Criteria, client: ClientIdentity): boolean {
  if (criteria.clientId) {
    const effectiveId = client.clientId ?? clientIdFromMac(client.mac);
    if (criteria.clientId === effectiveId) return true;
  }
  if (criteria.mac) {
    const plainId = !client.clientId || client.clientId === clientIdFromMac(client.mac);
    if (plainId && criteria.mac === client.mac) return true;
  }
  return false;
}

/** Network pool serving an address (most specific network wins, primary before secondary). */
export function selectPool(pools: readonly PoolConfig[], addr: number): PoolConfig | undefined {
  let best: { pool: PoolConfig; prefix: number } | undefined;
  for (const pool of pools) {
    for (const net of poolNetworks(pool)) {
      if (!inSubnet(addr, net.ip, net.prefix)) continue;
      if (!best || net.prefix > best.prefix) best = { pool, prefix: net.prefix };
    }
  }
  return best?.pool;
}

/** Host pool for this client, valid only on the subnet the request came from. */
export function findManualPool(
  pools: readonly PoolConfig[],
  client: ClientIdentity,
  subnetAddr: number,
  ifaceAddrs: readonly IpWithPrefix[],
  viaRelay: boolean,
): PoolConfig | undefined {
  return pools.find((p) => {
    if (!p.host) return false;
    const criteria = { clientId: p.clientIdentifier, mac: p.hardwareAddress?.mac };
    if (!matchesClient(criteria, client)) return false;
    const { ip, prefix } = p.host;
    if (viaRelay) return inSubnet(subnetAddr, ip, prefix);
    return ifaceAddrs.some((a) => inSubnet(a.ip, ip, prefix));
  });
}

export function findReservation(pool: PoolConfig, client: ClientIdentity): Reservation | undefined {
  return pool.reservations.find((r) => (r.macAlways && r.mac ? r.mac === client.mac : matchesClient({ clientId: r.clientId, mac: r.mac }, client)));
}
