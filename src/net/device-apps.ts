/**
 * Per-device switches (the «Configuración» tab of a PC, Server or Linux router): the applications, service panels and
 * terminals the device shows, within what its lab allows (lab-features.ts). They live beside the device in weak
 * registries, as the seeds do, so the device's own web GUI reads them without knowing the interface.
 */
import { featureOn, SERVICE_IDS } from './lab-features.ts';
import type { FeatureId, LabFeatures } from './lab-features.ts';
import type { HostKind } from '../devices/kinds.ts';

/** What the Configuración tab of each kind lists, in its order. */
export const APPS_BY_KIND: Readonly<Record<HostKind, readonly FeatureId[]>> = {
  pc: ['ip', 'browser', 'mail', 'ssh', 'sftp', 'linux', 'windows'],
  server: ['ip', ...SERVICE_IDS, 'firewall', 'linux', 'windows'],
  linuxrouter: ['firewall', 'vpn', ...SERVICE_IDS, 'linux', 'windows'],
};

/** No box: the kernel parameters are always shown (when the lab keeps them). */
const ALWAYS: readonly FeatureId[] = ['sysctl'];
/** What a Server or Linux router placed from the palette shows besides its terminal: no service until a box or apt. */
const FRESH: readonly FeatureId[] = ['ip', 'files', 'log'];

/** The PC client applications: one lab switch («apps») covers them all. */
export const PC_APPS: readonly FeatureId[] = ['browser', 'mail', 'ssh', 'sftp'];
/** Off in a new PC: few labs use the mail client or SFTP. */
const PC_OFF: readonly FeatureId[] = ['mail', 'sftp'];
/** A longer list in a file is not a list of applications. */
const MAX_LIST = 64;

export interface AppsDevice {
  readonly kind: HostKind;
  readonly os: 'linux' | 'windows';
}

/** What the device's lab says: its settings, and whether the web GUI leaves out what is off. */
export interface LabView {
  readonly features: LabFeatures;
  readonly webHideOff: boolean;
}

const NO_LAB: LabView = { features: {}, webHideOff: false };
const chosen = new WeakMap<object, readonly FeatureId[]>();
const labs = new WeakMap<object, () => LabView>();

/**
 * Everything but the other system's terminal (and, in a PC, mail and SFTP). A Server or Linux router placed from the
 * palette starts instead with freshApps: the defaults are what files and recorded labs had before v0.26.
 */
export function defaultApps(d: AppsDevice): FeatureId[] {
  const other = d.os === 'linux' ? 'windows' : 'linux';
  return APPS_BY_KIND[d.kind].filter((id) => id !== other && !(d.kind === 'pc' && PC_OFF.includes(id)));
}

/** A Server or Linux router just placed: IP, files, logs and its terminal; no service until a box or apt adds it. */
export function freshApps(d: AppsDevice): FeatureId[] {
  return APPS_BY_KIND[d.kind].filter((id) => FRESH.includes(id) || id === d.os);
}

const listeners = new Set<(d: AppsDevice) => void>();

/** The open window of a device follows its boxes (changed from its tab, by apt or by a lab). */
export function onAppsChange(fn: (d: AppsDevice) => void): void {
  listeners.add(fn);
}

export function deviceApps(d: AppsDevice): readonly FeatureId[] {
  return chosen.get(d) ?? defaultApps(d);
}

/** The device's own choice, when it differs from the defaults (what the file keeps). */
export function customApps(d: AppsDevice): readonly FeatureId[] | undefined {
  return chosen.get(d);
}

/** In catalogue order; a list equal to the defaults is forgotten, so the terminals follow a later change of system. */
export function setDeviceApps(d: AppsDevice, list: readonly FeatureId[] | undefined): void {
  const next = list && APPS_BY_KIND[d.kind].filter((id) => list.includes(id));
  const same = (a: readonly FeatureId[], b: readonly FeatureId[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  const before = deviceApps(d);
  if (!next || same(next, defaultApps(d))) chosen.delete(d);
  else chosen.set(d, next);
  if (!same(before, deviceApps(d))) for (const fn of listeners) fn(d);
}

/** The lab switch behind a device switch. */
export function labFeature(kind: HostKind, id: FeatureId): FeatureId {
  return kind === 'pc' && PC_APPS.includes(id) ? 'apps' : id;
}

export function labAllows(features: LabFeatures, kind: HostKind, id: FeatureId): boolean {
  return featureOn(features, kind, labFeature(kind, id));
}

export function bindLab(d: AppsDevice, view: () => LabView): void {
  labs.set(d, view);
}

export function labViewOf(d: AppsDevice): LabView {
  return labs.get(d)?.() ?? NO_LAB;
}

/** Allowed by the device's lab and switched on in the device. */
export function appAvailable(d: AppsDevice, id: FeatureId): boolean {
  return labAllows(labViewOf(d).features, d.kind, id) && (ALWAYS.includes(id) || deviceApps(d).includes(id));
}

/** The `enabled` list of a file (untrusted): known ids of that kind, no repeats; undefined when it is not a list. */
export function parseApps(data: unknown, kind: HostKind): FeatureId[] | undefined {
  if (!Array.isArray(data) || data.length > MAX_LIST) return undefined;
  return APPS_BY_KIND[kind].filter((id) => data.includes(id));
}

export type PcSystem = 'linux' | 'windows' | 'both';

/** The question when a PC is placed: its system (IP tab) and its terminals; «both» keeps Windows and adds Linux. */
export function choosePcSystem(pc: { readonly kind: HostKind; os: 'linux' | 'windows' }, system: PcSystem): void {
  pc.os = system === 'linux' ? 'linux' : 'windows';
  setDeviceApps(pc, system === 'both' ? [...defaultApps(pc), 'linux'] : undefined);
}
