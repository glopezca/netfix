/** ipconfig [/all]: the Windows view of the device's address, lease, DNS and WINS servers. */
import type { Host } from '../devices/host.ts';
import { HOST_PORT } from '../devices/host.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { formatLeaseTime } from '../core/clock.ts';
import { windowsWinsServers } from '../net/win-wins.ts';

const MS = 1000;

function linkLocal(mac: string): string {
  const b = (mac.match(/../g) ?? []).map((x) => parseInt(x, 16));
  const first = ((b[0] ?? 0) ^ 0x02).toString(16).padStart(2, '0');
  const h = (x: number): string => x.toString(16).toUpperCase().padStart(2, '0');
  const groups = [`${first}${h(b[1] ?? 0)}`, `${h(b[2] ?? 0)}FF`, `FE${h(b[3] ?? 0)}`, `${h(b[4] ?? 0)}${h(b[5] ?? 0)}`];
  return `FE80::${groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}`.toUpperCase();
}

export function ipconfig(host: Host, all: boolean): string[] {
  const c = host.config;
  const lease = host.dhcpClient.lease;
  const lines = ['', `${HOST_PORT} Connection:(default port)`, ''];
  lines.push(`   Connection-specific DNS Suffix..: ${lease?.domainName ?? ''}`);
  if (all) lines.push(`   Physical Address................: ${formatMacCisco(host.mac).toUpperCase()}`);
  lines.push(
    `   Link-local IPv6 Address.........: ${linkLocal(host.mac)}`,
    '   IPv6 Address....................: ::',
    `   IPv4 Address....................: ${c.ip !== undefined ? formatIp(c.ip) : '0.0.0.0'}`,
    `   Subnet Mask.....................: ${c.prefix !== undefined ? formatMask(c.prefix) : '0.0.0.0'}`,
    '   Default Gateway.................: ::',
    `                                     ${c.gateway !== undefined ? formatIp(c.gateway) : '0.0.0.0'}`,
  );
  if (all) {
    lines.push(`   DHCP Servers....................: ${lease ? formatIp(lease.serverId) : '0.0.0.0'}`, `   DNS Servers.....................: ${c.dns !== undefined ? formatIp(c.dns) : '0.0.0.0'}`);
    const [primary, secondary] = windowsWinsServers(host);
    if (primary !== undefined) lines.push(`   Primary WINS Server.............: ${formatIp(primary)}`);
    if (secondary !== undefined) lines.push(`   Secondary WINS Server...........: ${formatIp(secondary)}`);
    if (lease) {
      const exp = lease.leaseSeconds >= 0xffffffff ? 'Infinite' : formatLeaseTime(lease.obtainedAt + lease.leaseSeconds * MS);
      lines.push(`   Lease Obtained..................: ${formatLeaseTime(lease.obtainedAt)}`, `   Lease Expires...................: ${exp}`);
    }
  }
  lines.push('');
  return lines;
}
