/**
 * Caption under a device in the diagram: its name and, below, what identifies it on the network: the IP/CIDR of each
 * NIC with an address and no cable (with a cable, it goes under the interface name at the end of the cable), the IOS
 * hostname when it is not the default one, the public block of a cloud. The host name of a PC, Server, Linux router or cloud is derived from its name, so it is not repeated.
 */
import type { Placed } from '../net/topology.ts';
import { formatIp } from '../core/ip.ts';
import { BLOCK_PREFIX } from '../devices/cloud-config.ts';
import { ICON_H, ICON_W } from './icons.ts';
import type { Rect } from './canvas-geometry.ts';

/** More would cover the devices below. */
const MAX_LINES = 3;
/** Height of each caption line below the device name. */
export const CAPTION_LINE = 14;
const IOS_DEFAULTS: ReadonlySet<string> = new Set(['Router', 'Switch']);

export interface DeviceCaption {
  readonly name: string;
  readonly extra: readonly string[];
}

/** `linked`: ports with a cable, whose address goes at the end of the cable instead (link-labels.ts). */
function extraLines(p: Placed, linked?: (port: string) => boolean): string[] {
  const d = p.device;
  // A cloud: its public block, as a device shows its IP/CIDR (the provider name is in its ISP tab).
  if (d.kind === 'cloud') return [`${formatIp(d.settings.block)}/${BLOCK_PREFIX}`];
  if (d.kind === 'router' || d.kind === 'switch') return IOS_DEFAULTS.has(d.hostname) || d.hostname === p.label ? [] : [d.hostname];
  return d.nics().flatMap((n) => (n.ip !== undefined && n.prefix !== undefined && !linked?.(n.port) ? [`${formatIp(n.ip)}/${n.prefix}`] : []));
}

export function deviceCaption(p: Placed, linked?: (port: string) => boolean): DeviceCaption {
  return { name: p.label, extra: extraLines(p, linked).slice(0, MAX_LINES) };
}

/** Rough text widths (px per character) of the device name (bold 13 px) and of the lines below it (11 px). */
const NAME_CHAR = 7.4;
const LINE_CHAR = 6.2;
/** Name baseline below the icon's centre, and the model line above it (canvas.ts). */
const NAME_BASELINE = ICON_H / 2 + 18;
const MODEL_TOP = ICON_H / 2 + 24;
const DESCENT = 5;

/** What a device draws around its centre: the icon with its model above, and the caption below. */
export function deviceShapes(p: Placed, linked?: (port: string) => boolean): Rect[] {
  const c = deviceCaption(p, linked);
  const half = Math.max(c.name.length * NAME_CHAR, ...c.extra.map((l) => l.length * LINE_CHAR)) / 2;
  return [
    { x0: -ICON_W / 2 - 4, x1: ICON_W / 2 + 4, y0: -MODEL_TOP, y1: ICON_H / 2 + 2 },
    { x0: -half, x1: half, y0: ICON_H / 2 + 2, y1: NAME_BASELINE + c.extra.length * CAPTION_LINE + DESCENT },
  ];
}
