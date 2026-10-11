/** Logical workspace: devices, cables with link lights, placing, moving, cabling, deleting. */
import { el, svg, clear, staticSvg } from './dom.ts';
import { ICONS, ICON_W, ICON_H, MODEL_LABEL } from './icons.ts';
import type { Topology, DeviceKind, Placed } from '../net/topology.ts';
import type { Endpoint, Link } from '../net/network.ts';
import { shortIfaceName } from '../ios/interfaces.ts';

export type Tool = { kind: 'select' } | { kind: 'cable' } | { kind: 'delete' } | { kind: 'place'; device: DeviceKind };

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

const HINTS: Readonly<Record<Tool['kind'], string>> = {
  select: 'Arrastra para mover. Doble clic para abrir la consola o el escritorio.',
  cable: 'Cable: haz clic en el primer dispositivo y elige un puerto.',
  delete: 'Eliminar: haz clic en un dispositivo o en un cable.',
  place: 'Haz clic en el área de trabajo para colocar el dispositivo.',
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
  private pendingEnd: Endpoint | null = null;
  private readonly events: CanvasEvents;
  private frame = 0;

  constructor(topo: Topology, events: CanvasEvents) {
    this.topo = topo;
    this.events = events;
    this.linkLayer = svg('g', { class: 'links' });
    this.deviceLayer = svg('g', { class: 'devices' });
    this.packetLayer = svg('g', { class: 'packets' });
    this.svgEl = svg('svg', { class: 'world', width: WORLD_W, height: WORLD_H, viewBox: `0 0 ${WORLD_W} ${WORLD_H}`, role: 'application', 'aria-label': 'Área de trabajo lógica' },
      svg('rect', { class: 'world-bg', x: 0, y: 0, width: WORLD_W, height: WORLD_H }), this.linkLayer, this.deviceLayer, this.packetLayer);
    this.menu = el('div', { class: 'port-menu', role: 'menu', hidden: true });
    this.root = el('div', { class: 'workspace', tabindex: '0' }, this.svgEl, this.menu);
    this.svgEl.addEventListener('pointerdown', (e) => this.onBackground(e));
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  setTopology(topo: Topology): void {
    this.topo = topo;
    this.selected = null;
    this.pendingEnd = null;
    this.render();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.pendingEnd = null;
    this.hideMenu();
    this.root.dataset.tool = tool.kind;
    this.events.hint(HINTS[tool.kind]);
    this.render();
  }

  currentTool(): Tool {
    return this.tool;
  }

  centerOf(id: string): { x: number; y: number } | undefined {
    const p = this.topo.get(id);
    return p ? { x: p.x, y: p.y } : undefined;
  }

  /** Coalesces renders to one per animation frame. */
  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(): void {
    this.renderLinks();
    clear(this.deviceLayer);
    for (const [id, p] of this.topo.placed) this.deviceLayer.appendChild(this.drawDevice(id, p));
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

  // ------------------------------------------------------------ drawing

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
        this.topo.net.disconnect(link.id);
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
    const name = d.kind === 'pc' || d.kind === 'server' ? '' : d.hostname;
    const g = svg('g', {
      class: `device device-${d.kind}${this.selected === id ? ' is-selected' : ''}${this.pendingEnd?.device === id ? ' is-pending' : ''}`,
      transform: `translate(${p.x} ${p.y})`, tabindex: '0', 'data-id': id, role: 'button', 'aria-label': `${p.label} (${MODEL_LABEL[d.kind]})`,
    });
    g.appendChild(svg('rect', { class: 'device-halo', x: -ICON_W / 2 - 8, y: -ICON_H / 2 - 8, width: ICON_W + 16, height: ICON_H + 16, rx: 10 }));
    const icon = staticSvg(ICONS[d.kind]);
    icon.setAttribute('x', String(-ICON_W / 2));
    icon.setAttribute('y', String(-ICON_H / 2));
    g.appendChild(icon);
    g.appendChild(svg('text', { class: 'device-model', x: 0, y: -ICON_H / 2 - 12 }, MODEL_LABEL[d.kind]));
    g.appendChild(svg('text', { class: 'device-label', x: 0, y: ICON_H / 2 + 18 }, p.label));
    if (name && name !== 'Router' && name !== 'Switch') g.appendChild(svg('text', { class: 'device-host', x: 0, y: ICON_H / 2 + 33 }, name));
    g.addEventListener('pointerdown', (e) => this.onDevicePointer(e, id, g));
    g.addEventListener('dblclick', () => this.events.open(id));
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

  private onBackground(e: PointerEvent): void {
    this.hideMenu();
    if (this.tool.kind === 'place') {
      const { x, y } = this.toWorld(e);
      this.topo.add(this.tool.device, clamp(x, 40, WORLD_W - 40), clamp(y, 40, WORLD_H - 40));
      this.setTool({ kind: 'select' });
      this.events.changed();
      return;
    }
    this.pendingEnd = null;
    if (this.selected !== null) {
      this.selected = null;
      this.markSelection();
    }
  }

  private onDevicePointer(e: PointerEvent, id: string, g: SVGGElement): void {
    e.stopPropagation();
    this.hideMenu();
    if (this.tool.kind === 'delete') {
      this.topo.remove(id);
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

  private dragDevice(e: PointerEvent, id: string, g: SVGGElement): void {
    const placed = this.topo.get(id);
    if (!placed) return;
    const start = this.toWorld(e);
    const origin = { x: placed.x, y: placed.y };
    let moved = false;
    g.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const p = this.toWorld(ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      placed.x = clamp(origin.x + p.x - start.x, 40, WORLD_W - 40);
      placed.y = clamp(origin.y + p.y - start.y, 40, WORLD_H - 40);
      g.setAttribute('transform', `translate(${placed.x} ${placed.y})`);
      this.renderLinks();
    };
    const up = (): void => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      if (moved) this.events.changed();
      else this.markSelection();
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
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
    const title = this.pendingEnd ? `Conectar a ${placed.label}` : `Desde ${placed.label}`;
    this.menu.replaceChildren(el('p', { class: 'port-menu-title' }, title), ...items);
    const host = this.root.getBoundingClientRect();
    this.menu.style.left = `${e.clientX - host.left + this.root.scrollLeft + 8}px`;
    this.menu.style.top = `${e.clientY - host.top + this.root.scrollTop + 8}px`;
    this.menu.hidden = false;
    (items.find((b) => !b.disabled) ?? items[0])?.focus();
  }

  private pickPort(ep: Endpoint): void {
    this.hideMenu();
    if (!this.pendingEnd) {
      this.pendingEnd = ep;
      this.events.hint(`Cable desde ${this.topo.get(ep.device)?.label} ${ep.port}: elige el otro extremo.`);
      this.render();
      return;
    }
    try {
      this.topo.connect(this.pendingEnd, ep);
      this.events.hint(HINTS.cable);
    } catch (err) {
      this.events.hint(`No se pudo conectar: ${err instanceof Error ? err.message : 'error desconocido'}.`);
    }
    this.pendingEnd = null;
    this.events.changed();
  }

  private hideMenu(): void {
    this.menu.hidden = true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      this.setTool({ kind: 'select' });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      const id = this.selected;
      if (this.topo.get(id)) {
        this.topo.remove(id);
        this.events.removed(id);
      } else {
        this.topo.net.disconnect(id);
      }
      this.selected = null;
      this.events.changed();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function along(from: { x: number; y: number }, to: { x: number; y: number }, dist: number): { x: number; y: number } {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const d = Math.min(dist, len / 2 - 4);
  return { x: from.x + ((to.x - from.x) * d) / len, y: from.y + ((to.y - from.y) * d) / len };
}

/** Offset vector perpendicular to the cable, always pointing right (or up for horizontal cables). */
function perpendicular(from: { x: number; y: number }, to: { x: number; y: number }, dist: number): { x: number; y: number } {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  let nx = -(to.y - from.y) / len;
  let ny = (to.x - from.x) / len;
  if (nx < 0 || (nx === 0 && ny > 0)) { nx = -nx; ny = -ny; }
  return { x: nx * dist, y: ny * dist };
}

/** Link light: a small triangle pointing along the cable, like Packet Tracer. */
function triangle(c: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): string {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const s = 6;
  const pts = [0, 2.1, 4.2].map((o) => [c.x + Math.cos(ang + o) * s, c.y + Math.sin(ang + o) * s]);
  return `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join(' L')} Z`;
}
