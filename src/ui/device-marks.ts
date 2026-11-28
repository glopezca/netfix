/**
 * Brand marks on the device icons (0.98.0): the system a device runs, drawn for this project in the icons' own style —
 * simplified look-alikes, not the vendors' logos: a four-pane window (Windows), a ring with three dots (Ubuntu) or a
 * penguin's head (Tux) for GNU/Linux, and bars (Cisco IOS). On a PC's screen, on a server's front between its drive
 * bays and its light, on a router's front face (its symbol stays on top), above a switch's ports. A MultiOS PC has none.
 * Colours are the icons' variables; on a screen, `--dev-logo` (else the light `--dev-top`), so an outline style can
 * redraw them too.
 */
import type { DeviceKind } from '../net/topology.ts';

/** The setting: GNU/Linux as Ubuntu (the default) or Tux, or no marks at all. */
export type DeviceMarks = 'ubuntu' | 'tux' | 'none';
export const DEVICE_MARKS: readonly DeviceMarks[] = ['ubuntu', 'tux', 'none'];
/** What a PC or a server runs: Windows, GNU/Linux, or both (a MultiOS PC). */
export type IconSystem = 'windows' | 'linux' | 'both';

const n = (v: number): string => String(Math.round(v * 100) / 100);

/** Four panes (Windows), `s` wide, centred on (cx, cy). */
function windows(cx: number, cy: number, s: number, paint: string): string {
  const h = s / 2 - s * 0.06;
  const at = (x: number, y: number): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(h)}" height="${n(h)}" rx="0.3"/>`;
  return `<g fill="${paint}">${at(cx - s / 2, cy - s / 2)}${at(cx + s * 0.06, cy - s / 2)}${at(cx - s / 2, cy + s * 0.06)}${at(cx + s * 0.06, cy + s * 0.06)}</g>`;
}

/** A ring with three dots on it (Ubuntu's circle), radius `r`. */
function ubuntu(cx: number, cy: number, r: number, paint: string): string {
  const dots = [90, 210, 330].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return `<circle cx="${n(cx + r * Math.cos(a))}" cy="${n(cy - r * Math.sin(a))}" r="${n(r * 0.34)}"/>`;
  }).join('');
  return `<g><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.78)}" fill="none" stroke="${paint}" stroke-width="${n(r * 0.3)}"/><g fill="${paint}">${dots}</g></g>`;
}

/**
 * Tux from the shoulders up (0.98.1; chosen over the whole penguin, whose face is lost at icon size), in a 10 × 10 box
 * placed `s` tall at (cx, cy): the head and shoulders in `paint`, the light face and the eyes' whites in `--dev-face`
 * (else the surface's colour `ground`), the eyes and the beak — amber, `--dev-beak` — as Tux's.
 */
function tux(cx: number, cy: number, s: number, paint: string, ground: string): string {
  const face = `var(--dev-face, ${ground})`;
  return `<g transform="translate(${n(cx - s / 2)} ${n(cy - s / 2)}) scale(${n(s / 10)})">`
    + `<path d="M5 0.2 C2.3 0.2 1.7 2.4 1.8 4.4 C0.7 5.6 0.2 7.6 0.2 9.8 H9.8 C9.8 7.6 9.3 5.6 8.2 4.4 C8.3 2.4 7.7 0.2 5 0.2 Z" fill="${paint}"/>`
    + `<path d="M5 3.2 C3.3 3 2.4 4.6 2.6 6.4 C2.8 8.4 3.6 9.8 5 9.8 C6.4 9.8 7.2 8.4 7.4 6.4 C7.6 4.6 6.7 3 5 3.2 Z" fill="${face}"/>`
    + `<ellipse cx="3.9" cy="3.1" rx="0.95" ry="1.25" fill="${face}"/><ellipse cx="6.1" cy="3.1" rx="0.95" ry="1.25" fill="${face}"/>`
    + `<circle cx="4.1" cy="3.4" r="0.45" fill="${paint}"/><circle cx="5.9" cy="3.4" r="0.45" fill="${paint}"/>`
    + `<path d="M3.4 4.6 Q5 3.9 6.6 4.6 Q5 5.9 3.4 4.6 Z" fill="var(--dev-beak, #f2b134)"/></g>`;
}

/** Bars of three heights, as a bridge (Cisco IOS), `w` wide and `h` tall, centred on (cx, cy). */
function cisco(cx: number, cy: number, w: number, h: number, paint: string): string {
  const heights = [0.3, 0.6, 1, 0.6, 0.3, 0.6, 1, 0.6, 0.3];
  const step = w / (heights.length - 1);
  const bars = heights.map((k, i) => `M${n(cx - w / 2 + i * step)} ${n(cy + h / 2)} v${n(-h * k)}`).join(' ');
  return `<path d="${bars}" fill="none" stroke="${paint}" stroke-width="${n(step * 0.55)}" stroke-linecap="round"/>`;
}

const ON_SCREEN = 'var(--dev-logo, var(--dev-top))';
const ON_FRONT = 'var(--dev-mark)';
/** The surface under a mark (Tux's face is cut out in it). */
const SCREEN = 'var(--dev-screen)';
const FRONT = 'var(--dev-side)';

function linuxMark(marks: DeviceMarks, cx: number, cy: number, size: number, paint: string, ground: string): string {
  return marks === 'tux' ? tux(cx, cy, size * 1.2, paint, ground) : ubuntu(cx, cy, size * 0.45, paint);
}

/** The mark drawn over an icon of 64 × 48 (an SVG fragment), or '' when it has none. */
export function markOf(kind: DeviceKind, system: IconSystem | undefined, marks: DeviceMarks): string {
  if (marks === 'none') return '';
  if (kind === 'pc') {
    if (system === 'windows') return windows(32, 16.5, 10, ON_SCREEN);
    return system === 'linux' ? linuxMark(marks, 32, 16.5, 10, ON_SCREEN, SCREEN) : '';
  }
  if (kind === 'server') return system === 'windows' ? windows(30, 31.5, 7, ON_FRONT) : linuxMark(marks, 30, 31.5, 7.5, ON_FRONT, FRONT);
  if (kind === 'linuxrouter') return linuxMark(marks, 32, 33.5, 7.5, ON_FRONT, FRONT);
  if (kind === 'router') return cisco(32, 33.5, 14, 5, ON_FRONT);
  if (kind === 'switch') return cisco(15.5, 22.5, 11, 4, ON_FRONT);
  return '';
}

/** An icon with its mark drawn in, just before its closing tag. */
export function withMark(svg: string, mark: string): string {
  if (!mark) return svg;
  const end = svg.lastIndexOf('</svg>');
  return end < 0 ? svg : `${svg.slice(0, end)}  <g class="dev-brand">${mark}</g>\n${svg.slice(end)}`;
}
