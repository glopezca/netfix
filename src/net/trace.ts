/**
 * Traceroute driver shared by GNU/Linux (traceroute), Windows (tracert) and IOS (traceroute):
 * ICMP echo probes with TTL 1, 2, 3… until the destination answers. Routers on the way answer
 * "time exceeded" (they only do that for echo requests, so this is `traceroute -I` behaviour).
 */
import type { EchoResult, IpStack } from './ipstack.ts';
import type { UnreachableCode } from './packets.ts';
import type { DeviceHooks } from '../devices/hooks.ts';
import { formatIp } from '../core/ip.ts';

export interface Probe {
  readonly from: number;
  readonly ms: number;
  /** Set when the answer was a destination unreachable (traceroute shows !N, !H, !P or !X). */
  readonly unreachable?: UnreachableCode;
}

export interface Hop {
  readonly ttl: number;
  /** One entry per probe: null = no answer before the timeout. */
  readonly probes: readonly (Probe | null)[];
}

export interface TraceResult {
  readonly hops: readonly Hop[];
  readonly reached: boolean;
  readonly noroute: boolean;
}

export interface TraceOptions {
  readonly maxHops: number;
  readonly probes: number;
  readonly timeoutMs: number;
  readonly now: () => number;
}

export const DEFAULT_MAX_HOPS = 30;
let traceId = 0x5000;

export function runTrace(stack: IpStack, hooks: DeviceHooks, dst: number, o: TraceOptions): TraceResult {
  const id = traceId++ & 0xffff;
  const hops: Hop[] = [];
  let seq = 0;
  for (let ttl = 1; ttl <= o.maxHops; ttl++) {
    const probes: (Probe | null)[] = [];
    let done = false;
    for (let p = 0; p < o.probes; p++) {
      const start = o.now();
      let result: EchoResult | undefined;
      const sent = stack.echo(dst, id, seq++, undefined, (r) => { result = r; }, ttl);
      if (!sent) return { hops, reached: false, noroute: true };
      hooks.runUntil(() => result !== undefined, o.timeoutMs);
      probes.push(result ? { from: result.from, ms: o.now() - start, ...(result.kind === 'unreachable' ? { unreachable: result.code } : {}) } : null);
      if (result && result.kind !== 'ttl') done = true;
    }
    hops.push({ ttl, probes });
    if (done) return { hops, reached: true, noroute: false };
  }
  return { hops, reached: false, noroute: false };
}

/** A believable fraction of a millisecond for times that the simulator measures in whole ms. */
export function fineMs(ms: number, hop: number, probe: number): string {
  return (ms + ((hop * 7 + probe * 3) % 10) / 37 + 0.211).toFixed(3);
}

function firstFrom(h: Hop): number | undefined {
  return h.probes.find((p): p is Probe => p !== null)?.from;
}

/** traceroute's mark after the time of a destination unreachable. */
const UNREACHABLE_MARK: Readonly<Record<UnreachableCode, string>> = { net: '!N', host: '!H', port: '!P', admin: '!X' };

/** GNU/Linux traceroute (inetutils/traceroute 2.1 layout). */
export function linuxTraceLines(target: string, dst: number, r: TraceResult, o: { numeric: boolean; gateway?: number; maxHops: number }): string[] {
  const lines = [`traceroute to ${target} (${formatIp(dst)}), ${o.maxHops} hops max, 60 byte packets`];
  for (const h of r.hops) {
    let last: number | undefined;
    const parts = h.probes.map((p, i) => {
      if (!p) return '*';
      const who = p.from === last ? '' : o.numeric ? `${formatIp(p.from)}  ` : `${p.from === o.gateway ? '_gateway' : formatIp(p.from)} (${formatIp(p.from)})  `;
      last = p.from;
      return `${who}${fineMs(p.ms, h.ttl, i)} ms${p.unreachable ? ` ${UNREACHABLE_MARK[p.unreachable]}` : ''}`;
    });
    lines.push(`${String(h.ttl).padStart(2)}${parts.map((t, i) => (t === '*' && i > 0 ? ` ${t}` : `  ${t}`)).join('')}`);
  }
  return lines;
}

/** Windows tracert. */
export function windowsTraceLines(shown: string, r: TraceResult, maxHops: number): string[] {
  const lines = ['', `Tracing route to ${shown} over a maximum of ${maxHops} hops`, ''];
  for (const h of r.hops) {
    const cols = h.probes.map((p) => (p ? `${(p.ms < 1 ? '<1' : String(p.ms)).padStart(6)} ms` : '     *   ')).join('');
    const from = firstFrom(h);
    const refused = h.probes.find((p) => p?.unreachable);
    if (refused?.unreachable) {
      lines.push(`${String(h.ttl).padStart(3)}  ${formatIp(refused.from)}  reports: Destination ${refused.unreachable === 'net' ? 'net' : 'host'} unreachable.`);
      continue;
    }
    lines.push(`${String(h.ttl).padStart(3)}${cols}  ${from === undefined ? 'Request timed out.' : formatIp(from)}`);
  }
  lines.push('', 'Trace complete.', '');
  return lines;
}

/** IOS traceroute's letter for each unreachable (A administratively prohibited, N network, H host, U port). */
const IOS_MARK: Readonly<Record<UnreachableCode, string>> = { net: '!N', host: '!H', port: '!U', admin: '!A' };
const hasUnreachable = (h: Hop): boolean => h.probes.some((p) => p?.unreachable);

/** IOS traceroute. */
export function iosTraceLines(target: string, r: TraceResult): string[] {
  const lines = ['Type escape sequence to abort.', `Tracing the route to ${target}`, ''];
  for (const h of r.hops) {
    const from = firstFrom(h);
    if (from === undefined) {
      lines.push(`${String(h.ttl).padStart(3)}  *    *    * `);
      continue;
    }
    lines.push(`${String(h.ttl).padStart(3)} ${formatIp(from)} ${h.probes.map((p) => (!p ? '*' : p.unreachable ? IOS_MARK[p.unreachable] : `${p.ms} msec`)).join(hasUnreachable(h) ? '  ' : ' ')}`);
  }
  return lines;
}
