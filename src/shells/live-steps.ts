/** A terminal program's waits (0.92.0): fast-forwarded in a network all in this page, else live (net/live-wait.ts). */
import type { DeviceHooks } from '../devices/hooks.ts';
import type { Gen } from '../bash/types.ts';
import { runSteps, waitLive, waitsLive, type Steps } from '../net/live-wait.ts';

export function* stepsIn<T>(hooks: Pick<DeviceHooks, 'runUntil' | 'outside'>, steps: Steps<T>): Gen<T> {
  if (!waitsLive(hooks)) return runSteps(hooks, steps);
  try {
    for (let r = steps.next(); ; r = steps.next()) {
      if (r.done) return r.value;
      // shortcut: driven synchronously (inside $(…)) the wait ends at once and the reply counts as not come; fine for terminals.
      yield { kind: 'wait', until: waitLive(r.value) };
    }
  } finally {
    steps.return(undefined as never); // Ctrl+C: the client's own cleanup (ping's echo id) still runs
  }
}
