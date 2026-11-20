/**
 * How a registered device kind (net/device-kinds.ts) looks in the editor: its name, model and icon in the palette and
 * on the canvas, its window, the lines under it and the address at each cable end. Texts come as functions, already in
 * the page's language (an extension brings its own); restrictions still decide which tabs are shown.
 */
import type { ExtensionDevice } from '../net/device-kinds.ts';
import type { Tab } from './windows.ts';

export interface DeviceWindowContext {
  /** Call after a change the canvas must show (a mode, an address). */
  afterCommand(): void;
  /** The device at the other end of a port's cable, if any. */
  connected(port: string): string | undefined;
}

export interface DeviceUi {
  readonly name: () => string;
  readonly model: () => string;
  /** SVG markup, drawn with the same CSS variables as the built-in icons (--dev-side, --dev-edge, --dev-mark). */
  readonly icon: string;
  readonly windowTitle: (label: string) => string;
  readonly tabs: (d: ExtensionDevice, ctx: DeviceWindowContext) => Tab[];
  /** The lines under its name on the canvas. */
  readonly caption?: (d: ExtensionDevice) => readonly string[];
  /** The addresses at the end of a cable on `port` (already formatted, e.g. 192.168.1.1/24). */
  readonly portAddresses?: (d: ExtensionDevice, port: string) => readonly string[];
  /** In the palette now (e.g. only when the host page gave its context). Absent: always. */
  readonly offered?: () => boolean;
  /** One per lab: while one is placed its palette button is off, with this title. */
  readonly oneOnly?: () => string;
}

const uis = new Map<string, DeviceUi>();

export function registerDeviceUi(kind: string, ui: DeviceUi): void {
  if (uis.has(kind)) throw new Error(`El tipo de equipo «${kind}» ya tiene interfaz`);
  uis.set(kind, Object.freeze({ ...ui }));
}

export const deviceUi = (kind: string): DeviceUi | undefined => uis.get(kind);

/** The registered kinds with an interface, in registration order. */
export const deviceUiKinds = (): readonly string[] => [...uis.keys()];
