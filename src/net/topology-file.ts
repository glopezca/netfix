/** The topology file: format version, size limits and the validation of untrusted JSON before it is built. */
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

/** Validates untrusted JSON before building a topology from it. */
export function validateFile(data: unknown): TopologyFile {
  if (!isObject(data) || (data.format !== 'netfix' && data.format !== 'netsim') || (data.version !== 1 && data.version !== FILE_VERSION)) throw new Error(t('load.notNetfix'));
  const { devices, links } = data;
  if (!Array.isArray(devices) || !Array.isArray(links)) throw new Error(t('load.incomplete'));
  if (devices.length > MAX_DEVICES || links.length > MAX_DEVICES * 2) throw new Error(t('load.tooBig', { max: MAX_DEVICES }));
  for (const d of devices) {
    if (!isObject(d) || typeof d.id !== 'string' || !['router', 'switch', 'pc', 'server', 'linuxrouter', 'cloud'].includes(String(d.kind))) throw new Error(t('load.badDevice'));
    if (![d.x, d.y, d.seed].every((n) => typeof n === 'number' && Number.isFinite(n)) || typeof d.label !== 'string') throw new Error(t('load.deviceData', { id: d.id }));
    if (d.label.length > MAX_LABEL) throw new Error(t('load.deviceData', { id: d.id }));
    if (!configLines(d.config) || !(d.startup === null || configLines(d.startup))) throw new Error(t('load.deviceConfig', { id: d.id }));
  }
  for (const l of links) {
    if (!isObject(l) || !isObject(l.a) || !isObject(l.b) || [l.a.device, l.a.port, l.b.device, l.b.port].some((x) => typeof x !== 'string')) throw new Error(t('load.badLink'));
  }
  let annotations: Annotation[];
  try {
    annotations = annotationsFromJson(data.annotations);
  } catch {
    throw new Error(t('load.drawings'));
  }
  return { ...(data as unknown as TopologyFile), annotations };
}
