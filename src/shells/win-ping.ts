/** ping's report in the Windows command prompt (moved out of windows.ts, 0.92.0). */
import { formatIp } from '../core/ip.ts';
import type { PingOutcome } from '../net/ping.ts';

export function pingReport(results: readonly PingOutcome[], ip: string, count: number): string[] {
  const lines: string[] = [];
  for (const x of results) {
    if (x.kind === 'reply') lines.push(`Reply from ${formatIp(x.from)}: bytes=32 time<1ms TTL=${x.ttl}`);
    else if (x.kind === 'unreachable') lines.push(`Reply from ${formatIp(x.from)}: Destination host unreachable.`);
    else if (x.kind === 'ttl') lines.push(`Reply from ${formatIp(x.from)}: TTL expired in transit.`);
    else lines.push('Request timed out.');
  }
  const received = results.filter((x) => x.kind === 'reply').length;
  const lost = count - received;
  lines.push('', `Ping statistics for ${ip}:`, `    Packets: Sent = ${count}, Received = ${received}, Lost = ${lost} (${Math.round((lost * 100) / count)}% loss),`);
  if (received > 0) lines.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms');
  lines.push('');
  return lines;
}
