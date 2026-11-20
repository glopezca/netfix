/**
 * The context menu of a device on the workspace (extension SDK, PUBLIC-API.md §3.4b): right click (released without
 * moving: a right drag still pans), the ContextMenu key or Shift+F10 on a focused device, and a long press on touch
 * screens. Abrir first, then the entries extensions register for that device, then Eliminar when the lab is editable.
 */
import type { Placed } from '../net/topology.ts';
import type { Locale } from '../i18n/locale.ts';
import { getLocale } from '../i18n/locale.ts';
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { placeInside } from './viewport-math.ts';

export interface DeviceAction {
  readonly id: string;
  readonly label: { readonly es: string; readonly en: string };
  readonly applies: (placed: Placed) => boolean;
  readonly run: (placed: Placed) => void;
}

export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  /** Absent for the core's entries (the canvas runs them). */
  readonly run?: (placed: Placed) => void;
}

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const CORE = new Set(['open', 'delete']);
const actions = new Map<string, DeviceAction>();

export function registerDeviceAction(a: DeviceAction): void {
  if (!ID_RE.test(a.id)) throw new Error(`netfix: acción de equipo con id no válido «${a.id}»`);
  if (actions.has(a.id) || CORE.has(a.id)) throw new Error(`netfix: la acción de equipo «${a.id}» ya existe`);
  if (!a.label.es.trim() || !a.label.en.trim()) throw new Error(`netfix: la acción «${a.id}» necesita su texto en español y en inglés`);
  actions.set(a.id, a);
}

/** What the menu of `placed` lists, in order. */
export function menuEntries(placed: Placed, editable: boolean, locale: Locale = getLocale()): MenuEntry[] {
  const ext = [...actions.values()].filter((a) => a.applies(placed)).map((a) => ({ id: a.id, label: locale === 'en-GB' ? a.label.en : a.label.es, run: a.run }));
  return [{ id: 'open', label: t('canvas.menu.open', undefined, locale) }, ...ext, ...(editable ? [{ id: 'delete', label: t('canvas.menu.delete', undefined, locale) }] : [])];
}

export interface DeviceMenuHost {
  placed(id: string): Placed | undefined;
  editable(): boolean;
  open(id: string): void;
  remove(id: string): void;
}

export interface DeviceMenu {
  /** Shows the menu of `id` at a point of the page (default: beside the device). */
  show(id: string, at?: { readonly clientX: number; readonly clientY: number }): void;
  hide(): void;
}

const MOVE_PX = 6;

function deviceOf(target: EventTarget | null): SVGGElement | null {
  return target instanceof Element ? target.closest<SVGGElement>('g[data-id]') : null;
}

/** Binds the menu to the workspace's SVG (one listener for every device) and returns it. */
export function bindDeviceMenu(svgEl: SVGSVGElement, root: HTMLElement, host: DeviceMenuHost): DeviceMenu {
  const box = el('div', { class: 'port-menu device-menu', role: 'menu', hidden: true });
  root.append(box);
  let owner: SVGGElement | null = null;
  const hide = (): void => { box.hidden = true; owner = null; };
  const run = (id: string, e: MenuEntry): void => {
    const placed = host.placed(id);
    hide();
    if (!placed) return;
    if (e.id === 'open') host.open(id);
    else if (e.id === 'delete') host.remove(id);
    else e.run?.(placed);
  };
  const show = (id: string, at?: { readonly clientX: number; readonly clientY: number }): void => {
    const placed = host.placed(id);
    if (!placed) return;
    const items = menuEntries(placed, host.editable()).map((e) => {
      const b = el('button', { type: 'button', role: 'menuitem', class: 'port-item', 'data-action': e.id }, e.label);
      b.addEventListener('click', () => run(id, e));
      return b;
    });
    owner = svgEl.querySelector<SVGGElement>(`g[data-id="${CSS.escape(id)}"]`);
    box.setAttribute('aria-label', t('canvas.menu.label', { name: placed.label }));
    box.replaceChildren(...items);
    box.hidden = false;
    const r = (owner ?? svgEl).getBoundingClientRect();
    const point = at ?? { clientX: r.right, clientY: r.top };
    const hostBox = root.getBoundingClientRect();
    const pos = placeInside(point.clientX - hostBox.left + 4, point.clientY - hostBox.top + 4, box.offsetWidth, box.offsetHeight, root.clientWidth, root.clientHeight);
    box.style.left = `${pos.x + root.scrollLeft}px`;
    box.style.top = `${pos.y + root.scrollTop}px`;
    items[0]?.focus();
  };
  box.addEventListener('keydown', (e) => {
    const items = [...box.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { const back = owner; hide(); back?.focus(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      e.preventDefault();
    }
  });
  // Right button: on release without moving (a right drag pans; Linux fires contextmenu already on press).
  let down: { readonly id: string; readonly x: number; readonly y: number } | null = null;
  svgEl.addEventListener('contextmenu', (e) => e.preventDefault());
  svgEl.addEventListener('pointerdown', (e) => {
    const g = deviceOf(e.target);
    down = e.button === 2 && g ? { id: g.getAttribute('data-id') ?? '', x: e.clientX, y: e.clientY } : null;
  }, { capture: true });
  svgEl.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (e.button === 2 && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < MOVE_PX) show(d.id, e);
  });
  svgEl.addEventListener('keydown', (e) => {
    const g = deviceOf(e.target);
    if (!g || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    e.preventDefault();
    show(g.getAttribute('data-id') ?? '');
  });
  document.addEventListener('pointerdown', (e) => { if (!box.hidden && !box.contains(e.target as Node)) hide(); }, { capture: true });
  return { show, hide };
}
