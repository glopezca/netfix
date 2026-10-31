/**
 * The guided lab (mission) a workspace belongs to and the hints already shown, saved in the topology file. Pure:
 * no imports, so `net/topology.ts` can read it without depending on the missions themselves.
 */
export interface MissionState {
  readonly id: string;
  /** Hints shown, as `task.level` (1.1 = first hint of task 1). */
  readonly hints: readonly string[];
  /** "View solution" loaded the solved lab: the marks are not the student's own work. */
  readonly solution?: true;
}

const ID_RE = /^[a-z0-9-]{1,64}$/;
const HINT_RE = /^\d{1,2}\.[1-3]$/;
/** 20 tasks × 3 levels. */
const MAX_HINTS = 60;

/** The mission state in a file (untrusted), or undefined when there is none or it is not valid. */
export function parseMissionState(data: unknown): MissionState | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const { id, hints, solution } = data as Record<string, unknown>;
  if (typeof id !== 'string' || !ID_RE.test(id)) return undefined;
  // A saved state never holds more than MAX_HINTS entries: cut first, so a huge array costs nothing to read.
  const list = Array.isArray(hints) ? hints.slice(0, MAX_HINTS).filter((h): h is string => typeof h === 'string' && HINT_RE.test(h)) : [];
  return { id, hints: [...new Set(list)].slice(0, MAX_HINTS), ...(solution === true ? { solution: true } : {}) };
}

/** The state with one more hint shown (the same object when it was already shown). */
export function withHint(state: MissionState, hint: string): MissionState {
  if (state.hints.includes(hint) || !HINT_RE.test(hint) || state.hints.length >= MAX_HINTS) return state;
  return { ...state, hints: [...state.hints, hint] };
}
