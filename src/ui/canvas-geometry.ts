/** Geometry of the workspace drawing: clamping, points along a cable, the side of its labels and link lights. */

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function along(from: { x: number; y: number }, to: { x: number; y: number }, dist: number): { x: number; y: number } {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const d = Math.min(dist, len / 2 - 4);
  return { x: from.x + ((to.x - from.x) * d) / len, y: from.y + ((to.y - from.y) * d) / len };
}

/** Offset vector perpendicular to the cable, always pointing right (or up for horizontal cables). */
export function perpendicular(from: { x: number; y: number }, to: { x: number; y: number }, dist: number): { x: number; y: number } {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  let nx = -(to.y - from.y) / len;
  let ny = (to.x - from.x) / len;
  if (nx < 0 || (nx === 0 && ny > 0)) { nx = -nx; ny = -ny; }
  return { x: nx * dist, y: ny * dist };
}

/** Link light: a small triangle pointing along the cable, like Packet Tracer. */
export function triangle(c: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): string {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const s = 6;
  const pts = [0, 2.1, 4.2].map((o) => [c.x + Math.cos(ang + o) * s, c.y + Math.sin(ang + o) * s]);
  return `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join(' L')} Z`;
}

/** A rectangle relative to a device's centre. */
export interface Rect { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }

/** How far along the unit direction (ux, uy) a ray from the centre has left `r` (0 when it never crosses it). */
export function rayExit(ux: number, uy: number, r: Rect): number {
  const slab = (u: number, lo: number, hi: number): [number, number] => {
    if (Math.abs(u) < 1e-9) return lo <= 0 && hi >= 0 ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const a = lo / u;
    const b = hi / u;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const [ax, bx] = slab(ux, r.x0, r.x1);
  const [ay, by] = slab(uy, r.y0, r.y1);
  const enter = Math.max(ax, ay);
  const exit = Math.min(bx, by);
  return exit >= Math.max(enter, 0) ? exit : 0;
}

/**
 * Distances along a cable, from a device's centre, of its link light and of its interface name: both just past the
 * device's drawing (icon, model above, name and addresses below), the name centred on the cable after the light.
 */
export function cableMarks(from: { x: number; y: number }, to: { x: number; y: number }, shapes: readonly Rect[], label: { halfW: number; halfH: number }): { light: number; label: number } {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const out = Math.max(0, ...shapes.map((r) => rayExit(ux, uy, r)));
  const light = out + LIGHT_GAP;
  return { light, label: light + LABEL_GAP + Math.abs(ux) * label.halfW + Math.abs(uy) * label.halfH };
}

const LIGHT_GAP = 8;
const LABEL_GAP = 9;
