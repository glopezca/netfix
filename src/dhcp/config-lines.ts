/** Renders the DHCP part of `show running-config`. */
import { formatIp, formatMask } from '../core/ip.ts';
import { formatHexId, formatMacCisco } from '../core/mac.ts';
import type { DhcpServer } from './server.ts';
import type { PoolConfig, Reservation, PoolOption, Lease, UtilizationMark } from './pool.ts';

const ips = (list: readonly number[]): string => list.map(formatIp).join(' ');

function leaseLine(lease: Lease): string {
  if (lease === 'infinite') return ' lease infinite';
  const { days, hours, minutes } = lease;
  if (minutes) return ` lease ${days} ${hours} ${minutes}`;
  if (hours) return ` lease ${days} ${hours}`;
  return ` lease ${days}`;
}

function reservationLine(r: Reservation): string {
  if (r.mac) return ` address ${formatIp(r.ip)} hardware-address ${formatMacCisco(r.mac)}${r.hwType ? ` ${r.hwType}` : ''}`;
  if (r.asciiText !== undefined) return ` address ${formatIp(r.ip)} client-id ${r.asciiText} ascii`;
  return ` address ${formatIp(r.ip)} client-id ${formatHexId(r.clientId ?? '')}`;
}

function optionLine(o: PoolOption): string {
  const inst = o.instance !== undefined ? ` instance ${o.instance}` : '';
  const value = o.kind === 'ip' ? ips(o.ips ?? []) : o.value;
  return ` option ${o.code}${inst} ${o.kind} ${value}`;
}

function markLine(kind: 'high' | 'low', mark: UtilizationMark | undefined): string[] {
  return mark ? [` utilization mark ${kind} ${mark.percent}${mark.log ? ' log' : ''}`] : [];
}

function identityLines(p: PoolConfig): string[] {
  const lines: string[] = [];
  if (p.host) lines.push(` host ${formatIp(p.host.ip)} ${formatMask(p.host.prefix)}`);
  if (p.clientIdentifier) lines.push(` client-identifier ${formatHexId(p.clientIdentifier)}`);
  if (p.hardwareAddress) lines.push(` hardware-address ${formatMacCisco(p.hardwareAddress.mac)}${p.hardwareAddress.type ? ` ${p.hardwareAddress.type}` : ''}`);
  if (p.clientName) lines.push(` client-name ${p.clientName}`);
  return lines;
}

function parameterLines(p: PoolConfig): string[] {
  const lines: string[] = [];
  if (p.bootfile) lines.push(` bootfile ${p.bootfile}`);
  if (p.nextServers.length) lines.push(` next-server ${ips(p.nextServers)}`);
  if (p.defaultRouters.length) lines.push(` default-router ${ips(p.defaultRouters)}`);
  if (p.dnsServers.length) lines.push(` dns-server ${ips(p.dnsServers)}`);
  if (p.domainName) lines.push(` domain-name ${p.domainName}`);
  if (p.netbiosServers.length) lines.push(` netbios-name-server ${ips(p.netbiosServers)}`);
  if (p.netbiosNodeType) lines.push(` netbios-node-type ${p.netbiosNodeType}`);
  lines.push(...p.options.map(optionLine));
  if (p.lease !== undefined) lines.push(leaseLine(p.lease));
  return lines;
}

function featureLines(p: PoolConfig): string[] {
  const lines: string[] = [];
  if (p.origin) lines.push(` origin ${p.origin}`);
  if (p.subnetPrefixLength !== undefined) lines.push(` subnet prefix-length ${p.subnetPrefixLength}`);
  if (p.importAll) lines.push(' import all');
  if (p.updateArp) lines.push(' update arp');
  if (p.renewDenyUnknown) lines.push(' renew deny unknown');
  lines.push(...markLine('high', p.utilizationHigh), ...markLine('low', p.utilizationLow));
  if (p.reservedOnly) lines.push(' reserved-only');
  if (p.accounting) lines.push(` accounting ${p.accounting}`);
  for (const s of p.relaySources) lines.push(` relay source ${formatIp(s.ip)} ${formatMask(s.prefix)}`);
  for (const d of p.relayDestinations) lines.push(` relay destination ${formatIp(d)}`);
  return lines;
}

export function poolLines(p: PoolConfig): string[] {
  const lines = [`ip dhcp pool ${p.name}`];
  if (p.vrf) lines.push(` vrf ${p.vrf}`);
  if (p.network) lines.push(` network ${formatIp(p.network.ip)} ${formatMask(p.network.prefix)}`);
  for (const s of p.secondaryNetworks) lines.push(` network ${formatIp(s.ip)} ${formatMask(s.prefix)} secondary`);
  lines.push(...identityLines(p), ...p.reservations.map(reservationLine));
  for (const c of p.classes) {
    lines.push(` class ${c.name}`, ...c.ranges.map((r) => `  address range ${formatIp(r.start)} ${formatIp(r.end)}`));
  }
  lines.push(...parameterLines(p), ...featureLines(p));
  return lines;
}

function globalLines(s: DhcpServer): string[] {
  const lines: string[] = [];
  if (!s.serviceEnabled) lines.push('no service dhcp');
  for (const r of s.excluded) lines.push(`ip dhcp excluded-address ${formatIp(r.low)}${r.high !== r.low ? ` ${formatIp(r.high)}` : ''}`);
  if (!s.conflictLogging) lines.push('no ip dhcp conflict logging');
  if (s.pingPackets !== 2) lines.push(`ip dhcp ping packets ${s.pingPackets}`);
  if (s.pingTimeoutMs !== 500) lines.push(`ip dhcp ping timeout ${s.pingTimeoutMs}`);
  if (s.bootpIgnore) lines.push('ip dhcp bootp ignore');
  for (const d of s.databases) lines.push(`ip dhcp database ${d}`);
  if (s.relayInfoOption) lines.push('ip dhcp relay information option');
  if (s.relayInfoTrustAll) lines.push('ip dhcp relay information trust-all');
  if (s.relayInfoPolicy) lines.push(`ip dhcp relay information policy ${s.relayInfoPolicy}`);
  if (s.smartRelay) lines.push('ip dhcp smart-relay');
  for (const u of s.useOptions) lines.push(`ip dhcp use ${u}`);
  return lines;
}

export function dhcpRunningConfig(server: DhcpServer): string[] {
  const globals = globalLines(server);
  const pools = server.pools.flatMap((p) => ['!', ...poolLines(p)]);
  if (globals.length === 0 && pools.length === 0) return [];
  return [...globals, ...pools, '!'];
}
