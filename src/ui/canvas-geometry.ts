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
