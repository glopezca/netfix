/**
 * 802.1D timers on a running network: a port the tree puts to forwarding goes through Listening (forward delay,
 * 15 s) and Learning (15 s) first, unless it is an edge port (portfast) or its switch runs rapid-pvst. The converged
 * result of `computeStp` is overlaid with those states; a port that was already forwarding stays so.
 */
import type { StpPortState, StpResult, StpVlan } from './stp.ts';

export const LISTEN_MS = 15_000;
export type StpState = 'BLK' | 'LIS' | 'LRN' | 'FWD';

/** State of a port `elapsed` ms after the tree made it forwarding. */
export function stpTransition(elapsed: number): StpState {
  if (elapsed < LISTEN_MS) return 'LIS';
  return elapsed < 2 * LISTEN_MS ? 'LRN' : 'FWD';
}

const keyOf = (device: string, vlan: number, port: string): string => `${device}|${vlan}|${port}`;

export class StpTimers {
  /** When each port in transition started it. */
  private readonly started = new Map<string, number>();
  /** The state each port had in the last overlay. */
  private readonly last = new Map<string, StpState>();

  /** The tree as it is when the timers start: what forwards now keeps forwarding. */
  seed(base: StpResult): void {
    this.started.clear();
    this.last.clear();
    for (const [d, vlans] of base) for (const [v, s] of vlans) for (const [p, st] of s.ports) this.last.set(keyOf(d, v, p), st.state);
  }

  /** `base` with the ports in transition, and the instant the overlay must be recomputed (Infinity: never). */
  overlay(base: StpResult, now: number): { readonly tree: StpResult; readonly until: number } {
    let until = Infinity;
    const seen = new Set<string>();
    const tree = new Map<string, Map<number, StpVlan>>();
    for (const [d, vlans] of base) {
      const per = new Map<number, StpVlan>();
      for (const [v, s] of vlans) {
        const ports = new Map<string, StpPortState>();
        for (const [p, st] of s.ports) {
          seen.add(keyOf(d, v, p));
          const state = this.stateOf(keyOf(d, v, p), st, s.rapid === true, now);
          const start = this.started.get(keyOf(d, v, p));
          if (start !== undefined) until = Math.min(until, start + (state === 'LIS' ? LISTEN_MS : 2 * LISTEN_MS));
          ports.set(p, { ...st, state, forwarding: state === 'FWD' });
        }
        per.set(v, { ...s, ports });
      }
      tree.set(d, per);
    }
    // A port that went down starts again from Listening when it comes back.
    for (const k of [...this.last.keys()]) if (!seen.has(k)) { this.last.delete(k); this.started.delete(k); }
    return { tree, until };
  }

  private stateOf(key: string, st: StpPortState, rapid: boolean, now: number): StpState {
    let state: StpState = 'BLK';
    if (st.state === 'FWD') {
      const start = this.started.get(key);
      const instant = st.edge || rapid || (this.last.get(key) === 'FWD' && start === undefined);
      state = instant ? 'FWD' : stpTransition(now - (start ?? now));
      if (!instant && start === undefined) this.started.set(key, now);
    }
    if (state === 'FWD' || state === 'BLK') this.started.delete(key);
    this.last.set(key, state);
    return state;
  }
}
