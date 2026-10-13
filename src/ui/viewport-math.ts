/** Pure geometry of the zoomable workspace: scale limits, zoom around a point and fit-to-content. */

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.5;
export const ZOOM_STEP = 1.25;

export interface Scroll {
  readonly left: number;
  readonly top: number;
}

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function clampScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * New scroll offsets so that the world point under `at` (pixels from the viewport's top-left corner) stays
 * under it when the scale changes from `from` to `to`.
 */
export function zoomAt(from: number, to: number, at: { x: number; y: number }, scroll: Scroll): Scroll {
  const worldX = (scroll.left + at.x) / from;
  const worldY = (scroll.top + at.y) / from;
  return { left: Math.max(0, worldX * to - at.x), top: Math.max(0, worldY * to - at.y) };
}

/** World coordinates of a viewport point. */
export function toWorld(scale: number, at: { x: number; y: number }, scroll: Scroll): { x: number; y: number } {
  return { x: (scroll.left + at.x) / scale, y: (scroll.top + at.y) / scale };
}

/** Scale and scroll that show `box` (plus a margin) centred in a viewport of `w`×`h`. */
export function fitBox(box: Box | null, w: number, h: number, margin = 80): { scale: number; scroll: Scroll } {
  if (!box || w <= 0 || h <= 0) return { scale: 1, scroll: { left: 0, top: 0 } };
  const bw = box.maxX - box.minX + 2 * margin;
  const bh = box.maxY - box.minY + 2 * margin;
  const scale = clampScale(Math.min(w / bw, h / bh, 1.5));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return { scale, scroll: { left: Math.max(0, cx * scale - w / 2), top: Math.max(0, cy * scale - h / 2) } };
}

/** Bounding box of the points, or null when there are none. */
export function boundsOf(points: Iterable<{ x: number; y: number }>): Box | null {
  let box: Box | null = null;
  for (const p of points) {
    box = box ? { minX: Math.min(box.minX, p.x), minY: Math.min(box.minY, p.y), maxX: Math.max(box.maxX, p.x), maxY: Math.max(box.maxY, p.y) } : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  }
  return box;
}

/** Scale after a pinch: the ratio of the distances between two pointers. */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  return startDistance > 0 ? clampScale(startScale * (distance / startDistance)) : startScale;
}

/** Keeps a floating menu of `w`×`h` inside a container of `cw`×`ch` (all in container pixels). */
export function placeInside(x: number, y: number, w: number, h: number, cw: number, ch: number, pad = 8): { x: number; y: number } {
  return { x: Math.max(pad, Math.min(x, cw - w - pad)), y: Math.max(pad, Math.min(y, ch - h - pad)) };
}
