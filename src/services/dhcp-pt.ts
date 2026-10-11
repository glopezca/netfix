/** Maps Packet Tracer-style DHCP pools onto the IOS DHCP engine (same allocation logic as routers). */
import type { DhcpServer, ExcludedRange } from '../dhcp/server.ts';
import type { PoolConfig } from '../dhcp/pool.ts';
import { newPool, usableRange } from '../dhcp/pool.ts';
import { networkOf, formatIp, inSubnet } from '../core/ip.ts';
import type { PtDhcpPool } from './config.ts';

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
    reservations: p.reservations.map((r) => ({ ip: r.ip, mac: r.mac })),
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
  if (!/^[\w.-]{1,32}$/.test(p.name)) return 'El nombre del pool solo admite letras, números, punto, guion y guion bajo.';
  if (others.some((o) => o.name === p.name)) return `Ya existe un pool llamado ${p.name}.`;
  if (p.prefix < 8 || p.prefix > 30) return 'La máscara debe estar entre /8 y /30.';
  const { first, last } = usableRange({ ip: p.start, prefix: p.prefix });
  if (p.start < first || p.start > last) return `La IP inicial ${formatIp(p.start)} no es una dirección de host de su subred.`;
  if (p.maxUsers < 1) return 'El número máximo de usuarios debe ser al menos 1.';
  if (p.gateway !== undefined && !inSubnet(p.gateway, p.start, p.prefix)) return 'La puerta de enlace debe estar en la misma subred que el pool.';
  const net = networkOf(p.start, p.prefix);
  if (others.some((o) => networkOf(o.start, o.prefix) === net && o.prefix === p.prefix)) return 'Ya hay un pool para esa subred.';
  const bad = p.reservations.find((r) => !inSubnet(r.ip, p.start, p.prefix));
  return bad ? `La reserva ${formatIp(bad.ip)} no está en la subred del pool.` : null;
}
