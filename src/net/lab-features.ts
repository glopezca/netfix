/**
 * Per-lab device features (Configuración → Laboratorio actual): which settings each kind of device shows. «Equipo»
 * (host name) and «Interfaces» are always there. Saved with the topology, only as differences from the defaults.
 */
import type { DeviceKind } from './topology.ts';

/**
 * The service panels of a Server or Linux router, each switched on its own. Samba is a lab feature of PCs too, but its
 * box in a device follows the samba package (apt or the box install it), not the device's list of panels.
 */
export const SERVICE_IDS = ['ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log'] as const;
export const FEATURE_IDS = ['ip', 'apps', 'browser', 'sftp', ...SERVICE_IDS, 'samba', 'sysctl', 'firewall', 'vpn', 'cli', 'web', 'linux', 'windows'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export type LabFeatures = Readonly<Partial<Record<DeviceKind, readonly FeatureId[]>>>;

/** What can be switched on each kind, in the order the settings list them. */
export const FEATURES_BY_KIND: Readonly<Record<DeviceKind, readonly FeatureId[]>> = {
  pc: ['ip', 'apps', 'samba', 'linux', 'windows'],
  server: ['ip', ...SERVICE_IDS, 'samba', 'sysctl', 'firewall', 'linux', 'windows'],
  linuxrouter: ['sysctl', 'firewall', 'vpn', ...SERVICE_IDS, 'samba', 'linux', 'windows'],
  router: ['cli', 'web'],
  switch: ['cli', 'web'],
  cloud: [],
};

/** On by default, except the Linux router's Windows terminal (each device then decides: device-apps.ts). */
const DEFAULT_OFF: Readonly<Partial<Record<DeviceKind, readonly FeatureId[]>>> = {
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

/** Samba on for every kind that has it (a list saved before the feature existed). */
export function withSamba(features: LabFeatures): LabFeatures {
  return KINDS.filter((k) => FEATURES_BY_KIND[k].includes('samba')).reduce((f, k) => setFeature(f, k, 'samba', true), features);
}

/** Samba off for every kind that has it (a v0.34 file with «sambaOff»). */
export function withoutSamba(features: LabFeatures): LabFeatures {
  return KINDS.filter((k) => FEATURES_BY_KIND[k].includes('samba')).reduce((f, k) => setFeature(f, k, 'samba', false), features);
}

/** The `features` of a topology file (untrusted): known kinds, known features of that kind, no repeats. */
const isService = (f: FeatureId): boolean => (SERVICE_IDS as readonly string[]).includes(f);

export function parseFeatures(data: unknown): LabFeatures {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: Partial<Record<DeviceKind, readonly FeatureId[]>> = {};
  for (const kind of KINDS) {
    const list: unknown = (data as Record<string, unknown>)[kind];
    if (!Array.isArray(list) || list.length > MAX_LIST) continue;
    /** Up to v0.24.0 one «services» switch stood for every service panel. */
    const legacy = list.includes('services');
    const on = FEATURES_BY_KIND[kind].filter((f) => list.includes(f) || (legacy && isService(f)));
    if (!sameAsDefault(kind, on)) out[kind] = on;
  }
  return out;
}

/** The `featuresV` of a file whose lists know Samba (v0.35). */
export const FEATURES_V = 2;

/**
 * The lab settings of a file. A list saved before v0.35 never names Samba, which did not exist yet: Samba stays on,
 * unless the file says «sambaOff» (v0.34's single switch), which turns it off for every kind.
 */
export function fileFeatures(data: unknown, version: unknown, sambaOff: unknown): LabFeatures {
  const parsed = parseFeatures(data);
  const known = version === FEATURES_V ? parsed : withSamba(parsed);
  return sambaOff === true ? withoutSamba(known) : known;
}
