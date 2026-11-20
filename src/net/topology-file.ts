/** The topology file: format version, size limits and the validation of untrusted JSON before it is built. */
import { deviceKinds } from './device-kinds.ts';
import { t } from '../i18n/t.ts';
import { annotationsFromJson } from './annotations.ts';
import type { Annotation } from './annotations.ts';
import type { TopologyFile } from './topology.ts';

export const FILE_VERSION = 2;
/** A larger file would freeze the tab while it is built and settled. */
export const MAX_DEVICES = 500;
const MAX_LABEL = 64;
const MAX_CONFIG_LINES = 20_000;
const MAX_CONFIG_LINE = 4096;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** IOS configuration of a file: absent, or a bounded list of bounded lines (the IOS parser reads every one). */
function configLines(v: unknown): boolean {
  return v === undefined || (Array.isArray(v) && v.length <= MAX_CONFIG_LINES && v.every((l) => typeof l === 'string' && l.length <= MAX_CONFIG_LINE));
}

/**
 * Format-error policy: `code` is the contract (stable, closed union; callers branch on it), the message is
 * translated text for humans and may change. One code per distinct failure of validateFile (so of Topology.fromJSON):
 *  not-netfix    not an object, wrong `format`, or `version` not 1/FILE_VERSION
 *  incomplete    `devices` or `links` is not an array
 *  too-big       more than MAX_DEVICES devices or 2*MAX_DEVICES links
 *  bad-device    a device is not an object with a string id and a known kind
 *  device-data   a device has non-numeric x/y/seed, or a missing/oversized label
 *  device-config a device's config/startup is not a bounded list of bounded lines
 *  bad-link      a link is malformed (endpoints without string device/port)
 *  drawings      the annotations are invalid
 */
export type TopologyFileErrorCode = 'not-netfix' | 'incomplete' | 'too-big' | 'bad-device' | 'device-data' | 'device-config' | 'bad-link' | 'drawings';

export class TopologyFileError extends Error {
  readonly code: TopologyFileErrorCode;
  constructor(code: TopologyFileErrorCode, message: string) {
    super(message);
    this.name = 'TopologyFileError';
    this.code = code;
  }
}

/** Validates untrusted JSON before building a topology from it. */
export function validateFile(data: unknown): TopologyFile {
  if (!isObject(data) || (data.format !== 'netfix' && data.format !== 'netsim') || (data.version !== 1 && data.version !== FILE_VERSION)) throw new TopologyFileError('not-netfix', t('load.notNetfix'));
  const { devices, links } = data;
  if (!Array.isArray(devices) || !Array.isArray(links)) throw new TopologyFileError('incomplete', t('load.incomplete'));
  if (devices.length > MAX_DEVICES || links.length > MAX_DEVICES * 2) throw new TopologyFileError('too-big', t('load.tooBig', { max: MAX_DEVICES }));
  for (const d of devices) {
    if (!isObject(d) || typeof d.id !== 'string' || !deviceKinds().includes(String(d.kind))) throw new TopologyFileError('bad-device', t('load.badDevice'));
    if (![d.x, d.y, d.seed].every((n) => typeof n === 'number' && Number.isFinite(n)) || typeof d.label !== 'string') throw new TopologyFileError('device-data', t('load.deviceData', { id: d.id }));
    if (d.label.length > MAX_LABEL) throw new TopologyFileError('device-data', t('load.deviceData', { id: d.id }));
    if (!configLines(d.config) || !(d.startup === null || configLines(d.startup))) throw new TopologyFileError('device-config', t('load.deviceConfig', { id: d.id }));
  }
  for (const l of links) {
    if (!isObject(l) || !isObject(l.a) || !isObject(l.b) || [l.a.device, l.a.port, l.b.device, l.b.port].some((x) => typeof x !== 'string')) throw new TopologyFileError('bad-link', t('load.badLink'));
  }
  let annotations: Annotation[];
  try {
    annotations = annotationsFromJson(data.annotations);
  } catch {
    throw new TopologyFileError('drawings', t('load.drawings'));
  }
  return { ...(data as unknown as TopologyFile), annotations };
}
