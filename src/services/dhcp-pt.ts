/** Maps Packet Tracer-style DHCP pools onto the IOS DHCP engine (same allocation logic as routers). */
import { t } from '../i18n/t.ts';
import type { DhcpServer, ExcludedRange } from '../dhcp/server.ts';
import type { PoolConfig } from '../dhcp/pool.ts';
import { newPool, usableRange } from '../dhcp/pool.ts';
import { networkOf, formatIp, inSubnet } from '../core/ip.ts';
import type { DhcpReservation, LeaseIdentity, PtDhcpPool } from './config.ts';
import type { Binding } from '../dhcp/server.ts';

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const TFTP_OPTION = 150;

export function ptPoolToIos(p: PtDhcpPool): PoolConfig {
  const minutes = p.leaseMinutes;
  const lease = { days: Math.floor(minutes / MINUTES_PER_DAY), hours: Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR), minutes: minutes % MINUTES_PER_HOUR };
  return {
    ...newPool(p.name),
    network: { ip: networkOf(p.start, p.prefix), prefix: p.prefix },
    defaultRouters: p.gateway !== undefined ? [p.gateway] : [],
    dnsServers: p.dns !== undefined ? [p.dns] : [],
    domainName: p.domain || undefined,
    lease,
    options: p.tftp !== undefined ? [{ code: TFTP_OPTION, kind: 'ip', value: '', ips: [p.tftp] }] : [],
    reservations: p.reservations.map((r) => (r.clientId ? { ip: r.ip, clientId: r.clientId } : { ip: r.ip, mac: r.mac, macAlways: true })),
    matchClientId: p.identifyBy === 'mac' ? false : undefined,
  };
}

/** Addresses of the subnet outside [start, start + maxUsers - 1] are excluded. */
export function ptExclusions(p: PtDhcpPool): ExcludedRange[] {
  const { first, last } = usableRange({ ip: p.start, prefix: p.prefix });
  const end = Math.min(last, p.start + Math.max(p.maxUsers, 1) - 1);
  const ranges: ExcludedRange[] = [];
  if (p.start > first) ranges.push({ low: first, high: p.start - 1 });
  if (end < last) ranges.push({ low: end + 1, high: last });
  return ranges;
}

/** Applies the pools to an engine instance, keeping its existing leases. */
export function applyPtPools(engine: DhcpServer, pools: readonly PtDhcpPool[], enabled: boolean): void {
  engine.serviceEnabled = enabled;
  engine.pools = pools.map(ptPoolToIos);
  engine.excluded = pools.flatMap(ptExclusions);
  engine.pingPackets = 0;
}

/** Validation used by the GUI. Returns an error message or null. */
export function validatePool(p: PtDhcpPool, others: readonly PtDhcpPool[]): string | null {
  if (!/^[\w.-]{1,32}$/.test(p.name)) return t('pool.err.name');
  if (others.some((o) => o.name === p.name)) return t('pool.err.exists', { name: p.name });
  if (p.prefix < 8 || p.prefix > 30) return t('pool.err.mask');
  const { first, last } = usableRange({ ip: p.start, prefix: p.prefix });
  if (p.start < first || p.start > last) return t('pool.err.start', { ip: formatIp(p.start) });
  if (p.maxUsers < 1) return t('pool.err.users');
  if (p.gateway !== undefined && !inSubnet(p.gateway, p.start, p.prefix)) return t('pool.err.gateway');
  const net = networkOf(p.start, p.prefix);
  if (others.some((o) => networkOf(o.start, o.prefix) === net && o.prefix === p.prefix)) return t('pool.err.subnet');
  const bad = p.reservations.find((r) => !inSubnet(r.ip, p.start, p.prefix));
  return bad ? t('pool.err.resNet', { ip: formatIp(bad.ip) }) : validateReservations(p.reservations);
}

function validateReservations(list: readonly DhcpReservation[]): string | null {
  if (list.some((r) => Boolean(r.mac) === Boolean(r.clientId))) return t('pool.err.resId');
  const ips = list.map((r) => r.ip);
  if (new Set(ips).size !== ips.length) return t('pool.err.resIp');
  const ids = list.map((r) => (r.mac ? `mac:${r.mac}` : `id:${r.clientId ?? ''}`));
  return new Set(ids).size === ids.length ? null : t('pool.err.resDup');
}

/** Turns an automatic lease into a reservation keyed by its MAC or by its client-id. */
export function leaseToReservation(lease: Binding, by: LeaseIdentity): DhcpReservation | null {
  if (by === 'client-id') return lease.clientId ? { ip: lease.ip, clientId: lease.clientId, name: lease.hostname } : null;
  return { ip: lease.ip, mac: lease.mac, name: lease.hostname };
}
