/** A terminal program's waits (0.92.0): fast-forwarded in a network all in this page, else live (net/live-wait.ts). */
import type { DeviceHooks } from '../devices/hooks.ts';
import type { Gen } from '../bash/types.ts';
import { runSteps, waitLive, waitsLive, type Steps } from '../net/live-wait.ts';

/** `live`: the session is an interactive terminal's (Interp#liveWaits); scripts run by other callers stay synchronous. */
export function* stepsIn<T>(hooks: Pick<DeviceHooks, 'runUntil' | 'outside'>, steps: Steps<T>, live: boolean): Gen<T> {
  if (!live || !waitsLive(hooks)) return runSteps(hooks, steps);
  try {
    for (let r = steps.next(); ; r = steps.next()) {
      if (r.done) return r.value;
      // The terminal resumes with ''; a synchronous driver ($(…), a trap, PROMPT_COMMAND) with null: fast-forward then.
      const resumed = yield { kind: 'wait', until: waitLive(r.value) };
      if (resumed === null) hooks.runUntil(r.value.done, r.value.ms);
    }
  } finally {
    steps.return(undefined as never); // Ctrl+C: the client's own cleanup (ping's echo id) still runs
  }
}
