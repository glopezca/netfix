/** The PC "Command Prompt": ipconfig, ping, arp. Output mimics Packet Tracer/Windows. */
import type { Pc } from './pc.ts';
import { PC_PORT } from './pc.ts';
import { formatIp, formatMask, parseIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { formatLeaseTime } from '../core/clock.ts';
import { runPing } from '../net/ping.ts';

const PING_TIMEOUT_MS = 1000;
const DEFAULT_PING_COUNT = 4;
const DHCP_WAIT_MS = 20_000;
const MS = 1000;

function linkLocal(mac: string): string {
  const b = mac.match(/../g)!.map((x) => parseInt(x, 16));
  const first = ((b[0] ?? 0) ^ 0x02).toString(16).padStart(2, '0');
  const h = (x: number): string => x.toString(16).toUpperCase().padStart(2, '0');
  const groups = [`${first}${h(b[1] ?? 0)}`, `${h(b[2] ?? 0)}FF`, `FE${h(b[3] ?? 0)}`, `${h(b[4] ?? 0)}${h(b[5] ?? 0)}`];
  return `FE80::${groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}`.toUpperCase();
}

function ipconfig(pc: Pc, all: boolean): string[] {
  const c = pc.config;
  const lease = pc.dhcpClient.lease;
  const lines = ['', `${PC_PORT} Connection:(default port)`, ''];
  if (all) lines.push(`   Connection-specific DNS Suffix..: ${lease?.domainName ?? ''}`, `   Physical Address................: ${formatMacCisco(pc.mac).toUpperCase()}`);
  else lines.push(`   Connection-specific DNS Suffix..: ${lease?.domainName ?? ''}`);
  lines.push(
    `   Link-local IPv6 Address.........: ${linkLocal(pc.mac)}`,
    '   IPv6 Address....................: ::',
    `   IPv4 Address....................: ${c.ip !== undefined ? formatIp(c.ip) : '0.0.0.0'}`,
    `   Subnet Mask.....................: ${c.prefix !== undefined ? formatMask(c.prefix) : '0.0.0.0'}`,
    '   Default Gateway.................: ::',
    `                                     ${c.gateway !== undefined ? formatIp(c.gateway) : '0.0.0.0'}`,
  );
  if (all) {
    lines.push(
      `   DHCP Servers....................: ${lease ? formatIp(lease.serverId) : '0.0.0.0'}`,
      `   DNS Servers.....................: ${c.dns !== undefined ? formatIp(c.dns) : '0.0.0.0'}`,
    );
    if (lease) {
      lines.push(`   Lease Obtained..................: ${formatLeaseTime(lease.obtainedAt)}`);
      const exp = lease.leaseSeconds >= 0xffffffff ? 'Infinite' : formatLeaseTime(lease.obtainedAt + lease.leaseSeconds * MS);
      lines.push(`   Lease Expires...................: ${exp}`);
    }
  }
  lines.push('');
  return lines;
}

function renew(pc: Pc): string[] {
  if (pc.config.mode !== 'dhcp') return ['', 'The operation failed as no adapter is in the state permissible for', 'this operation.', ''];
  pc.dhcpStatus = 'requesting';
  pc.dhcpClient.renew();
  pc.hooks.runUntil(() => pc.dhcpClient.state === 'BOUND' || pc.dhcpStatus === 'failed', DHCP_WAIT_MS);
  if (pc.dhcpClient.state !== 'BOUND') {
    return ['', 'An error occurred while renewing interface FastEthernet0 : unable to contact your DHCP server. Request has timed out.', ''];
  }
  return ipconfig(pc, false);
}

function release(pc: Pc): string[] {
  if (pc.config.mode !== 'dhcp') return ['', 'The operation failed as no adapter is in the state permissible for', 'this operation.', ''];
  pc.dhcpClient.release();
  pc.hooks.runUntil(() => false, 10);
  pc.config = { mode: 'dhcp' };
  pc.dhcpStatus = 'idle';
  return ipconfig(pc, false);
}

function ping(pc: Pc, target: string, count: number): string[] {
  const dst = parseIp(target);
  if (dst === null) return [`Ping request could not find host ${target}. Please check the name and try again.`];
  const lines = ['', `Pinging ${target} with 32 bytes of data:`, ''];
  const results = runPing(pc.stack, pc.hooks, dst, { count, timeoutMs: PING_TIMEOUT_MS });
  for (const r of results) {
    if (r.kind === 'reply') lines.push(`Reply from ${formatIp(r.from)}: bytes=32 time<1ms TTL=${r.ttl}`);
    else if (r.kind === 'unreachable') lines.push(`Reply from ${formatIp(r.from)}: Destination host unreachable.`);
    else if (r.kind === 'ttl') lines.push(`Reply from ${formatIp(r.from)}: TTL expired in transit.`);
    else lines.push('Request timed out.');
  }
  const received = results.filter((r) => r.kind === 'reply').length;
  const lost = count - received;
  lines.push('', `Ping statistics for ${target}:`, `    Packets: Sent = ${count}, Received = ${received}, Lost = ${lost} (${Math.round((lost * 100) / count)}% loss),`);
  if (received > 0) lines.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms');
  lines.push('');
  return lines;
}

function arpTable(pc: Pc): string[] {
  if (pc.stack.arp.size === 0) return ['No ARP Entries Found'];
  const lines = ['  Internet Address      Physical Address      Type'];
  for (const [ip, e] of pc.stack.arp) lines.push(`  ${formatIp(ip).padEnd(22)}${formatMacCisco(e.mac).padEnd(22)}dynamic`);
  return lines;
}

const HELP = [
  'Available commands:',
  '  arp -a | arp -d          Show / delete the ARP cache',
  '  help | ?                 This help',
  '  ipconfig [/all]          Show IP configuration',
  '  ipconfig /release        Release the DHCP lease',
  '  ipconfig /renew          Renew (or obtain) a DHCP lease',
  '  ping [-n N] <ip>         Send ICMP echo requests',
];

/** Runs one Command Prompt line and returns its output. */
export function pcCommand(pc: Pc, line: string): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const cmd = (words[0] ?? '').toLowerCase();
  const arg = (words[1] ?? '').toLowerCase();
  if (cmd === '') return [];
  if (cmd === 'ipconfig') {
    if (arg === '' || arg === '/all') return ipconfig(pc, arg === '/all');
    if (arg === '/renew') return renew(pc);
    if (arg === '/release') return release(pc);
    return ['Invalid Command.'];
  }
  if (cmd === 'ping') {
    const nIdx = words.findIndex((w) => w.toLowerCase() === '-n');
    const count = nIdx >= 0 ? Math.max(1, Number(words[nIdx + 1]) || DEFAULT_PING_COUNT) : DEFAULT_PING_COUNT;
    const target = words.filter((_, i) => i > 0 && (nIdx < 0 || (i !== nIdx && i !== nIdx + 1))).pop();
    return target ? ping(pc, target, count) : ['Invalid Command.'];
  }
  if (cmd === 'arp') {
    if (arg === '-a') return arpTable(pc);
    if (arg === '-d') {
      pc.stack.flushArp();
      return [];
    }
    return ['Invalid Command.'];
  }
  if (cmd === 'help' || cmd === '?') return HELP;
  return ['Invalid Command.'];
}
