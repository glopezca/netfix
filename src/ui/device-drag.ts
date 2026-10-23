/** Dragging one device on the workspace (a long press on touch screens opens it instead). */
import type { Placed } from '../net/topology.ts';
import type { Point } from '../net/annotations.ts';
import { clamp } from './canvas-geometry.ts';

const DRAG_THRESHOLD = 4;
const LONG_PRESS_MS = 550;
/** Devices keep this far from the edge of the workspace. */
const MARGIN = 40;

export interface DeviceDragHost {
  toWorld(e: { clientX: number; clientY: number }): Point;
  readonly world: { readonly w: number; readonly h: number };
  scale(): number;
  pinching(): boolean;
  gesture(on: boolean): void;
  renderLinks(): void;
  open(id: string): void;
  /** Released: `moved` from `origin`, or a tap or click (`ev` tells which). */
  done(id: string, moved: boolean, origin: Point, ev: PointerEvent): void;
}

export function dragDevice(h: DeviceDragHost, e: PointerEvent, placed: Placed, g: SVGGElement): void {
  const id = placed.device.id;
  const start = h.toWorld(e);
  const origin = { x: placed.x, y: placed.y };
  let moved = false;
  h.gesture(true);
  g.setPointerCapture(e.pointerId);
  const press = e.pointerType === 'mouse' ? 0 : window.setTimeout(() => { if (!moved) { moved = true; h.open(id); } }, LONG_PRESS_MS);
  const move = (ev: PointerEvent): void => {
    if (h.pinching()) return;
    const p = h.toWorld(ev);
    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD / h.scale()) return;
    window.clearTimeout(press);
    moved = true;
    placed.x = clamp(origin.x + p.x - start.x, MARGIN, h.world.w - MARGIN);
    placed.y = clamp(origin.y + p.y - start.y, MARGIN, h.world.h - MARGIN);
    g.setAttribute('transform', `translate(${placed.x} ${placed.y})`);
    h.renderLinks();
  };
  const up = (ev: PointerEvent): void => {
    h.gesture(false);
    window.clearTimeout(press);
    g.removeEventListener('pointermove', move);
    g.removeEventListener('pointerup', up);
    g.removeEventListener('pointercancel', up);
    h.done(id, moved, origin, ev);
  };
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', up);
  g.addEventListener('pointercancel', up);
}
