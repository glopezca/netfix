/** DOM side of `netfix.embed` / `netfix.evaluate` (needs `HTMLElement` and `globalThis`, so it lives in `ui`, not the Core). */
import type { EmbedHandle } from '../classroom/embed.ts';
import type { Evaluation } from '../classroom/evaluate.ts';

export interface NetfixApi {
  embed(mount: HTMLElement, options?: unknown): EmbedHandle;
  /** The standalone lab (its settings, theme, autosave and preferences) mounted in a host page's element. */
  lab(mount: HTMLElement, options?: unknown): EmbedHandle;
  evaluate(topology: unknown, checklist: unknown): Evaluation;
}

/** The element `netfix.embed` mounts on (the host page may pass anything). */
export function checkMount(mount: unknown): asserts mount is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(mount instanceof HTMLElement)) throw new Error('netfix.embed: falta el elemento donde montar Netfix');
}

/**
 * The `toolbar` option of `netfix.embed` and `netfix.lab`: an element of the host page (its menu, say) where Netfix puts
 * its top bar, so the workspace gets the whole mount. Not inside the mount, nor around it: each would empty the other.
 */
export function takeToolbar(mount: HTMLElement, options: unknown): { readonly rest: unknown; readonly toolbar: HTMLElement | null } {
  if (typeof options !== 'object' || options === null || !Object.hasOwn(options, 'toolbar')) return { rest: options, toolbar: null };
  const { toolbar, ...rest } = options as Record<string, unknown>;
  if (typeof HTMLElement === 'undefined' || !(toolbar instanceof HTMLElement)) throw new Error('netfix: «toolbar» debe ser un elemento de la página');
  if (mount.contains(toolbar) || toolbar.contains(mount)) throw new Error('netfix: «toolbar» no puede estar dentro del elemento donde se monta Netfix ni contenerlo');
  return { rest, toolbar };
}

/** `netfix.lab` options: none, or only `toolbar`. */
export function labToolbar(mount: HTMLElement, options: unknown): HTMLElement | null {
  const { rest, toolbar } = takeToolbar(mount, options);
  if (rest !== undefined && (typeof rest !== 'object' || rest === null || Array.isArray(rest) || Object.keys(rest).length > 0)) {
    throw new Error('netfix.lab: la única opción es «toolbar»');
  }
  return toolbar;
}

/** Publishes the API as `globalThis.netfix` (read-only, so a page script cannot swap it). */
export function installApi(api: NetfixApi): void {
  // Own property only: an element with id="netfix" also shows up as a (named) property of window.
  if (Object.hasOwn(globalThis, 'netfix')) throw new Error('netfix: la API ya está instalada (¿Netfix cargado dos veces?)');
  Object.defineProperty(globalThis, 'netfix', { value: Object.freeze(api), enumerable: false, writable: false, configurable: false });
}
