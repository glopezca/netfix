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
  /** Stops the simulator and empties the mount element. */
  destroy(): void;
}

export interface NetfixApi {
  embed(mount: HTMLElement, options?: unknown): EmbedHandle;
  evaluate(topology: unknown, checklist: unknown): Evaluation;
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

/** The element `netfix.embed` mounts on (the host page may pass anything). */
export function checkMount(mount: unknown): asserts mount is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(mount instanceof HTMLElement)) throw new Error('netfix.embed: falta el elemento donde montar Netfix');
}

/** `netfix.evaluate`: the checklist is validated before marking. */
export function evaluateFile(topology: unknown, checklist: unknown): Evaluation {
  return evaluate(topology, parseChecklist(checklist));
}

/** Publishes the API as `globalThis.netfix` (read-only, so a page script cannot swap it). */
export function installApi(api: NetfixApi): void {
  // Own property only: an element with id="netfix" also shows up as a (named) property of window.
  if (Object.hasOwn(globalThis, 'netfix')) throw new Error('netfix: la API ya está instalada (¿Netfix cargado dos veces?)');
  Object.defineProperty(globalThis, 'netfix', { value: Object.freeze(api), enumerable: false, writable: false, configurable: false });
}
