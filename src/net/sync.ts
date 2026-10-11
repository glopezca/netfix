/** Runs an asynchronous network operation to completion by fast-forwarding simulated time. */
import type { DeviceHooks } from '../devices/hooks.ts';

const DEFAULT_MAX_MS = 10_000;

/**
 * Starts `op` and advances the simulation until it reports a result.
 * Returns undefined only if the simulation could not produce one within `maxMs`.
 */
export function runSync<T>(hooks: DeviceHooks, op: (done: (r: T) => void) => void, maxMs = DEFAULT_MAX_MS): T | undefined {
  let result: T | undefined;
  let finished = false;
  op((r) => {
    if (finished) return;
    finished = true;
    result = r;
  });
  if (!finished) hooks.runUntil(() => finished, maxMs);
  return result;
}
