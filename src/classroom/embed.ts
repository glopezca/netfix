/**
 * Embedding Netfix in another page (the classroom): the page loads the single-file build with
 * `<div id="app" data-embed>` (so it does not start by itself) and calls `netfix.embed(mount, options)` with the
 * starting topology, the restriction policy and a change callback. Embedded, nothing is autosaved in the browser:
 * the host page receives each change and can export the topology at any time. `netfix.evaluate` marks a topology
 * file against a checklist, as the classroom server does.
 */
import { Topology } from '../net/topology.ts';
import type { TopologyFile } from '../net/topology.ts';
import { NO_RESTRICTIONS, parseRestrictions } from './restrictions.ts';
import type { Restrictions } from './restrictions.ts';
import { parseChecklist } from './checklist.ts';
import { evaluate } from './evaluate.ts';
import type { Evaluation } from './evaluate.ts';

export type ChangeListener = (file: TopologyFile) => void;

export interface AppSession {
  readonly policy: Restrictions;
  /** Embedded in another page: no autosave in the browser; changes go to `onChange`. */
  readonly embedded: boolean;
  readonly onChange: ChangeListener | null;
}

export const STANDALONE: AppSession = Object.freeze({ policy: NO_RESTRICTIONS, embedded: false, onChange: null });

export interface EmbedHandle {
  /** The current topology, as a saved file. */
  exportTopology(): TopologyFile;
  /**
   * Opens a file the host read from its own storage, as Import… does: over unsaved changes it asks first. Resolves to
   * whether it was opened (false: the user kept their work, or Netfix is no longer mounted); a bad file throws.
   */
  open(file: unknown, name: string): Promise<boolean>;
  /** The host stored the current topology: it is no longer unsaved work. */
  markSaved(): void;
  /** Shows one of Netfix's pages: 'net', 'docs' (if the classroom allows it), 'settings' or 'about'. False: not shown. */
  showView(view: string): boolean;
  /** The interface in another language (the host's choice: rebuilt, the network kept). */
  setLocale(locale: string): void;
  /** Whether replacing unsaved work asks first (the host's setting). */
  setConfirmUnsaved(on: boolean): void;
  /**
   * The bar's file actions, for a host's own File menu: 'new' (Nuevo), 'import' (Importar…, the file picker) or 'export'
   * (Exportar). False: not allowed by the restrictions, or Netfix is no longer mounted.
   */
  file(action: string): boolean;
  /** Stops the simulator and empties the mount element. */
  destroy(): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The session and starting topology of `netfix.embed` options (untrusted: validated, errors thrown). */
export function embedSession(options: unknown): { readonly session: AppSession; readonly topology: Topology } {
  const o = options ?? {};
  if (!isRecord(o)) throw new Error('netfix.embed: las opciones deben ser un objeto');
  const extra = Object.keys(o).find((k) => !['topology', 'restrictions', 'onChange'].includes(k));
  if (extra) throw new Error(`netfix.embed: opción desconocida «${extra}»`);
  if (o.onChange !== undefined && typeof o.onChange !== 'function') throw new Error('netfix.embed: onChange debe ser una función');
  const listener = o.onChange as ChangeListener | undefined;
  const session: AppSession = Object.freeze({ policy: parseRestrictions(o.restrictions), embedded: true, onChange: listener ?? null });
  return { session, topology: o.topology === undefined ? new Topology() : Topology.fromJSON(o.topology) };
}

/** `netfix.evaluate`: the checklist is validated before marking. */
export function evaluateFile(topology: unknown, checklist: unknown): Evaluation {
  return evaluate(topology, parseChecklist(checklist));
}
