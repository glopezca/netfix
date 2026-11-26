/** DOM side of `netfix.embed` / `netfix.evaluate` (needs `HTMLElement` and `globalThis`, so it lives in `ui`, not the Core). */
import { hostOption, hostOptionNames } from './host-options.ts';
import type { EmbedHandle } from '../classroom/embed.ts';
import type { Evaluation } from '../classroom/evaluate.ts';
import { isLocale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';

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

/** What a host page decides for Netfix (options of `netfix.embed` and `netfix.lab`). */
export interface HostOptions {
  /** An element of the host page (its menu, say) for Netfix's top bar; null: the bar is at the top of the mount. */
  readonly toolbar: HTMLElement | null;
  /** An element of the host page (its bar) for the workspace's actions: undo/redo, clipboard and zoom. */
  readonly actions: HTMLElement | null;
  /** The interface language, chosen by the host (it then keeps it: nothing is stored in this browser). */
  readonly locale: Locale | null;
  /** Whether replacing unsaved work asks first; undefined: this browser's setting. */
  readonly confirmUnsaved: boolean | undefined;
  /** Hosted (with `toolbar`): devices and tools in a sidebar on the left ('side', the default) or below ('bottom'). */
  readonly palette: 'side' | 'bottom';
  /** Similar devices piled on one palette button; undefined: this browser's setting (off by default). */
  readonly piles: boolean | undefined;
  /** Whether the guided labs (missions) show; undefined: this browser's setting (off by default; embedded, always on). */
  readonly missions: boolean | undefined;
  /** The values of the options extensions registered (ui/host-options.ts), checked, by option name. */
  readonly extensions: Readonly<Record<string, unknown>>;
  /** A way back to the host's page, first in the palette (its label; `onClick` asks over unsaved work, if it wants). */
  readonly back: HostBack | null;
}

export interface HostBack { readonly label: string; readonly onClick: () => void }

const BACK_LABEL_MAX = 60;

export const NO_HOST: HostOptions = Object.freeze({ toolbar: null, actions: null, locale: null, confirmUnsaved: undefined, palette: 'side', piles: undefined, missions: undefined, extensions: Object.freeze({}), back: null });
const HOST_KEYS = ['toolbar', 'actions', 'locale', 'confirmUnsaved', 'palette', 'piles', 'missions', 'back'] as const;

/** A host element for part of Netfix: in the page, and neither inside the mount nor around it (each would empty the other). */
function hostElement(mount: HTMLElement, v: unknown, name: string): HTMLElement | null {
  if (v === undefined) return null;
  if (typeof HTMLElement === 'undefined' || !(v instanceof HTMLElement)) throw new Error(`netfix: «${name}» debe ser un elemento de la página`);
  if (mount.contains(v) || v.contains(mount)) throw new Error(`netfix: «${name}» no puede estar dentro del elemento donde se monta Netfix ni contenerlo`);
  return v;
}

/**
 * Takes the host options out of `options` (the rest goes on to `embedSession`). `toolbar` must be a page element not
 * inside the mount nor around it (each would empty the other); `locale`, one of Netfix's; `confirmUnsaved`, a boolean.
 */
export function takeHostOptions(mount: HTMLElement, options: unknown): { readonly rest: unknown; readonly host: HostOptions } {
  if (typeof options !== 'object' || options === null || ![...HOST_KEYS, ...hostOptionNames()].some((k) => Object.hasOwn(options, k))) return { rest: options, host: NO_HOST };
  const { toolbar, actions, locale, confirmUnsaved, palette, piles, missions, back, ...others } = options as Record<string, unknown>;
  const bar = hostElement(mount, toolbar, 'toolbar');
  const acts = hostElement(mount, actions, 'actions');
  if (bar && acts && (bar.contains(acts) || acts.contains(bar))) throw new Error('netfix: «toolbar» y «actions» deben ser elementos distintos y separados');
  if (locale !== undefined && !isLocale(locale)) throw new Error('netfix: «locale» no es un idioma de Netfix');
  if (confirmUnsaved !== undefined && typeof confirmUnsaved !== 'boolean') throw new Error('netfix: «confirmUnsaved» debe ser true o false');
  if (palette !== undefined && palette !== 'side' && palette !== 'bottom') throw new Error('netfix: «palette» debe ser \'side\' o \'bottom\'');
  if (piles !== undefined && typeof piles !== 'boolean') throw new Error('netfix: «piles» debe ser true o false');
  if (missions !== undefined && typeof missions !== 'boolean') throw new Error('netfix: «missions» debe ser true o false');
  const { rest, extensions } = takeExtensions(others);
  return { rest, host: { toolbar: bar, actions: acts, locale: (locale as Locale | undefined) ?? null, confirmUnsaved: confirmUnsaved as boolean | undefined, palette: palette ?? 'side', piles: piles as boolean | undefined, missions: missions as boolean | undefined, extensions, back: backOf(back) } };
}

/** The host's way back: a short label and a function. */
function backOf(v: unknown): HostBack | null {
  if (v === undefined) return null;
  const label: unknown = typeof v === 'object' && v !== null ? Reflect.get(v, 'label') : undefined;
  const onClick: unknown = typeof v === 'object' && v !== null ? Reflect.get(v, 'onClick') : undefined;
  if (typeof label !== 'string' || label.trim() === '' || label.length > BACK_LABEL_MAX || typeof onClick !== 'function') throw new Error('netfix: «back» debe ser { label, onClick }');
  return { label: label.trim(), onClick: () => { (onClick as () => void)(); } };
}

/** The registered extension options out of `options`, each checked by its extension. */
function takeExtensions(options: Record<string, unknown>): { readonly rest: Record<string, unknown>; readonly extensions: Readonly<Record<string, unknown>> } {
  // No prototype: an own «__proto__» key stays a plain key (and embedSession rejects it as unknown).
  const rest: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const extensions: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(options)) {
    const spec = hostOption(k);
    if (spec && v !== undefined) extensions[k] = spec.parse(v);
    else if (!spec) rest[k] = v;
  }
  return { rest, extensions: Object.freeze(extensions) };
}

/** `netfix.lab` options: none, or only the host options. */
export function labOptions(mount: HTMLElement, options: unknown): HostOptions {
  const { rest, host } = takeHostOptions(mount, options);
  if (rest !== undefined && (typeof rest !== 'object' || rest === null || Array.isArray(rest) || Object.keys(rest).length > 0)) {
    throw new Error(`netfix.lab: solo admite ${[...HOST_KEYS, ...hostOptionNames()].map((k) => `«${k}»`).join(', ')}`);
  }
  return host;
}

/** Publishes the API as `globalThis.netfix` (read-only, so a page script cannot swap it). */
export function installApi(api: NetfixApi): void {
  // Own property only: an element with id="netfix" also shows up as a (named) property of window.
  if (Object.hasOwn(globalThis, 'netfix')) throw new Error('netfix: la API ya está instalada (¿Netfix cargado dos veces?)');
  Object.defineProperty(globalThis, 'netfix', { value: Object.freeze(api), enumerable: false, writable: false, configurable: false });
}
