/**
 * Drawings of the workspace (vector annotations): areas (rectangles and ellipses, optionally filled and named),
 * lines, freehand strokes and text labels. Immutable records: every change returns a new one. They have no effect
 * on the simulated network; they are saved in the topology file.
 */

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'free' | 'text';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface AnnotationStyle {
  /** #rrggbb */
  readonly color: string;
  /** Rectangles and ellipses: translucent fill of the same colour. */
  readonly fill: boolean;
  /** Stroke width in workspace units. */
  readonly width: number;
}

export interface AnnotationInit extends AnnotationStyle {
  readonly kind: ShapeKind;
  /** rect / ellipse / line: two corners or ends; free: the stroke; text: the anchor. */
  readonly points: readonly Point[];
  /** Text of a label, or the name written in the corner of an area. */
  readonly text?: string;
  /** Font size of the text. */
  readonly size?: number;
}

export interface Annotation extends AnnotationInit {
  readonly id: string;
}

/** Basic colours of the drawing bar (any other one is picked with the RGB selector). */
export const BASIC_COLORS: readonly string[] = ['#d32f2f', '#f57c00', '#fbc02d', '#388e3c', '#0097a7', '#1976d2', '#7b1fa2', '#455a64', '#000000'];
export const KINDS: readonly ShapeKind[] = ['rect', 'ellipse', 'line', 'free', 'text'];
export const MAX_ANNOTATIONS = 500;
export const MAX_TEXT = 200;
const MAX_POINTS = 1000;
const MIN_STEP = 2;
const MAX_WIDTH = 16;
const MIN_SIZE = 8;
const MAX_SIZE = 72;
const DEFAULT_SIZE = 16;
const MAX_COORD = 100_000;

/** #rgb or #rrggbb in lower case, or null. */
export function normaliseColor(text: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const hex = (m[1] ?? '').toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}

/** A freehand stroke without points closer than MIN_STEP and with at most MAX_POINTS points. */
export function simplifyStroke(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) out.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  if (out.length <= MAX_POINTS) return out;
  const step = out.length / MAX_POINTS;
  return Array.from({ length: MAX_POINTS }, (_, i) => out[Math.floor(i * step)] as Point);
}

export function makeAnnotation(id: string, init: AnnotationInit): Annotation {
  const points = init.kind === 'free' ? simplifyStroke(init.points) : init.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const text = init.text?.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TEXT);
  return {
    id, kind: init.kind, points, color: normaliseColor(init.color) ?? '#000000', fill: init.fill && (init.kind === 'rect' || init.kind === 'ellipse'),
    width: Math.min(MAX_WIDTH, Math.max(1, Math.round(init.width))),
    ...(text ? { text } : {}),
    ...(init.kind === 'text' || text ? { size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(init.size ?? DEFAULT_SIZE))) } : {}),
  };
}

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  return { ...a, points: a.points.map((p) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) })) };
}

export function restyle(a: Annotation, style: Partial<AnnotationStyle> & { readonly text?: string }): Annotation {
  return makeAnnotation(a.id, { ...a, ...style });
}

/** Bounding box of the points (for text, a box from the anchor). */
export function boundsOf(a: Annotation): { x: number; y: number; w: number; h: number } {
  const xs = a.points.map((p) => p.x);
  const ys = a.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ------------------------------------------------------------ JSON (untrusted)

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pointFrom(v: unknown): Point {
  if (!isRecord(v) || typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > MAX_COORD || Math.abs(v.y) > MAX_COORD) throw new Error('point');
  return { x: v.x, y: v.y };
}

function annotationFrom(v: unknown): Annotation {
  if (!isRecord(v) || typeof v.id !== 'string' || !/^[\w-]{1,32}$/.test(v.id)) throw new Error('annotation');
  const kind = KINDS.find((k) => k === v.kind);
  const color = typeof v.color === 'string' ? normaliseColor(v.color) : null;
  if (!kind || !color || !Array.isArray(v.points) || typeof v.width !== 'number' || !Number.isFinite(v.width)) throw new Error('annotation');
  const need = kind === 'text' ? 1 : 2;
  if (v.points.length < need || v.points.length > (kind === 'free' ? MAX_POINTS * 2 : need)) throw new Error('annotation points');
  if (v.text !== undefined && (typeof v.text !== 'string' || v.text.length > MAX_TEXT)) throw new Error('annotation text');
  if (v.size !== undefined && (typeof v.size !== 'number' || !Number.isFinite(v.size))) throw new Error('annotation size');
  return makeAnnotation(v.id, { kind, color, fill: v.fill === true, width: v.width, points: v.points.map(pointFrom), text: v.text, size: v.size as number | undefined });
}

/** A drawing that can be shown: a freehand stroke needs two points after simplification. */
export function drawable(a: Annotation): boolean {
  return a.kind === 'text' ? Boolean(a.text) : a.points.length >= 2;
}

/**
 * The drawings of a file (none in files saved before v0.8). The list itself must be sane (or the file is
 * refused); a single malformed or repeated drawing is left out, so a lab is never lost because of a doodle.
 */
export function annotationsFromJson(v: unknown): Annotation[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_ANNOTATIONS) throw new Error('annotations');
  const seen = new Set<string>();
  return v.flatMap((item) => {
    try {
      const a = annotationFrom(item);
      if (seen.has(a.id) || !drawable(a)) return [];
      seen.add(a.id);
      return [a];
    } catch {
      return [];
    }
  });
}
