/** Formatting of `show ip dhcp …` output. */
import { formatIp } from '../core/ip.ts';
import { formatHexId, formatMacPT } from '../core/mac.ts';
import { formatLeaseTime } from '../core/clock.ts';
import type { DhcpServer, Binding } from './server.ts';
import type { PoolConfig } from './pool.ts';
import { poolNetworks, usableRange, totalAddresses } from './pool.ts';

function clientColumn(b: Binding): string {
  if (b.clientId) return formatHexId(b.clientId);
  return b.mac ? formatMacPT(b.mac) : '';
}

export function showBindings(server: DhcpServer, now: number, filter?: number): string[] {
  const rows = server.allBindings(now).filter((b) => filter === undefined || b.ip === filter);
  const lines = [
    'IP address       Client-ID/              Lease expiration        Type',
    '                 Hardware address',
  ];
  for (const b of rows) {
    const expiry = b.expiresAt === null ? 'Infinite' : formatLeaseTime(b.expiresAt);
    lines.push(`${formatIp(b.ip).padEnd(17)}${clientColumn(b).padEnd(24)} ${expiry.padEnd(23)} ${b.type}`);
  }
  return lines;
}

function excludedIn(server: DhcpServer, first: number, last: number): number {
  let n = 0;
  for (const r of server.excluded) {
    const lo = Math.max(r.low, first);
    const hi = Math.min(r.high, last);
    if (hi >= lo) n += hi - lo + 1;
  }
  return n;
}

function nextIndex(server: DhcpServer, pool: PoolConfig, first: number, last: number, now: number): string {
  const used = new Set(server.allBindings(now).map((b) => b.ip));
  for (let ip = first; ip <= last; ip++) {
    if (!used.has(ip) && !server.isExcluded(ip)) return formatIp(ip);
  }
  return formatIp(first);
}

function poolBlock(server: DhcpServer, pool: PoolConfig, now: number): string[] {
  const nets = poolNetworks(pool);
  const leased = server.leasedIn(pool);
  const high = pool.utilizationHigh?.percent ?? 100;
  const low = pool.utilizationLow?.percent ?? 0;
  const excluded = nets.reduce((n, net) => { const r = usableRange(net); return n + excludedIn(server, r.first, r.last); }, 0);
  const lines = [
    '',
    `Pool ${pool.name} :`,
    ` Utilization mark (high/low)    : ${high} / ${low}`,
    ` Subnet size (first/next)       : 0 / 0 `,
    ` Total addresses                : ${totalAddresses(pool)}`,
    ` Leased addresses               : ${leased}`,
    ` Excluded addresses             : ${excluded}`,
    ' Pending event                  : none',
    ` ${nets.length} subnet${nets.length === 1 ? ' is' : 's are'} currently in the pool :`,
    ' Current index        IP address range                    Leased/Excluded/Total',
  ];
  for (const net of nets) {
    const { first, last } = usableRange(net);
    const total = last - first + 1;
    const leasedHere = server.allBindings(now).filter((b) => b.pool === pool.name && b.ip >= first && b.ip <= last && b.type === 'Automatic').length;
    const range = `${formatIp(first).padEnd(16)} - ${formatIp(last).padEnd(16)}`;
    lines.push(` ${nextIndex(server, pool, first, last, now).padEnd(20)} ${range}    ${leasedHere}    / ${excludedIn(server, first, last)}     / ${total}`);
  }
  if (pool.reservations.length > 0) {
    lines.push(` ${pool.reservations.length} reserved address${pool.reservations.length === 1 ? ' is' : 'es are'} currently in the pool :`);
    lines.push(' Address          Client');
    for (const r of pool.reservations) {
      const who = r.mac ? formatMacPT(r.mac) : r.asciiText ?? formatHexId(r.clientId ?? '');
      lines.push(` ${formatIp(r.ip).padEnd(16)} ${who}`);
    }
  }
  return lines;
}

export function showPools(server: DhcpServer, now: number, name?: string): string[] {
  const pools = name ? server.pools.filter((p) => p.name === name) : server.pools;
  if (name && pools.length === 0) return [`%DHCP pool ${name} does not exist`];
  return pools.flatMap((p) => poolBlock(server, p, now));
}

export function showStatistics(server: DhcpServer): string[] {
  const s = server.stats();
  const row = (label: string, n: number): string => `${label.padEnd(21)}${n}`;
  return [
    row('Memory usage', 41864 + server.pools.length * 1024),
    row('Address pools', server.pools.length),
    row('Database agents', server.databases.length),
    row('Automatic bindings', s.automatic),
    row('Manual bindings', s.manual),
    row('Expired bindings', s.expired),
    row('Malformed messages', s.malformed),
    row('Secure arp entries', 0),
    '',
    'Message              Received',
    ...Object.entries(s.received).map(([k, v]) => row(k, v)),
    '',
    'Message              Sent',
    ...Object.entries(s.sent).map(([k, v]) => row(k, v)),
  ];
}

export function showConflicts(server: DhcpServer): string[] {
  return [
    'IP address        Detection method   Detection time          VRF',
    ...server.conflictList().map((c) => `${formatIp(c.ip).padEnd(18)}${c.method.padEnd(19)}${formatLeaseTime(c.detectedAt)}`),
  ];
}

export function showDatabase(server: DhcpServer): string[] {
  if (server.databases.length === 0) return [];
  return server.databases.flatMap((d) => [
    `URL       :   ${d.split(' ')[0]}`,
    'Read      :   Never',
    'Written   :   Never',
    'Status    :   Last read succeeded. Bindings have been loaded in RAM.',
    'Delay     :   300 seconds',
    'Timeout   :   300 seconds',
    'Failures  :           0',
    'Successes :           0',
    '',
  ]);
}
