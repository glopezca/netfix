/**
 * The marks at each end of a cable: the link light and, centred on the cable just past the device's drawing, the
 * interface name with its addresses below. One calculation for the workspace and for the test that keeps the labs'
 * labels apart.
 */
import type { Placed } from '../net/topology.ts';
import { shortIfaceName } from '../ios/interfaces.ts';
import { along, cableMarks } from './canvas-geometry.ts';
import { deviceShapes } from './device-caption.ts';
import { portAddresses } from './port-address.ts';

/** px per character of the end labels (11 px monospace) and height of one of their lines. */
export const PORT_CHAR = 6.7;
export const PORT_LINE = 12;
const PAD = 3;

export interface Box { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

export interface EndLabel {
  readonly light: { readonly x: number; readonly y: number };
  /** Centre of the text block; the first line is the interface name. */
  readonly at: { readonly x: number; readonly y: number };
  readonly lines: readonly string[];
  readonly box: Box;
}

/** `linked`: whether a port of a device has a cable (its address then goes here, not under the device). */
export function endLabel(from: Placed, to: { x: number; y: number }, port: string, linked: (p: Placed, port: string) => boolean): EndLabel {
  const lines = [shortIfaceName(port), ...portAddresses(from, port)];
  const halfW = Math.max(...lines.map((l) => l.length)) * PORT_CHAR / 2 + PAD;
  const halfH = lines.length * PORT_LINE / 2 + 1;
  const marks = cableMarks(from, to, deviceShapes(from, (port2) => linked(from, port2)), { halfW, halfH });
  const at = along(from, to, marks.label);
  return { light: along(from, to, marks.light), at, lines, box: { x0: at.x - halfW, y0: at.y - halfH, x1: at.x + halfW, y1: at.y + halfH } };
}

/** Baseline of each line of the block, so the block is centred on `at`. */
export const lineBaselines = (l: EndLabel): number[] => l.lines.map((_, i) => l.at.y + 4 + (i - (l.lines.length - 1) / 2) * PORT_LINE);
