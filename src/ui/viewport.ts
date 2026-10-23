/**
 * Zoom and pan of the workspace: Ctrl+wheel (and touchpad pinch, which browsers send as Ctrl+wheel), two-finger
 * pinch, dragging the background to pan (finger, pen or mouse), and fit-to-content. The SVG keeps its viewBox
 * and is resized, so the scroll container does the panning.
 */
import { clampScale, zoomAt, fitBox, boundsOf, pinchScale, ZOOM_STEP } from './viewport-math.ts';

const WHEEL_ZOOM_SPEED = 0.0025;

interface Pinch {
  readonly startScale: number;
  readonly startDistance: number;
}

export class Viewport {
  scale = 1;
  private readonly root: HTMLElement;
  private readonly svgEl: SVGSVGElement;
  private readonly worldW: number;
  private readonly worldH: number;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: Pinch | null = null;

  constructor(root: HTMLElement, svgEl: SVGSVGElement, worldW: number, worldH: number) {
    this.root = root;
    this.svgEl = svgEl;
    this.worldW = worldW;
    this.worldH = worldH;
    root.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    root.addEventListener('pointerdown', (e) => this.trackTouch(e), { capture: true });
    root.addEventListener('pointermove', (e) => this.onTouchMove(e), { capture: true });
    for (const type of ['pointerup', 'pointercancel'] as const) root.addEventListener(type, (e) => this.untrack(e), { capture: true });
    this.apply();
  }

  /** True while two fingers are on the workspace (device drags should stop). */
  pinching(): boolean {
    return this.pinch !== null;
  }

  private apply(): void {
    this.svgEl.setAttribute('width', String(Math.round(this.worldW * this.scale)));
    this.svgEl.setAttribute('height', String(Math.round(this.worldH * this.scale)));
    this.root.dataset.zoom = String(Math.round(this.scale * 100));
  }

  /** Point of the viewport (relative to its top-left corner) for a client position. */
  private local(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /** Sets the scale keeping `at` (viewport pixels; default: the centre) fixed. */
  zoomTo(scale: number, at?: { x: number; y: number }): void {
    const next = clampScale(scale);
    if (next === this.scale) return;
    const point = at ?? { x: this.root.clientWidth / 2, y: this.root.clientHeight / 2 };
    const scroll = zoomAt(this.scale, next, point, { left: this.root.scrollLeft, top: this.root.scrollTop });
    this.scale = next;
    this.apply();
    this.root.scrollLeft = scroll.left;
    this.root.scrollTop = scroll.top;
  }

  zoom(action: 'in' | 'out' | 'fit', points: Iterable<{ x: number; y: number }> = []): void {
    if (action === 'in') this.zoomTo(this.scale * ZOOM_STEP);
    else if (action === 'out') this.zoomTo(this.scale / ZOOM_STEP);
    else this.fit(points);
  }

  fit(points: Iterable<{ x: number; y: number }>): void {
    const f = fitBox(boundsOf(points), this.root.clientWidth, this.root.clientHeight);
    this.scale = f.scale;
    this.apply();
    this.root.scrollLeft = f.scroll.left;
    this.root.scrollTop = f.scroll.top;
  }

  /** Fits when the content does not fit at the current scale (first view on phones and tablets). */
  fitIfNeeded(points: Iterable<{ x: number; y: number }>): void {
    const box = boundsOf(points);
    if (!box || this.root.clientWidth === 0) return;
    const margin = 60;
    const fits = (box.maxX - box.minX + 2 * margin) * this.scale <= this.root.clientWidth && (box.maxY - box.minY + 2 * margin) * this.scale <= this.root.clientHeight;
    if (fits) {
      this.root.scrollLeft = Math.max(0, box.minX * this.scale - margin);
      this.root.scrollTop = Math.max(0, box.minY * this.scale - margin);
    } else this.fit([{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }]);
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.zoomTo(this.scale * Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED), this.local(e.clientX, e.clientY));
  }

  // ------------------------------------------------------------ pan (background) and pinch

  /** Drags the view with a finger, pen or mouse on the empty background; returns a function that stops it. */
  beginPan(e: PointerEvent): () => void {
    const start = { x: e.clientX, y: e.clientY, left: this.root.scrollLeft, top: this.root.scrollTop };
    const target = e.target instanceof Element ? e.target : this.svgEl;
    target.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId || this.pinch) return;
      this.root.scrollLeft = start.left - (ev.clientX - start.x);
      this.root.scrollTop = start.top - (ev.clientY - start.y);
    };
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', end as EventListener);
      target.removeEventListener('pointercancel', end as EventListener);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', end as EventListener);
    target.addEventListener('pointercancel', end as EventListener);
    return () => end(e);
  }

  private trackTouch(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) this.pinch = { startScale: this.scale, startDistance: this.distance() };
  }

  private distance(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onTouchMove(e: PointerEvent): void {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.pinch || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    e.preventDefault();
    this.zoomTo(pinchScale(this.pinch.startScale, this.pinch.startDistance, this.distance()), this.local((a.x + b.x) / 2, (a.y + b.y) / 2));
  }

  private untrack(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
  }
}
