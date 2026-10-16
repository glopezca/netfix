/**
 * Drawings layer of the workspace (below cables and devices): draws the annotations of the topology and handles
 * drawing new ones, selecting, moving, deleting and editing their text. Filled areas only catch the pointer on
 * their border and their name, so the background (pan, placing devices) keeps working inside them.
 */
import { el, svg, clear } from './dom.ts';
import type { Topology } from '../net/topology.ts';
import { boundsOf, moveAnnotation, restyle, MAX_TEXT } from '../net/annotations.ts';
import type { Annotation, AnnotationStyle, Point, ShapeKind } from '../net/annotations.ts';
import type { DrawState } from './draw-bar.ts';
import { t } from '../i18n/t.ts';

const MIN_SIZE = 6;
const FILL_OPACITY = '0.12';
const LABEL_PAD = 8;

export interface DrawHost {
  topo(): Topology;
  toWorld(e: { clientX: number; clientY: number }): Point;
  /** Screen position of a workspace point, relative to the workspace element (for the text editor). */
  toScreen(p: Point): Point;
  changed(): void;
  deleting(): boolean;
  /** The pointer went down on a drawing while selecting: the device selection is cleared. */
  selectedDrawing(): void;
  /** Two fingers are zooming the view. */
  pinching(): boolean;
  readonly overlay: HTMLElement;
}

function shapePath(kind: ShapeKind, a: Point, b: Point, pts: readonly Point[]): SVGElement {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (kind === 'rect') return svg('rect', { x, y, width: w, height: h, rx: 12 });
  if (kind === 'ellipse') return svg('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 });
  if (kind === 'line') return svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  return svg('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' ') });
}

/** The SVG of one drawing (shape, plus its name for areas). */
export function drawingNode(a: Annotation, selected: boolean): SVGGElement {
  const g = svg('g', { class: `drawing drawing-${a.kind}${selected ? ' is-selected' : ''}`, 'data-drawing': a.id });
  const [p0 = { x: 0, y: 0 }, p1 = p0] = a.points;
  if (a.kind === 'text') {
    g.appendChild(svg('text', { class: 'drawing-text', x: p0.x, y: p0.y, fill: a.color, 'font-size': a.size ?? 16 }, a.text ?? ''));
    return g;
  }
  const shape = shapePath(a.kind, p0, p1, a.points);
  shape.setAttribute('class', 'drawing-shape');
  shape.setAttribute('stroke', a.color);
  shape.setAttribute('stroke-width', String(a.width));
  shape.setAttribute('fill', a.fill ? a.color : 'none');
  if (a.fill) shape.setAttribute('fill-opacity', FILL_OPACITY);
  // A wide invisible stroke makes thin borders and lines easy to grab (like cables).
  const hit = shape.cloneNode() as SVGElement;
  hit.setAttribute('class', 'drawing-hit');
  hit.removeAttribute('stroke');
  hit.setAttribute('fill', 'none');
  hit.removeAttribute('fill-opacity');
  g.append(hit, shape);
  if (a.text && (a.kind === 'rect' || a.kind === 'ellipse')) {
    const box = boundsOf(a);
    g.appendChild(svg('text', { class: 'drawing-label', x: box.x + LABEL_PAD, y: box.y + LABEL_PAD + (a.size ?? 16), fill: a.color, 'font-size': a.size ?? 16 }, a.text));
  }
  return g;
}

export class DrawLayer {
  readonly layer: SVGGElement;
  private selected: string | null = null;
  /** Classroom restrictions without drawing: the drawings (lab areas, notes) cannot be selected, moved or edited. */
  locked = false;
  private drawn: readonly Annotation[] | null = null;
  private drawnSelection: string | null = null;
  /** A drawing is being drawn or dragged: redraws wait so its element and pointer capture survive. */
  private dragging = false;
  private restylePending = false;
  private readonly host: DrawHost;
  private readonly state: DrawState;

  constructor(host: DrawHost, state: DrawState) {
    this.host = host;
    this.state = state;
    this.layer = svg('g', { class: 'drawings' });
    state.onChange((s) => this.restyleSelected(s));
  }

  selection(): string | null {
    return this.selected;
  }

  deselect(): void {
    if (this.selected === null) return;
    this.setSelected(null);
    this.render();
  }

  /** Another topology: nothing of the old one stays selected (drawing ids restart in each one). */
  reset(): void {
    this.setSelected(null);
    this.render(true);
  }

  private setSelected(id: string | null): void {
    this.selected = id;
    this.state.select(id);
  }

  /** Draws again only when the drawings or the selection changed (the workspace redraws often). */
  render(force = false): void {
    const list = this.host.topo().annotations;
    if (this.dragging || (!force && list === this.drawn && this.selected === this.drawnSelection)) return;
    this.drawn = list;
    this.drawnSelection = this.selected;
    clear(this.layer);
    for (const a of list) {
      const g = drawingNode(a, a.id === this.selected);
      g.addEventListener('pointerdown', (e) => { if (!this.locked) this.onPointer(e, a.id, g); });
      g.addEventListener('dblclick', (e) => { if (this.locked) return; e.stopPropagation(); this.editText(a.id); });
      this.layer.appendChild(g);
    }
  }

  deleteSelected(): boolean {
    if (this.selected === null || this.locked) return false;
    this.host.topo().removeAnnotation(this.selected);
    this.setSelected(null);
    this.host.changed();
    return true;
  }

  count(): number {
    return this.host.topo().annotations.length;
  }

  /** Removes every drawing of the workspace; false when there were none. */
  deleteAll(): boolean {
    this.setSelected(null);
    if (!this.host.topo().clearAnnotations()) return false;
    this.host.changed();
    return true;
  }

  /** A new colour, fill or width applies to the selected drawing (once per frame: the RGB picker fires often). */
  private restyleSelected(s: AnnotationStyle): void {
    const id = this.selected;
    if (id === null) return;
    this.host.topo().updateAnnotation(id, (a) => restyle(a, s));
    if (this.restylePending) return;
    this.restylePending = true;
    requestAnimationFrame(() => { this.restylePending = false; this.host.changed(); });
  }

  /** Pointer on a drawing: delete it, or select it and drag it (main button, one pointer). */
  private onPointer(e: PointerEvent, id: string, g: SVGGElement): void {
    e.stopPropagation();
    if (e.button !== 0 || this.dragging) return;
    if (this.host.deleting()) {
      this.host.topo().removeAnnotation(id);
      if (this.selected === id) this.setSelected(null);
      this.host.changed();
      return;
    }
    this.host.selectedDrawing();
    this.setSelected(id);
    this.drawnSelection = id;
    for (const n of this.layer.querySelectorAll('[data-drawing]')) n.classList.toggle('is-selected', n.getAttribute('data-drawing') === id);
    this.drag(e, (dx, dy) => g.setAttribute('transform', `translate(${dx} ${dy})`), (dx, dy) => {
      if (dx === 0 && dy === 0) return g.removeAttribute('transform');
      this.host.topo().updateAnnotation(id, (a) => moveAnnotation(a, dx, dy));
      this.host.changed();
    }, g);
  }

  /**
   * Follows one pointer (others are ignored) while redraws wait; `end` gets the total move, or 0,0 when the
   * gesture was cancelled or turned into a pinch.
   */
  private drag(e: PointerEvent, step: (dx: number, dy: number, p: Point) => void, end: (dx: number, dy: number) => void, target: Element): void {
    const id = e.pointerId;
    const start = this.host.toWorld(e);
    let last = start;
    this.dragging = true;
    target.setPointerCapture?.(id);
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== id || this.host.pinching()) return;
      last = this.host.toWorld(ev);
      step(last.x - start.x, last.y - start.y, last);
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up as EventListener);
      target.removeEventListener('pointercancel', up as EventListener);
      this.dragging = false;
      const ok = ev.type === 'pointerup' && !this.host.pinching();
      end(ok ? last.x - start.x : 0, ok ? last.y - start.y : 0);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up as EventListener);
    target.addEventListener('pointercancel', up as EventListener);
  }

  /** Draws a new shape from a pointer on the background; text asks for its content where it was placed. */
  begin(e: PointerEvent, kind: ShapeKind): void {
    if (e.button !== 0 || this.dragging || this.host.pinching()) return;
    const a = this.host.toWorld(e);
    if (kind === 'text') {
      // The box opens once the click is over, or the click itself would take the focus away from it.
      e.preventDefault();
      requestAnimationFrame(() => this.askText(a, '', (text) => {
        if (text && this.host.topo().addAnnotation({ kind: 'text', points: [a], text, ...this.state.style() })) this.host.changed();
      }));
      return;
    }
    const points: Point[] = [a];
    let preview: SVGElement | null = null;
    const target = e.currentTarget instanceof Element ? e.currentTarget : this.layer;
    this.drag(e, (_dx, _dy, p) => {
      if (kind === 'free') points.push(p);
      else points[1] = p;
      preview?.remove();
      preview = drawingNode({ id: 'preview', kind, points: [...points], ...this.state.style() }, false);
      this.layer.appendChild(preview);
    }, (dx, dy) => {
      preview?.remove();
      if (dx !== 0 || dy !== 0 || kind === 'free') this.commit(kind, points);
    }, target);
  }

  /** Keeps the new drawing (not selected: the next colour picked is for the next drawing). */
  private commit(kind: ShapeKind, points: readonly Point[]): void {
    const [a, b] = [points[0], points[points.length - 1]];
    if (!a || !b || points.length < 2 || (kind !== 'free' && Math.hypot(b.x - a.x, b.y - a.y) < MIN_SIZE)) return;
    const added = this.host.topo().addAnnotation({ kind, points: kind === 'free' ? points : [a, b], ...this.state.style() });
    if (!added) return;
    this.host.changed();
    // A new area asks for its name at once (Escape or an empty name leaves it unnamed).
    if (kind === 'rect' || kind === 'ellipse') requestAnimationFrame(() => this.editText(added.id));
  }

  /** Double click: the text of a label, or the name of an area. */
  editText(id: string): void {
    const a = this.host.topo().annotations.find((x) => x.id === id);
    if (!a || a.kind === 'line' || a.kind === 'free') return;
    const box = boundsOf(a);
    const at = a.kind === 'text' ? a.points[0] ?? { x: 0, y: 0 } : { x: box.x + LABEL_PAD, y: box.y + LABEL_PAD + (a.size ?? 16) };
    this.askText(at, a.text ?? '', (text) => {
      this.host.topo().updateAnnotation(id, (x) => restyle(x, { text }));
      if (a.kind === 'text' && !text) this.host.topo().removeAnnotation(id);
      this.host.changed();
    });
  }

  /** A small text box over the workspace; Enter accepts, Escape cancels. */
  private askText(at: Point, value: string, done: (text: string) => void): void {
    const box = el('input', { type: 'text', class: 'draw-text-input', value, maxlength: String(MAX_TEXT), 'aria-label': t('draw.textPrompt'), placeholder: t('draw.textPrompt') });
    const pos = this.host.toScreen(at);
    box.style.left = `${pos.x}px`;
    box.style.top = `${pos.y - 24}px`;
    let finished = false;
    const finish = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      box.remove();
      if (ok) done(box.value.trim());
    };
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    box.addEventListener('blur', () => finish(true));
    this.host.overlay.appendChild(box);
    box.focus();
  }
}
