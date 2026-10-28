/**
 * The workspace kept between visits: the browser autosave, and the fingerprint of the topology as it was last loaded
 * or saved to a file, to tell whether there are unsaved changes before replacing it.
 */
import { Topology } from '../net/topology.ts';
import { sha256, toBase64 } from '../core/sha256.ts';
import type { AppSession } from '../classroom/embed.ts';

export const AUTOSAVE_KEY = 'netfix:workspace:v1';
/** Workspace autosaved before the rename (netsim ≤ 0.4.0). */
const LEGACY_AUTOSAVE_KEY = 'netsim:workspace:v1';
const SAVED_KEY = 'netfix:workspace-saved:v1';

export interface KeyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Embedded nothing is stored in the browser: this map survives rebuilding the interface in another language. */
const memory = new Map<string, string>();
export const MEMORY_STORE: KeyStore & { clear(): void } = {
  get: (k) => memory.get(k) ?? null,
  set: (k, v) => { memory.set(k, v); },
  clear: () => memory.clear(),
};

/** The change sent to the host page that embeds Netfix; an error there must not break the simulator. */
export function notifyHost(s: AppSession, topo: Topology): void {
  try {
    s.onChange?.(topo.toJSON());
  } catch {
    // The host page's own error: nothing to undo here.
  }
}

/** JSON with the keys of every object sorted, so the same content always gives the same text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v));
}

/** SHA-256 of the topology file: equal fingerprints, same network (whatever the order of the keys). */
export function fingerprint(topo: Topology): string {
  return toBase64(sha256(new TextEncoder().encode(canonical(topo.toJSON()))));
}

/** The autosaved workspace, or null (none, or unreadable). */
export function restoreWorkspace(store: KeyStore): Topology | null {
  const saved = store.get(AUTOSAVE_KEY) ?? store.get(LEGACY_AUTOSAVE_KEY);
  if (!saved) return null;
  try {
    return Topology.fromJSON(JSON.parse(saved));
  } catch {
    return null;
  }
}

/** Whether the workspace changed since it was loaded or saved to a file (the mark lives in the store). */
export class SavedState {
  private readonly store: KeyStore;

  constructor(store: KeyStore) {
    this.store = store;
  }

  /** Loaded from a lab or a file, or saved: this is the clean state. */
  mark(topo: Topology): void {
    this.store.set(SAVED_KEY, fingerprint(topo));
  }

  /** The workspace restored at start-up: without a mark yet (first run after an update) it counts as saved. */
  adopt(topo: Topology): void {
    if (this.store.get(SAVED_KEY) === null) this.mark(topo);
  }

  dirty(topo: Topology): boolean {
    return this.store.get(SAVED_KEY) !== fingerprint(topo);
  }
}

/** The autosaved workspace (the saved mark it had) or, when there is none or it is corrupt, `fallback` as just loaded. */
export function initialWorkspace(store: KeyStore, saved: SavedState, fallback: () => Topology): Topology {
  const restored = restoreWorkspace(store);
  if (restored) {
    saved.adopt(restored);
    return restored;
  }
  const topo = fallback();
  saved.mark(topo);
  return topo;
}
