/**
 * Device kinds added from outside the core (extension points, S23 of FixIT Classroom). A kind brings how its devices
 * are created, saved and loaded, and how they take the host page's context (a link, a session…); the topology,
 * the file format and the restrictions treat it as one more kind. Its look in the editor is ui/device-kind-ui.ts.
 */
import type { NetDevice } from './network.ts';
import type { SimClock } from '../core/clock.ts';

export type BuiltinDeviceKind = 'router' | 'switch' | 'pc' | 'server' | 'linuxrouter' | 'cloud';
export const BUILTIN_DEVICE_KINDS: readonly BuiltinDeviceKind[] = ['router', 'switch', 'pc', 'server', 'linuxrouter', 'cloud'];
/** The palette's order of the built-in kinds (registered ones follow): its piles and Configuración's panels follow it. */
export const PALETTE_KINDS: readonly BuiltinDeviceKind[] = ['pc', 'server', 'switch', 'router', 'linuxrouter', 'cloud'];
/** A built-in kind or one registered with `registerDeviceKind`. */
export type DeviceKind = BuiltinDeviceKind | (string & Record<never, never>);

/** A device of a registered kind: what the network needs, and a name the editor keeps as its label. */
export interface ExtensionDevice extends NetDevice {
  name: string;
}

export interface DeviceKindDef {
  /** The label of a new one: prefix + first free number (as Router0…). */
  readonly prefix: string;
  /** The key of its settings in a saved device (default: the kind). */
  readonly field?: string;
  readonly create: (o: { readonly id: string; readonly name: string; readonly clock: SimClock; readonly seed: number }) => ExtensionDevice;
  /** Its settings for the file (JSON-safe). */
  readonly save: (d: ExtensionDevice) => unknown;
  /** Settings from a file: untrusted, anything invalid must fall back to defaults. */
  readonly load: (d: ExtensionDevice, data: unknown) => void;
  /** The host page's context for this kind (null: none, or the device left the lab). */
  readonly connect?: (d: ExtensionDevice, context: unknown) => void;
  /** The label a new one takes from the context, if any (else the prefix and a number). */
  readonly label?: (context: unknown) => string | undefined;
}

const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const defs = new Map<string, DeviceKindDef>();
/** Every kind known now (built-in, then declared): live, so lists that hold it (DEVICE_KINDS) follow. */
const known: DeviceKind[] = [...BUILTIN_DEVICE_KINDS];
const tabsByKind = new Map<string, readonly string[]>();

/** The kinds known now, built-in ones first. Read-only for its users; declaring a kind adds to it. */
export const KNOWN_DEVICE_KINDS: readonly DeviceKind[] = known;

/**
 * Makes a kind known by name and window tabs (the first is never hidden by restrictions), without its devices: enough
 * for restrictions and checklists to name it (a light entry point). Declaring it again with the same tabs does nothing.
 */
export function declareDeviceKind(kind: string, o: { readonly tabs: readonly string[] }): void {
  if (!KIND_RE.test(kind)) throw new Error(`Tipo de equipo: nombre no válido «${kind}»`);
  if ((BUILTIN_DEVICE_KINDS as readonly string[]).includes(kind)) throw new Error(`El tipo de equipo «${kind}» ya existe`);
  if (o.tabs.length === 0 || o.tabs.some((t) => !KIND_RE.test(t))) throw new Error(`Tipo de equipo «${kind}»: pestañas no válidas`);
  const before = tabsByKind.get(kind);
  if (before) {
    if (before.join() !== o.tabs.join()) throw new Error(`El tipo de equipo «${kind}» ya existe`);
    return;
  }
  tabsByKind.set(kind, Object.freeze([...o.tabs]));
  known.push(kind);
}

/** Adds a device kind (lowercase, digits and dashes, up to 32) with its devices: declares it, once. */
export function registerDeviceKind(kind: string, def: DeviceKindDef & { readonly tabs: readonly string[] }): void {
  if (defs.has(kind)) throw new Error(`El tipo de equipo «${kind}» ya existe`);
  declareDeviceKind(kind, { tabs: def.tabs });
  defs.set(kind, Object.freeze({ ...def }));
}

export const deviceKindDef = (kind: string): DeviceKindDef | undefined => defs.get(kind);

/** Every kind a file or a restriction may name: the built-in ones, then the declared ones. */
export const deviceKinds = (): readonly DeviceKind[] => [...known];

/** The window tabs of a declared kind (undefined for built-in or unknown ones). */
export const declaredTabs = (kind: string): readonly string[] | undefined => tabsByKind.get(kind);

export const isBuiltinKind = (kind: string): kind is BuiltinDeviceKind => (BUILTIN_DEVICE_KINDS as readonly string[]).includes(kind);

export function isExtensionDevice(d: { readonly kind: string }): d is ExtensionDevice {
  return defs.has(d.kind);
}
