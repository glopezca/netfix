/** Logical workspace: devices, cables with link lights, placing, moving, cabling, deleting. */
import { el, svg, clear, staticSvg } from './dom.ts';
import { ICONS, ICON_W, ICON_H, modelLabel } from './icons.ts';
import type { Topology, DeviceKind, Placed } from '../net/topology.ts';
import type { Endpoint, Link } from '../net/network.ts';
import { shortIfaceName } from '../ios/interfaces.ts';
import { Viewport } from './viewport.ts';
import { placeInside } from './viewport-math.ts';
import { along, clamp, perpendicular, triangle } from './canvas-geometry.ts';
import { DrawLayer } from './draw-layer.ts';
import { DrawState } from './draw-bar.ts';
import { historyFor } from '../net/edit-history.ts';
import type { EditHistory } from '../net/edit-history.ts';
import type { ShapeKind } from '../net/annotations.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';

export type Tool = { kind: 'select' } | { kind: 'cable' } | { kind: 'delete' } | { kind: 'place'; device: DeviceKind } | { kind: 'draw'; shape: ShapeKind };

export interface CanvasEvents {
  open(id: string): void;
  changed(): void;
  hint(text: string): void;
  removed(id: string): void;
}

export const WORLD_W = 2400;
export const WORLD_H = 1600;
const LIGHT_OFFSET = 36;
const LABEL_OFFSET = 62;
const DRAG_THRESHOLD = 4;
const DOUBLE_TAP_MS = 350;
const LONG_PRESS_MS = 550;

const HINTS: Readonly<Record<Tool['kind'], MessageKey>> = {
  select: 'canvas.hint.select', cable: 'canvas.hint.cable', delete: 'canvas.hint.delete', place: 'canvas.hint.place', draw: 'canvas.hint.draw',
};

export class Canvas {
  readonly root: HTMLElement;
  readonly svgEl: SVGSVGElement;
  readonly packetLayer: SVGGElement;
  private readonly linkLayer: SVGGElement;
  private readonly deviceLayer: SVGGElement;
  private readonly menu: HTMLElement;
  private topo: Topology;
  private tool: Tool = { kind: 'select' };
  private selected: string | null = null;
  /** False when classroom restrictions lock the topology (Del removes no device or cable). */
  editable = true;
  private pendingEnd: Endpoint | null = null;
  private readonly events: CanvasEvents;
  private frame = 0;
  readonly viewport: Viewport;
  private lastTap: { id: string; time: number } | null = null;
  /** A drag or tap on a device is in progress: periodic redraws wait so its element stays in the DOM. */
  private gesture = false;
  private lastPointer = 'mouse';
  /** Areas, lines and labels drawn over the network. */
  readonly draw: DrawLayer;

  constructor(topo: Topology, events: CanvasEvents, drawState = new DrawState()) {
    this.topo = topo;
    this.events = events;
    this.linkLayer = svg('g', { class: 'links' });
    this.deviceLayer = svg('g', { class: 'devices' });
    this.packetLayer = svg('g', { class: 'packets' });
    this.svgEl = svg('svg', { class: 'world', width: WORLD_W, height: WORLD_H, viewBox: `0 0 ${WORLD_W} ${WORLD_H}`, role: 'application', 'aria-label': t('canvas.label') },
      svg('rect', { class: 'world-bg', x: 0, y: 0, width: WORLD_W, height: WORLD_H }), this.linkLayer, this.deviceLayer, this.packetLayer);
    this.menu = el('div', { class: 'port-menu', role: 'menu', hidden: true });
    this.root = el('div', { class: 'workspace', tabindex: '0' }, this.svgEl, this.menu);
    this.draw = new DrawLayer({
      topo: () => this.topo, toWorld: (e) => this.toWorld(e), toScreen: (p) => this.toScreen(p), changed: () => this.events.changed(),
      deleting: () => this.tool.kind === 'delete', selectedDrawing: () => { this.selected = null; this.markSelection(); }, pinching: () => this.viewport.pinching(), overlay: this.root,
    }, drawState);
    this.linkLayer.before(this.draw.layer);
    this.svgEl.addEventListener('pointerdown', (e) => { this.lastPointer = e.pointerType; }, { capture: true });
    this.svgEl.addEventListener('pointerdown', (e) => this.onBackground(e));
    this.root.addEventListener('keydown', (e) => this.handleKey(e));
    this.viewport = new Viewport(this.root, this.svgEl, WORLD_W, WORLD_H);
  }

  setTopology(topo: Topology): void {
    this.topo = topo;
    this.selected = null;
    this.pendingEnd = null;
    this.draw.reset();
    this.render();
    this.frameContent();
  }

  /** Undo and redo of this workspace's edits. */
  edits(): EditHistory {
    return historyFor(this.topo);
  }

  /** After an undo or redo: what was selected may be gone. */
  clearSelection(): void {
    this.selected = null;
    this.pendingEnd = null;
    this.draw.reset();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.pendingEnd = null;
    this.hideMenu();
    this.root.dataset.tool = tool.kind;
    this.events.hint(t(HINTS[tool.kind]));
    this.render();
  }

  currentTool(): Tool {
    return this.tool;
  }

  centerOf(id: string): { x: number; y: number } | undefined {
    const p = this.topo.get(id);
    return p ? { x: p.x, y: p.y } : undefined;
  }

  zoom(action: 'in' | 'out' | 'fit'): void {
    this.viewport.zoom(action, this.contentPoints());
  }

  /** Devices and drawings: what «fit» and the first view must show. */
  private contentPoints(): { x: number; y: number }[] {
    return [...this.topo.placed.values(), ...this.topo.annotations.flatMap((a) => a.points)];
  }

  /** Shows the whole network if it does not fit (after the layout has a size). */
  frameContent(): void {
    requestAnimationFrame(() => this.viewport.fitIfNeeded(this.contentPoints()));
  }

  /** Coalesces renders to one per animation frame. */
  requestRender(): void {
    if (this.frame || this.gesture) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(): void {
    this.draw.render();
    this.renderLinks();
    // The redraw replaces the device elements: the focused one gets its focus back, or Supr would stop working.
    const active = document.activeElement;
    const focused = active instanceof Element && this.deviceLayer.contains(active) ? active.getAttribute('data-id') : null;
    clear(this.deviceLayer);
    for (const [id, p] of this.topo.placed) {
      const g = this.drawDevice(id, p);
      this.deviceLayer.appendChild(g);
      if (id === focused) g.focus({ preventScroll: true });
    }
  }

  private markSelection(): void {
    for (const node of this.svgEl.querySelectorAll<SVGGElement>('[data-id], [data-link]')) {
      const key = node.getAttribute('data-id') ?? node.getAttribute('data-link');
      node.classList.toggle('is-selected', key === this.selected);
    }
  }

  private renderLinks(): void {
    clear(this.linkLayer);
    for (const link of this.topo.net.links) this.linkLayer.appendChild(this.drawLink(link));
  }

  private endState(ep: Endpoint): 'up' | 'down' {
    return this.topo.net.linkUp(ep) ? 'up' : 'down';
  }

  private drawLink(link: Link): SVGGElement {
    const a = this.topo.get(link.a.device);
    const b = this.topo.get(link.b.device);
    const g = svg('g', { class: `link${this.selected === link.id ? ' is-selected' : ''}`, 'data-link': link.id });
    if (!a || !b) return g;
    const line = svg('line', { class: 'cable', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    const hit = svg('line', { class: 'cable-hit', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    g.append(hit, line);
    for (const [from, to, ep] of [[a, b, link.a], [b, a, link.b]] as const) {
      const pos = along(from, to, LIGHT_OFFSET);
      const lpos = along(from, to, LABEL_OFFSET);
      g.appendChild(svg('path', { class: `light light-${this.endState(ep)}`, d: triangle(pos, from, to) }));
      const side = perpendicular(from, to, 12);
      g.appendChild(svg('text', { class: 'port-label', x: lpos.x + side.x, y: lpos.y + side.y + 4, 'text-anchor': side.x < 0 ? 'end' : 'start' }, shortIfaceName(ep.port)));
    }
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.tool.kind === 'delete') {
        this.edits().disconnect(link.id);
        this.events.changed();
        return;
      }
      this.selected = link.id;
      this.markSelection();
    });
    return g;
  }

  private drawDevice(id: string, p: Placed): SVGGElement {
    const d = p.device;
    const name = d.kind === 'router' || d.kind === 'switch' ? d.hostname : d.kind === 'cloud' ? d.settings.isp : '';
    const g = svg('g', {
      class: `device device-${d.kind}${this.selected === id ? ' is-selected' : ''}${this.pendingEnd?.device === id ? ' is-pending' : ''}`,
      transform: `translate(${p.x} ${p.y})`, tabindex: '0', 'data-id': id, role: 'button', 'aria-label': `${p.label} (${modelLabel(d.kind)})`,
    });
    g.appendChild(svg('rect', { class: 'device-halo', x: -ICON_W / 2 - 8, y: -ICON_H / 2 - 8, width: ICON_W + 16, height: ICON_H + 16, rx: 10 }));
    const icon = staticSvg(ICONS[d.kind]);
    icon.setAttribute('x', String(-ICON_W / 2));
    icon.setAttribute('y', String(-ICON_H / 2));
    g.appendChild(icon);
    g.appendChild(svg('text', { class: 'device-model', x: 0, y: -ICON_H / 2 - 12 }, modelLabel(d.kind)));
    g.appendChild(svg('text', { class: 'device-label', x: 0, y: ICON_H / 2 + 18 }, p.label));
    if (name && name !== 'Router' && name !== 'Switch' && name !== p.label) g.appendChild(svg('text', { class: 'device-host', x: 0, y: ICON_H / 2 + 33 }, name));
    g.addEventListener('pointerdown', (e) => this.onDevicePointer(e, id, g));
    // Touch double-taps are handled in tapped(): browsers also synthesise dblclick from any two quick taps.
    g.addEventListener('dblclick', () => { if (this.lastPointer === 'mouse') this.events.open(id); });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.events.open(id);
    });
    return g;
  }

  // ------------------------------------------------------------ interaction

  private toWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.svgEl.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * WORLD_W) / r.width, y: ((e.clientY - r.top) * WORLD_H) / r.height };
  }

  /** Position of a workspace point inside the (scrolling) workspace element. */
  private toScreen(p: { x: number; y: number }): { x: number; y: number } {
    const r = this.svgEl.getBoundingClientRect();
    const host = this.root.getBoundingClientRect();
    return { x: r.left - host.left + this.root.scrollLeft + (p.x * r.width) / WORLD_W, y: r.top - host.top + this.root.scrollTop + (p.y * r.height) / WORLD_H };
  }

  private onBackground(e: PointerEvent): void {
    this.hideMenu();
    this.draw.deselect();
    if (this.tool.kind === 'draw') {
      this.draw.begin(e, this.tool.shape);
      return;
    }
    if (this.tool.kind === 'place') {
      const { x, y } = this.toWorld(e);
      this.edits().addDevice(this.tool.device, clamp(x, 40, WORLD_W - 40), clamp(y, 40, WORLD_H - 40));
      this.setTool({ kind: 'select' });
      this.events.changed();
      return;
    }
    this.pendingEnd = null;
    if (this.selected !== null) {
      this.selected = null;
      this.markSelection();
    }
    if (e.button === 0 || e.pointerType !== 'mouse') this.viewport.beginPan(e);
  }

  private onDevicePointer(e: PointerEvent, id: string, g: SVGGElement): void {
    e.stopPropagation();
    this.hideMenu();
    this.draw.deselect();
    if (this.tool.kind === 'delete') {
      this.edits().removeDevice(id);
      this.events.removed(id);
      this.events.changed();
      return;
    }
    if (this.tool.kind === 'cable') {
      this.showPortMenu(id, e);
      return;
    }
    this.selected = id;
    this.dragDevice(e, id, g);
  }

  /** Touch and pen: a second tap within DOUBLE_TAP_MS opens the device (dblclick is unreliable on phones). */
  private tapped(id: string, e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    const now = performance.now();
    if (this.lastTap?.id === id && now - this.lastTap.time < DOUBLE_TAP_MS) {
      this.lastTap = null;
      this.events.open(id);
      return;
    }
    this.lastTap = { id, time: now };
  }

  private dragDevice(e: PointerEvent, id: string, g: SVGGElement): void {
    const placed = this.topo.get(id);
    if (!placed) return;
    const start = this.toWorld(e);
    const origin = { x: placed.x, y: placed.y };
    let moved = false;
    this.gesture = true;
    g.setPointerCapture(e.pointerId);
    const press = e.pointerType === 'mouse' ? 0 : window.setTimeout(() => { if (!moved) { moved = true; this.events.open(id); } }, LONG_PRESS_MS);
    const move = (ev: PointerEvent): void => {
      if (this.viewport.pinching()) return;
      const p = this.toWorld(ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD / this.viewport.scale) return;
      window.clearTimeout(press);
      moved = true;
      placed.x = clamp(origin.x + p.x - start.x, 40, WORLD_W - 40);
      placed.y = clamp(origin.y + p.y - start.y, 40, WORLD_H - 40);
      g.setAttribute('transform', `translate(${placed.x} ${placed.y})`);
      this.renderLinks();
    };
    const up = (ev: PointerEvent): void => {
      this.gesture = false;
      window.clearTimeout(press);
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      g.removeEventListener('pointercancel', up);
      if (moved) {
        this.edits().moved(id, origin);
        this.events.changed();
      } else {
        this.markSelection();
        if (ev.type === 'pointerup') this.tapped(id, ev);
      }
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  }

  private showPortMenu(id: string, e: PointerEvent): void {
    const placed = this.topo.get(id);
    if (!placed) return;
    if (this.pendingEnd?.device === id) return;
    const ports = placed.device.portNames();
    const items = ports.map((port) => {
      const used = this.topo.net.linkAt({ device: id, port }) !== undefined;
      const b = el('button', { type: 'button', role: 'menuitem', class: 'port-item', disabled: used }, port);
      b.addEventListener('click', () => this.pickPort({ device: id, port }));
      return b;
    });
    const title = t(this.pendingEnd ? 'canvas.connectTo' : 'canvas.from', { name: placed.label });
    this.menu.replaceChildren(el('p', { class: 'port-menu-title' }, title), ...items);
    this.menu.hidden = false;
    const host = this.root.getBoundingClientRect();
    const pos = placeInside(e.clientX - host.left + 8, e.clientY - host.top + 8, this.menu.offsetWidth, this.menu.offsetHeight, this.root.clientWidth, this.root.clientHeight);
    this.menu.style.left = `${pos.x + this.root.scrollLeft}px`;
    this.menu.style.top = `${pos.y + this.root.scrollTop}px`;
    (items.find((b) => !b.disabled) ?? items[0])?.focus();
  }

  private pickPort(ep: Endpoint): void {
    this.hideMenu();
    if (!this.pendingEnd) {
      this.pendingEnd = ep;
      this.events.hint(t('canvas.cableFrom', { name: this.topo.get(ep.device)?.label ?? ep.device, port: ep.port }));
      this.render();
      return;
    }
    try {
      this.edits().connect(this.pendingEnd, ep);
      this.events.hint(t(HINTS.cable));
    } catch (err) {
      this.events.hint(t('canvas.connectFailed', { error: err instanceof Error ? err.message : t('canvas.unknownError') }));
    }
    this.pendingEnd = null;
    this.events.changed();
  }

  private hideMenu(): void {
    this.menu.hidden = true;
  }

  /** Escape: back to Select; Supr or Backspace: delete the selected drawing, device (with its cables) or cable. */
  handleKey(e: KeyboardEvent): void {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    if (e.key === 'Escape') {
      this.setTool({ kind: 'select' });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.draw.deleteSelected()) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && this.editable) {
      const id = this.selected;
      if (this.topo.get(id)) {
        this.edits().removeDevice(id);
        this.events.removed(id);
      } else {
        this.edits().disconnect(id);
      }
      this.selected = null;
      e.preventDefault();
      this.events.changed();
    }
  }
}
