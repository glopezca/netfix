/** Synchronous ping driver shared by PCs, routers and switches. */
import type { IpStack, EchoResult } from './ipstack.ts';
import type { DeviceHooks } from '../devices/hooks.ts';

export type PingOutcome = EchoResult | { kind: 'timeout' } | { kind: 'noroute' };

let pingId = 1;
const INTER_PACKET_MS = 1;

export function runPing(
  stack: IpStack,
  hooks: DeviceHooks,
  dst: number,
  opts: { count: number; timeoutMs: number; src?: number },
): PingOutcome[] {
  const id = pingId++ & 0xffff;
  const results: PingOutcome[] = [];
  for (let seq = 0; seq < opts.count; seq++) {
    let result: PingOutcome | undefined;
    const sent = stack.echo(dst, id, seq, opts.src, (r) => { result = r; });
    if (!sent) {
      results.push({ kind: 'noroute' });
      continue;
    }
    hooks.runUntil(() => result !== undefined, opts.timeoutMs);
    results.push(result ?? { kind: 'timeout' });
    hooks.runUntil(() => false, INTER_PACKET_MS);
  }
  return results;
}
