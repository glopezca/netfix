/**
 * Waiting for a reply (0.92.0). A client written as steps yields each wait — what it waits for and for how long — and is
 * driven one of two ways: synchronously, fast-forwarding the simulated clock (the network is all in this page: the reply
 * is computed meanwhile), or live, when a device carries traffic out of the page (a host's kind linked to other pages):
 * that reply arrives in a later task of the browser, so the wait lets the page run while its clock moves the network.
 */
import type { DeviceHooks } from '../devices/hooks.ts';

export interface Wait {
  readonly done: () => boolean;
  /** Simulated milliseconds when synchronous; real ones when live. */
  readonly ms: number;
}

export type Steps<T> = Generator<Wait, T, void>;

/** Every wait fast-forwards the clock: the behaviour of a network that is all in this page. */
export function runSteps<T>(hooks: Pick<DeviceHooks, 'runUntil'>, steps: Steps<T>): T {
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    hooks.runUntil(r.value.done, r.value.ms);
  }
}

const POLL_MS = 25;
/**
 * A reply from outside the page takes real time on top of the simulated one: each page moves its network in ticks (a
 * quarter second in the real-time lab) and the relay has its own latency. Waits for a reply (half a second or more) get
 * this much longer live; short fixed pauses (ping's window for duplicates) do not.
 */
export const LIVE_SLACK_MS = 2000;
const REPLY_WAIT_MS = 500;
/** The page's (or Node's) timer: the core has no DOM types. */
const later = (fn: () => void, ms: number): void => { (globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown }).setTimeout(fn, ms); };

/** One wait in real time: resolves when it is done or its time is up; the page's clock moves the network meanwhile. */
export function waitLive(w: Wait): Promise<void> {
  const end = Date.now() + w.ms + (w.ms >= REPLY_WAIT_MS ? LIVE_SLACK_MS : 0);
  return new Promise((resolve) => {
    const check = (): void => {
      if (w.done() || Date.now() >= end) resolve();
      else later(check, POLL_MS);
    };
    check();
  });
}

export async function runLive<T>(steps: Steps<T>): Promise<T> {
  for (let r = steps.next(); ; r = steps.next()) {
    if (r.done) return r.value;
    await waitLive(r.value);
  }
}

/** Whether a device's waits must be live (its network reaches out of the page). */
export const waitsLive = (hooks: Pick<DeviceHooks, 'outside'>): boolean => hooks.outside?.() === true;
