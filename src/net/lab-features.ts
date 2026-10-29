/**
 * Per-lab device features (Configuración → Laboratorio actual): which settings each kind of device shows. «Equipo»
 * (host name) and «Interfaces» are always there. Saved with the topology, only as differences from the defaults.
 */
import type { DeviceKind } from './topology.ts';

export const FEATURE_IDS = ['ip', 'apps', 'services', 'sysctl', 'firewall', 'vpn', 'cli', 'web', 'linux', 'windows'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export type LabFeatures = Readonly<Partial<Record<DeviceKind, readonly FeatureId[]>>>;

/** What can be switched on each kind, in the order the settings list them. */
export const FEATURES_BY_KIND: Readonly<Record<DeviceKind, readonly FeatureId[]>> = {
  pc: ['ip', 'apps', 'linux', 'windows'],
  server: ['ip', 'services', 'sysctl', 'firewall', 'linux', 'windows'],
  linuxrouter: ['sysctl', 'firewall', 'vpn', 'services', 'linux', 'windows'],
  router: ['cli', 'web'],
  switch: ['cli', 'web'],
  cloud: [],
};

/** On by default: a server's kernel and firewall panels, and the Linux router's Windows terminal, are extras. */
const DEFAULT_OFF: Readonly<Partial<Record<DeviceKind, readonly FeatureId[]>>> = {
  server: ['sysctl', 'firewall'],
  linuxrouter: ['windows'],
};

const KINDS = Object.keys(FEATURES_BY_KIND) as DeviceKind[];

function defaults(kind: DeviceKind): FeatureId[] {
  return FEATURES_BY_KIND[kind].filter((f) => !(DEFAULT_OFF[kind] ?? []).includes(f));
}

/** A longer list in a file is not a list of features (each kind has at most a handful). */
const MAX_LIST = 64;

function sameAsDefault(kind: DeviceKind, list: readonly FeatureId[]): boolean {
  const d = defaults(kind);
  return list.length === d.length && list.every((f, i) => f === d[i]);
}

/** The features on for a kind, in catalogue order. */
export function featuresOf(features: LabFeatures, kind: DeviceKind): readonly FeatureId[] {
  return features[kind] ?? defaults(kind);
}

export function featureOn(features: LabFeatures, kind: DeviceKind, id: FeatureId): boolean {
  return featuresOf(features, kind).includes(id);
}

/** A copy with one feature switched; a kind back to its defaults is left out. */
export function setFeature(features: LabFeatures, kind: DeviceKind, id: FeatureId, on: boolean): LabFeatures {
  if (!FEATURES_BY_KIND[kind].includes(id)) return features;
  const current = new Set(featuresOf(features, kind));
  if (on) current.add(id);
  else current.delete(id);
  const next = FEATURES_BY_KIND[kind].filter((f) => current.has(f));
  const rest = Object.fromEntries(Object.entries(features).filter(([k]) => k !== kind)) as LabFeatures;
  return sameAsDefault(kind, next) ? rest : { ...rest, [kind]: next };
}

/** The `features` of a topology file (untrusted): known kinds, known features of that kind, no repeats. */
export function parseFeatures(data: unknown): LabFeatures {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: Partial<Record<DeviceKind, readonly FeatureId[]>> = {};
  for (const kind of KINDS) {
    const list: unknown = (data as Record<string, unknown>)[kind];
    if (!Array.isArray(list) || list.length > MAX_LIST) continue;
    const on = FEATURES_BY_KIND[kind].filter((f) => list.includes(f));
    if (!sameAsDefault(kind, on)) out[kind] = on;
  }
  return out;
}
