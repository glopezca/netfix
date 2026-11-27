/** Ping shared by PCs, routers and switches: synchronous (runPing) or as steps a live wait drives (pingSteps). */
import type { IpStack, EchoResult } from './ipstack.ts';
import type { DeviceHooks } from '../devices/hooks.ts';
import { runSteps, type Steps } from './live-wait.ts';

export interface PingOptions { readonly count: number; readonly timeoutMs: number; readonly src?: number }

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
  opts: PingOptions,
): PingOutcome[] {
  return runSteps(hooks, pingSteps(stack, dst, opts));
}

/** The same pings as steps (0.92.0): driven synchronously by runPing, or live (net/live-wait.ts). */
export function* pingSteps(stack: IpStack, dst: number, opts: PingOptions): Steps<PingOutcome[]> {
  const id = pingId++ & 0xffff;
  // Every reply waits a little for others: a directed broadcast of a remote network is not known as one here.
  // (A real ping waits a whole second between requests; these few simulated milliseconds change nothing.)
  try {
    const results: PingOutcome[] = [];
    for (let seq = 0; seq < opts.count; seq++) {
      let result: EchoResult | undefined;
      const dups: EchoResult[] = [];
      const sent = stack.echo(dst, id, seq + 1, opts.src, (r) => { result = r; }, undefined, (r) => { if (r.kind === 'reply') dups.push(r); });
      if (!sent) {
        results.push({ kind: 'noroute' });
        continue;
      }
      yield { done: () => result !== undefined, ms: opts.timeoutMs };
      yield { done: () => false, ms: result ? DUP_WINDOW_MS : INTER_PACKET_MS };
      const answer: EchoResult | undefined = result;
      results.push(answer ? { ...answer, dups } : { kind: 'timeout' });
    }
    return results;
  } finally {
    stack.endEcho(id);
  }
}
