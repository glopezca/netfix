/** Data shared by an interpreter and its subshells: the execution budget, the history and the job table. */

/** Guards against infinite loops and runaway output (shared by subshells). */
export interface Budget {
  steps: number;
  deadline: number;
  output: number;
}

export const MAX_MS = 4000;
export const MAX_OUTPUT = 4 * 1024 * 1024;
export const CHECK_EVERY = 256;

export function freshBudget(): Budget {
  return { steps: 0, deadline: Date.now() + MAX_MS, output: 0 };
}

export interface HistoryStore {
  readonly lines: string[];
  base: number;
}

export interface Job {
  readonly id: number;
  readonly pid: number;
  readonly source: string;
  readonly status: number;
}

