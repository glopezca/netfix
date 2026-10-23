/** Synchronous ping driver shared by PCs, routers and switches. */
import type { IpStack, EchoResult } from './ipstack.ts';
import type { DeviceHooks } from '../devices/hooks.ts';

/** A reply may come with others for the same request (a broadcast is answered by every device that answers it). */
export type PingOutcome = (EchoResult & { readonly dups?: readonly EchoResult[] }) | { kind: 'timeout' } | { kind: 'noroute' };

let pingId = 1;
const INTER_PACKET_MS = 1;
/** After the first answer, how long the other devices of a broadcast have to answer the same request. */
const DUP_WINDOW_MS = 50;

export function runPing(
  stack: IpStack,
  hooks: DeviceHooks,
  dst: number,
  opts: { count: number; timeoutMs: number; src?: number },
): PingOutcome[] {
  const id = pingId++ & 0xffff;
  // Every reply waits a little for others: a directed broadcast of a remote network is not known as one here.
  // (A real ping waits a whole second between requests; these few simulated milliseconds change nothing.)
  try {
    return pings(stack, hooks, dst, opts, id, DUP_WINDOW_MS);
  } finally {
    stack.endEcho(id);
  }
}

function pings(stack: IpStack, hooks: DeviceHooks, dst: number, opts: { count: number; timeoutMs: number; src?: number }, id: number, window: number): PingOutcome[] {
  const results: PingOutcome[] = [];
  for (let seq = 0; seq < opts.count; seq++) {
    let result: EchoResult | undefined;
    const dups: EchoResult[] = [];
    const sent = stack.echo(dst, id, seq, opts.src, (r) => { result = r; }, undefined, (r) => { if (r.kind === 'reply') dups.push(r); });
    if (!sent) {
      results.push({ kind: 'noroute' });
      continue;
    }
    hooks.runUntil(() => result !== undefined, opts.timeoutMs);
    hooks.runUntil(() => false, result ? window : INTER_PACKET_MS);
    const answer: EchoResult | undefined = result;
    results.push(answer ? { ...answer, dups } : { kind: 'timeout' });
  }
  return results;
}
