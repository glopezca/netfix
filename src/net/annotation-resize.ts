/**
 * Resizing a drawing by its handles: the corners and edge midpoints of an area (rectangle or ellipse) move one or two
 * of its sides while the opposite ones stay, and the two ends of a line move alone. Pure: a new annotation.
 */
import type { Annotation, Point } from './annotations.ts';
import { boundsOf } from './annotations.ts';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p0' | 'p1';
/** Smallest side an area can be shrunk to. */
export const MIN_BOX = 20;

const BOX: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlesOf(a: Annotation): { handle: Handle; x: number; y: number }[] {
  if (a.kind === 'line') return a.points.slice(0, 2).map((p, i) => ({ handle: i === 0 ? 'p0' : 'p1', x: p.x, y: p.y }));
  if (a.kind !== 'rect' && a.kind !== 'ellipse') return [];
  const b = boundsOf(a);
  const xs = { w: b.x, c: b.x + b.w / 2, e: b.x + b.w };
  const ys = { n: b.y, c: b.y + b.h / 2, s: b.y + b.h };
  return BOX.map((handle) => ({
    handle,
    x: handle.includes('w') ? xs.w : handle.includes('e') ? xs.e : xs.c,
    y: handle.includes('n') ? ys.n : handle.includes('s') ? ys.s : ys.c,
  }));
}

const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

export function resizeAnnotation(a: Annotation, handle: Handle, dx: number, dy: number): Annotation {
  if (a.kind === 'line' && (handle === 'p0' || handle === 'p1')) {
    const i = handle === 'p0' ? 0 : 1;
    return { ...a, points: a.points.map((p, j) => (j === i ? round({ x: p.x + dx, y: p.y + dy }) : p)) };
  }
  if ((a.kind !== 'rect' && a.kind !== 'ellipse') || handle === 'p0' || handle === 'p1') return a;
  const b = boundsOf(a);
  let [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
  // A side never crosses the opposite one: it stops MIN_BOX before it.
  if (handle.includes('w')) x0 = Math.min(x0 + dx, x1 - MIN_BOX);
  if (handle.includes('e')) x1 = Math.max(x1 + dx, x0 + MIN_BOX);
  if (handle.includes('n')) y0 = Math.min(y0 + dy, y1 - MIN_BOX);
  if (handle.includes('s')) y1 = Math.max(y1 + dy, y0 + MIN_BOX);
  return { ...a, points: [round({ x: x0, y: y0 }), round({ x: x1, y: y1 })] };
}
