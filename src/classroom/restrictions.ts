/**
 * Restriction policy for embedding Netfix in a classroom: which labs, palette devices and window tabs the student
 * may use, whether the documentation, files, simulation mode, clock, drawing and topology editing are on, and whether
 * the timestamp prompt of the terminals is locked on or off.
 * It arrives as untrusted JSON, so it is validated strictly; anything left out stays allowed.
 */
import type { DeviceKind } from '../net/topology.ts';

export const DEVICE_KINDS: readonly DeviceKind[] = ['router', 'switch', 'pc', 'server', 'linuxrouter', 'cloud'];
export const TAB_IDS = ['host', 'ifaces', 'cli', 'web', 'ip', 'svc', 'mail', 'ssh', 'sftp', 'linux', 'windows', 'apps', 'isp', 'lines'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** The first tab of each window (Device; ISP for the cloud): kept even when a list leaves it out, so a window is never empty. */
const firstTab = (k: DeviceKind): TabId => (k === 'cloud' ? 'isp' : 'host');
const FLAGS = ['docs', 'fileOpen', 'fileSave', 'fileNew', 'simulation', 'clock', 'drawing', 'editTopology'] as const;
type Flag = (typeof FLAGS)[number];
/** «Prompt con marca de fecha y hora»: each device decides (free), or the teacher locks it on or off. */
export const PROMPT_MODES = ['free', 'on', 'off'] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];
const MAX_LABS = 100;
const MAX_ID = 64;
const ID_RE = /^[A-Za-z0-9._-]+$/;

export type Restrictions = {
  /** Lab ids that may be opened; null = all. */
  readonly labs: readonly string[] | null;
  /** Device kinds in the palette; null = all. */
  readonly devices: readonly DeviceKind[] | null;
  /** Tabs per device kind; a kind left out keeps all its tabs. */
  readonly tabs: Readonly<Partial<Record<DeviceKind, readonly TabId[]>>>;
  readonly timestampPrompt: PromptMode;
} & { readonly [F in Flag]: boolean };

export const NO_RESTRICTIONS: Restrictions = Object.freeze({
  labs: null, devices: null, tabs: Object.freeze({}), timestampPrompt: 'free',
  docs: true, fileOpen: true, fileSave: true, fileNew: true, simulation: true, clock: true, drawing: true, editTopology: true,
});

function invalid(why: string): never {
  throw new Error(`Restricciones no válidas: ${why}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown, field: string, max: number): string[] {
  if (!Array.isArray(v) || v.length > max) invalid(`${field} debe ser una lista de hasta ${max} elementos`);
  return v.map((x) => {
    if (typeof x !== 'string' || x.length === 0 || x.length > MAX_ID || !ID_RE.test(x)) invalid(`${field}: identificador no válido`);
    return x;
  });
}

function kind(v: string, field: string): DeviceKind {
  const k = DEVICE_KINDS.find((d) => d === v);
  if (!k) invalid(`${field}: tipo de equipo desconocido «${v}»`);
  return k;
}

function tabList(v: unknown, field: string): TabId[] {
  return stringList(v, field, TAB_IDS.length).map((x) => {
    const id = TAB_IDS.find((t) => t === x);
    if (!id) invalid(`${field}: pestaña desconocida «${x}»`);
    return id;
  });
}

function parseTabs(v: unknown): Partial<Record<DeviceKind, readonly TabId[]>> {
  if (!isRecord(v)) invalid('tabs debe ser un objeto');
  const out: Partial<Record<DeviceKind, readonly TabId[]>> = {};
  for (const [k, list] of Object.entries(v)) out[kind(k, 'tabs')] = Object.freeze(tabList(list, `tabs.${k}`));
  return Object.freeze(out);
}

/** The policy in `input` (JSON already parsed), validated; undefined or {} means no restrictions. */
export function parseRestrictions(input: unknown): Restrictions {
  if (input === undefined || input === null) return NO_RESTRICTIONS;
  if (!isRecord(input)) invalid('se esperaba un objeto');
  const known = new Set<string>(['labs', 'devices', 'tabs', 'timestampPrompt', ...FLAGS]);
  const extra = Object.keys(input).find((k) => !known.has(k));
  if (extra) invalid(`campo desconocido «${extra}»`);
  const flags = {} as Record<Flag, boolean>;
  for (const f of FLAGS) {
    const v = input[f];
    if (v !== undefined && typeof v !== 'boolean') invalid(`${f} debe ser true o false`);
    flags[f] = v ?? true;
  }
  return Object.freeze({
    labs: input.labs === undefined ? null : Object.freeze(stringList(input.labs, 'labs', MAX_LABS)),
    devices: input.devices === undefined ? null : Object.freeze(stringList(input.devices, 'devices', DEVICE_KINDS.length).map((d) => kind(d, 'devices'))),
    tabs: input.tabs === undefined ? NO_RESTRICTIONS.tabs : parseTabs(input.tabs),
    timestampPrompt: promptMode(input.timestampPrompt),
    ...flags,
  });
}

function promptMode(v: unknown): PromptMode {
  if (v === undefined) return 'free';
  const mode = PROMPT_MODES.find((m) => m === v);
  if (!mode) invalid('timestampPrompt debe ser "free", "on" u "off"');
  return mode;
}

/** The forced value of the timestamp prompt (true/false), or undefined when each device decides. */
export function lockedPrompt(r: Restrictions): boolean | undefined {
  return r.timestampPrompt === 'free' ? undefined : r.timestampPrompt === 'on';
}

export function allowsLab(r: Restrictions, id: string): boolean {
  return r.labs === null || r.labs.includes(id);
}

export function allowsDevice(r: Restrictions, k: DeviceKind): boolean {
  return r.devices === null || r.devices.includes(k);
}

export function allowsTab(r: Restrictions, k: DeviceKind, tab: string): boolean {
  const list = r.tabs[k];
  return !list || tab === firstTab(k) || list.some((t) => t === tab);
}
