/**
 * Selection of several devices and drawings on the workspace: a box dragged over the background (Shift adds to
 * it), Shift+click, dragging the group together, deleting it, and copy, paste and duplicate (Ctrl+C/V/D). Every
 * group change is one undo step.
 */
import { svg } from './dom.ts';
import type { DeviceKind, Placed, Topology } from '../net/topology.ts';
import { MAX_DEVICES } from '../net/topology-file.ts';
import type { EditHistory } from '../net/edit-history.ts';
import { boundsOf, moveAnnotation } from '../net/annotations.ts';
import type { Annotation, Point } from '../net/annotations.ts';
import { copyClip, onlyKinds, PASTE_OFFSET } from '../net/topology-clip.ts';
import type { Clip } from '../net/topology-clip.ts';
import type { ClipAction } from './palette.ts';
import { t } from '../i18n/t.ts';

export interface GroupHost {
  topo(): Topology;
  edits(): EditHistory;
  toWorld(e: { clientX: number; clientY: number }): Point;
  readonly svgEl: SVGSVGElement;
  readonly world: { readonly w: number; readonly h: number };
  /** The device or drawing selected on its own (a click), if any. */
  single(): { readonly device?: string; readonly drawing?: string };
  clearSingle(): void;
  /** The selection changed: mark it on the devices and drawings. */
  marked(): void;
  /** A tap (no move) on a member of the group: a double tap opens a device, as without a group. */
  tapped(item: Item, e: PointerEvent): void;
  /** Deletes the device, cable or drawing selected on its own (toolbar button); false if none. */
  deleteSingle(): boolean;
  /** Draws the workspace again (while a group is dragged). */
  redraw(): void;
  gesture(on: boolean): void;
  scale(): number;
  pinching(): boolean;
  changed(): void;
  removed(id: string): void;
  hint(text: string): void;
  editable(): boolean;
  drawingLocked(): boolean;
  allows(kind: DeviceKind): boolean;
}

const DRAG_THRESHOLD = 4;
/** Touch or pen held still this long on the background starts a selection box (a quick drag pans). */
export const BOX_PRESS_MS = 450;
/** Screen pixels a finger may wander while it is held still. */
const TOUCH_SLOP = 10;
const BUZZ_MS = 15;

export interface Item {
  readonly device?: string;
  readonly drawing?: string;
}
/** Devices keep this far from the edge of the workspace. */
const MARGIN = 40;
/** Pastes in a row move further each time, and start again after this many. */
const MAX_PASTES = 10;

/** What was copied (kept across topologies: copy in one lab and paste in another). */
let clipboard: Clip | null = null;
let pastes = 0;
let space = false;

/** Space held: dragging the background pans instead of drawing a selection box. */
export function spaceHeld(): boolean {
  return space;
}

function typing(target: EventTarget | null): boolean {
  return target instanceof Element && (target.closest('input, textarea, select, .win-layer') !== null || (target instanceof HTMLElement && target.isContentEditable));
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !typing(e.target)) space = true; });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });
  window.addEventListener('blur', () => { space = false; });
}

const inside = (p: Point, box: { x: number; y: number; w: number; h: number }): boolean => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

export class GroupSelection {
  readonly devices = new Set<string>();
  readonly drawings = new Set<string>();
  readonly layer: SVGGElement;
  private readonly host: GroupHost;
  /** What was selected on its own when the pointer went down on the background (that click deselects it). */
  private remembered: Item = {};

  constructor(host: GroupHost) {
    this.host = host;
    this.layer = svg('g', { class: 'marquee-layer' });
  }

  size(): number {
    return this.devices.size + this.drawings.size;
  }

  has(id: string): boolean {
    return this.devices.has(id) || this.drawings.has(id);
  }

  /** Forgets the selection without redrawing (another topology, an undo). */
  reset(): void {
    this.devices.clear();
    this.drawings.clear();
  }

  clear(): void {
    if (this.size() === 0) return;
    this.reset();
    this.host.marked();
  }

  /** Pointer on a device or drawing: Shift toggles it; on a member of a group it drags the group. True when handled. */
  grab(e: PointerEvent, item: Item): boolean {
    this.prune();
    const id = item.device ?? item.drawing ?? '';
    const set = item.device !== undefined ? this.devices : this.drawings;
    if (e.shiftKey && e.button === 0) {
      this.absorbSingle();
      if (set.has(id)) set.delete(id);
      else set.add(id);
      this.selected();
      return true;
    }
    if (set.has(id) && this.size() > 1) {
      this.drag(e, item);
      return true;
    }
    this.clear();
    return false;
  }

  /** Forgets what was deleted some other way (the Delete tool, a window). */
  private prune(): void {
    const topo = this.host.topo();
    for (const id of this.devices) if (!topo.placed.has(id)) this.devices.delete(id);
    const drawings = new Set(topo.annotations.map((a) => a.id));
    for (const id of this.drawings) if (!drawings.has(id)) this.drawings.delete(id);
  }

  /** Called before a pointer on the background deselects the single item: an additive box keeps it. */
  remember(): void {
    this.remembered = this.host.single();
  }

  /** The item selected with a plain click joins a group started with Shift (or a long press). */
  private absorbSingle(): void {
    const now = this.host.single();
    const s = now.device !== undefined || now.drawing !== undefined ? now : this.remembered;
    this.remembered = {};
    if (s.device !== undefined) this.devices.add(s.device);
    if (s.drawing !== undefined) this.drawings.add(s.drawing);
  }

  private selected(): void {
    this.host.clearSingle();
    this.host.marked();
    if (this.size()) this.host.hint(t('clip.selected', { n: String(this.devices.size), d: String(this.drawings.size) }));
  }

  /**
   * Touch or pen on the background: a drag pans the view; held still for BOX_PRESS_MS it starts a selection box that
   * adds to the selection (there is no Shift key); a short tap clears the selection.
   */
  touchBackground(e: PointerEvent, pan: (e: PointerEvent) => () => void): void {
    const stopPan = pan(e);
    const target = this.host.svgEl;
    // A second finger (pinch zoom) makes the whole gesture a zoom: no box and no clearing when the fingers lift.
    let still = !this.host.pinching();
    let boxing = false;
    const done = (): void => {
      window.clearTimeout(timer);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('pointerdown', other);
    };
    const other = (ev: PointerEvent): void => { if (ev.pointerId !== e.pointerId) still = false; };
    const timer = window.setTimeout(() => {
      if (!still || this.host.pinching()) return;
      boxing = true;
      done();
      stopPan();
      globalThis.navigator?.vibrate?.(BUZZ_MS);
      this.marquee(e, true);
    }, BOX_PRESS_MS);
    const move = (ev: PointerEvent): void => {
      if (this.host.pinching()) still = false;
      else if (ev.pointerId === e.pointerId && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > TOUCH_SLOP) still = false;
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      done();
      if (still && !boxing && ev.type === 'pointerup' && !this.host.pinching()) this.clear();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('pointerdown', other);
  }

  /** A box dragged over the background selects what is fully inside it (Shift, or a long press, adds to the selection). */
  marquee(e: PointerEvent, additive = e.shiftKey): void {
    if (additive) this.absorbSingle();
    else this.clear();
    const start = this.host.toWorld(e);
    let box = { x: start.x, y: start.y, w: 0, h: 0 };
    const rect = svg('rect', { class: 'marquee', x: start.x, y: start.y, width: 0, height: 0 });
    this.layer.appendChild(rect);
    this.follow(e, (p) => {
      box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h })) rect.setAttribute(k, String(v));
    }, (ok) => {
      rect.remove();
      if (!ok || Math.max(box.w, box.h) < DRAG_THRESHOLD / this.host.scale()) return;
      this.pick(box);
    });
  }

  private pick(box: { x: number; y: number; w: number; h: number }): void {
    const topo = this.host.topo();
    for (const [id, p] of topo.placed) if (inside(p, box)) this.devices.add(id);
    if (!this.host.drawingLocked()) {
      for (const a of topo.annotations) {
        const b = boundsOf(a);
        if (inside(b, box) && inside({ x: b.x + b.w, y: b.y + b.h }, box)) this.drawings.add(a.id);
      }
    }
    this.selected();
  }

  /** Follows one pointer captured by the workspace; `end` runs when it is released or cancelled. */
  private follow(e: PointerEvent, step: (p: Point) => void, end: (ok: boolean) => void): void {
    const target = this.host.svgEl;
    target.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent): void => { if (ev.pointerId === e.pointerId && !this.host.pinching()) step(this.host.toWorld(ev)); };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      end(ev.type === 'pointerup');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /** Drags the whole group; on release the move is one undo step (devices and drawings together). */
  private drag(e: PointerEvent, item: Item): void {
    const topo = this.host.topo();
    const start = this.host.toWorld(e);
    const items = [...this.devices].flatMap((id) => { const p = topo.get(id); return p ? [{ id, p, from: { x: p.x, y: p.y } }] : []; });
    const before = topo.annotations;
    const { w, h } = this.host.world;
    const limit = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const xs = items.map((i) => i.from.x);
    const ys = items.map((i) => i.from.y);
    let moved = false;
    let last = { x: 0, y: 0 };
    const place = (d: Point, drawings: readonly Annotation[]): void => {
      for (const i of items) { i.p.x = i.from.x + d.x; i.p.y = i.from.y + d.y; }
      topo.annotations = drawings;
    };
    const shifted = (d: Point): readonly Annotation[] => before.map((a) => (this.drawings.has(a.id) ? moveAnnotation(a, d.x, d.y) : a));
    this.host.gesture(true);
    this.follow(e, (p) => {
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD / this.host.scale()) return;
      moved = true;
      last = {
        x: Math.round(xs.length ? limit(p.x - start.x, MARGIN - Math.min(...xs), w - MARGIN - Math.max(...xs)) : p.x - start.x),
        y: Math.round(ys.length ? limit(p.y - start.y, MARGIN - Math.min(...ys), h - MARGIN - Math.max(...ys)) : p.y - start.y),
      };
      place(last, shifted(last));
      this.host.redraw();
    }, (ok) => {
      this.host.gesture(false);
      if (!moved) {
        if (ok) this.host.tapped(item, e);
        return;
      }
      place({ x: 0, y: 0 }, before);
      if (ok) this.commitMove(items, last, shifted(last));
      this.host.changed();
    });
  }

  private commitMove(items: readonly { id: string; p: Placed; from: Point }[], d: Point, drawings: readonly Annotation[]): void {
    const topo = this.host.topo();
    this.host.edits().batch(() => {
      for (const i of items) {
        i.p.x = i.from.x + d.x;
        i.p.y = i.from.y + d.y;
        this.host.edits().moved(i.id, i.from);
      }
      topo.annotations = drawings;
    });
  }

  /** Supr on a group: its devices (with their cables) and drawings go, as one undo step. */
  remove(): boolean {
    this.prune();
    const topo = this.host.topo();
    const devices = this.host.editable() ? [...this.devices] : [];
    const drawings = this.host.drawingLocked() ? [] : [...this.drawings];
    if (devices.length + drawings.length === 0) return false;
    this.host.edits().batch(() => {
      for (const id of drawings) topo.removeAnnotation(id);
      for (const id of devices) if (this.host.edits().removeDevice(id)) this.host.removed(id);
    });
    this.reset();
    this.host.changed();
    return true;
  }

  /** Ctrl+C, Ctrl+V and Ctrl+D (⌘ on a Mac) while the workspace is in use. */
  key(e: KeyboardEvent): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || typing(e.target)) return false;
    const action = ({ c: 'copy', v: 'paste', d: 'duplicate' } as const)[e.key.toLowerCase() as 'c' | 'v' | 'd'];
    if (action === undefined) return false;
    // Text selected on the page (the hint, a caption): Ctrl+C copies that text as usual.
    if (action === 'copy' && String(globalThis.getSelection?.() ?? '') !== '') return false;
    e.preventDefault();
    this.run(action);
    return true;
  }

  run(action: ClipAction): void {
    if (action === 'delete') {
      if (!this.remove() && !this.host.deleteSingle()) this.host.hint(t('clip.nothing'));
      return;
    }
    if (action === 'paste') {
      if (!clipboard) return this.host.hint(t('clip.empty'));
      pastes = (pastes % MAX_PASTES) + 1;
      this.paste(clipboard, PASTE_OFFSET * pastes);
      return;
    }
    const clip = this.copy();
    if (!clip) return this.host.hint(t('clip.nothing'));
    if (action === 'duplicate') return this.paste(clip, PASTE_OFFSET);
    clipboard = clip;
    pastes = 0;
    this.host.hint(t('clip.copied', { n: String(clip.devices.length), d: String(clip.drawings.length) }));
  }

  /** The group, or else the device or drawing selected on its own; null when nothing is selected. */
  private copy(): Clip | null {
    // A locked classroom topology is not copied out to another lab.
    if (!this.host.editable()) return null;
    this.prune();
    const s = this.host.single();
    const devices = this.size() ? [...this.devices] : s.device !== undefined ? [s.device] : [];
    const drawings = this.host.drawingLocked() ? [] : this.size() ? [...this.drawings] : s.drawing !== undefined ? [s.drawing] : [];
    const clip = copyClip(this.host.topo(), devices, drawings);
    return clip.devices.length + clip.drawings.length ? clip : null;
  }

  /** Pastes as one undo step; what was pasted becomes the selection. */
  private paste(source: Clip, offset: number): void {
    if (!this.host.editable()) return;
    const topo = this.host.topo();
    const clip = onlyKinds(this.host.drawingLocked() ? { ...source, drawings: [] } : source, (k) => this.host.allows(k));
    // The same limits as opening a file (topology.ts validateFile), so what is saved can be opened again.
    if (topo.placed.size + clip.devices.length > MAX_DEVICES || topo.net.links.length + clip.links.length > MAX_DEVICES * 2) return this.host.hint(t('clip.tooMany', { n: String(MAX_DEVICES) }));
    const out = this.host.edits().paste(clip, offset, { ...this.host.world, margin: MARGIN });
    this.reset();
    for (const p of out.devices) this.devices.add(p.device.id);
    for (const a of out.drawings) this.drawings.add(a.id);
    this.host.clearSingle();
    this.host.changed();
    this.host.hint(t('clip.pasted', { n: String(out.devices.length), d: String(out.drawings.length) }));
  }
}
