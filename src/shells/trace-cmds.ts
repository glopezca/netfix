/** traceroute (GNU/Linux) and tracert (Windows) on PCs and servers. */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { resolveHost } from './net-tools.ts';
import { DEFAULT_MAX_HOPS, linuxTraceLines, runTrace, windowsTraceLines } from '../net/trace.ts';
import { formatIp } from '../core/ip.ts';

const LINUX_TIMEOUT_MS = 5000;
const WINDOWS_TIMEOUT_MS = 4000;
const PROBES = 3;
const MAX_TTL = 255;

function maxHopsArg(args: readonly string[], flag: string): number | null {
  const i = args.indexOf(flag);
  if (i < 0) return DEFAULT_MAX_HOPS;
  const n = Number(args[i + 1]);
  return Number.isInteger(n) && n >= 1 && n <= MAX_TTL ? n : null;
}

export function traceroute(host: Host) {
  return (ctx: Ctx): number => {
    const args = ctx.argv.slice(1);
    const maxHops = maxHopsArg(args, '-m');
    if (maxHops === null) { ctx.err('first hop out of range\n'); return 2; }
    const target = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '-m').at(0);
    if (!target) { ctx.err('Usage:\n  traceroute [ -46dFITnreAUDV ] [ -m max_ttl ] host [ packetlen ]\n'); return 2; }
    const r = resolveHost(host, target);
    if (r.kind === 'error') { ctx.err(`${target}: Name or service not known\nCannot handle "host" cmdline arg \`${target}' on position 1 (argc 1)\n`); return 2; }
    const res = runTrace(host.stack, host.hooks, r.ip, { maxHops, probes: PROBES, timeoutMs: LINUX_TIMEOUT_MS, now: () => host.clock.elapsed() });
    if (res.noroute) { ctx.err('connect: Network is unreachable\n'); return 1; }
    const lines = linuxTraceLines(target, r.ip, res, { numeric: args.includes('-n'), gateway: host.config.gateway, maxHops });
    ctx.out(`${lines.join('\n')}\n`);
    return 0;
  };
}

export function tracert(host: Host, args: readonly string[]): string[] {
  const lower = args.map((a) => a.toLowerCase());
  const maxHops = maxHopsArg(lower, '-h');
  const target = args.filter((a, i) => !a.startsWith('-') && lower[i - 1] !== '-h').at(-1);
  if (!target || maxHops === null) return ['', 'Usage: tracert [-d] [-h maximum_hops] target_name', ''];
  const r = resolveHost(host, target);
  if (r.kind === 'error') return [`Unable to resolve target system name ${target}.`];
  const res = runTrace(host.stack, host.hooks, r.ip, { maxHops, probes: PROBES, timeoutMs: WINDOWS_TIMEOUT_MS, now: () => host.clock.elapsed() });
  if (res.noroute) return ['', `Unable to contact IP driver. General failure.`, ''];
  return windowsTraceLines(r.viaDns ? `${target} [${formatIp(r.ip)}]` : formatIp(r.ip), res, maxHops);
}
