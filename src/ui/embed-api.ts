/** DOM side of `netfix.embed` / `netfix.evaluate` (needs `HTMLElement` and `globalThis`, so it lives in `ui`, not the Core). */
import type { EmbedHandle } from '../classroom/embed.ts';
import type { Evaluation } from '../classroom/evaluate.ts';

export interface NetfixApi {
  embed(mount: HTMLElement, options?: unknown): EmbedHandle;
  evaluate(topology: unknown, checklist: unknown): Evaluation;
}

/** The element `netfix.embed` mounts on (the host page may pass anything). */
export function checkMount(mount: unknown): asserts mount is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(mount instanceof HTMLElement)) throw new Error('netfix.embed: falta el elemento donde montar Netfix');
}

/** Publishes the API as `globalThis.netfix` (read-only, so a page script cannot swap it). */
export function installApi(api: NetfixApi): void {
  // Own property only: an element with id="netfix" also shows up as a (named) property of window.
  if (Object.hasOwn(globalThis, 'netfix')) throw new Error('netfix: la API ya está instalada (¿Netfix cargado dos veces?)');
  Object.defineProperty(globalThis, 'netfix', { value: Object.freeze(api), enumerable: false, writable: false, configurable: false });
}
