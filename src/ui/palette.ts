/**
 * Bottom palette: devices to place, editing tools, zoom controls and the hint line. With the bar in a host's menu, the
 * palette is a sidebar of devices and tools, and the actions (undo/redo, clipboard, zoom) go in the host's `actions`.
 */
import { el, staticSvg } from './dom.ts';
import type { Tool } from './canvas.ts';
import { ICONS, modelLabel } from './icons.ts';
import type { DeviceKind } from '../net/topology.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { NO_RESTRICTIONS, allowsDevice } from '../classroom/restrictions.ts';
import { devicePiles } from './preferences.ts';
import type { PcSystem } from '../net/device-apps.ts';
import type { Restrictions } from '../classroom/restrictions.ts';

export interface PaletteActions {
  selectTool(tool: Tool, key: string): void;
  zoom(action: 'in' | 'out' | 'fit'): void;
  /** Shows or hides the drawing bar; returns whether it is now open. */
  toggleDraw(): boolean;
  /** Undo (false) or redo (true) the last workspace edit. */
  undo(redo: boolean): void;
  /** Copy, paste or duplicate the selection of the workspace. */
  clip(action: ClipAction): void;
}

export type ClipAction = 'copy' | 'paste' | 'duplicate' | 'delete';

export const PLACEABLE: readonly (readonly [DeviceKind, MessageKey])[] = [
  ['pc', 'kind.pc'], ['server', 'kind.server'], ['switch', 'kind.switch'], ['router', 'kind.router'], ['linuxrouter', 'kind.linuxrouter'], ['cloud', 'kind.cloud'], ['classlan', 'kind.classlan'],
];

/** The Classroom LAN is placeable only when the host page (Netfix Classroom) gives the link to the class. */
let classLanOffered = false;
export function offerClassLan(on: boolean): void { classLanOffered = on; }
const offered = (kind: DeviceKind): boolean => kind !== 'classlan' || classLanOffered;

/** A choice of a pile: a device kind and, for a PC, its system. */
interface Variant { readonly kind: DeviceKind; readonly system?: PcSystem; readonly name: string; readonly model: string }

/** The piles (setting «Agrupar equipos parecidos»): one button per family, its variants in a small menu. */
function piles(): readonly (readonly [MessageKey, readonly Variant[]])[] {
  const pc = (system: PcSystem): Variant => ({ kind: 'pc', system, name: `${t('kind.pc')} ${t(`os.${system}`)}`, model: system === 'both' ? `${t('os.windows')} + ${t('os.linux')}` : t(`os.${system}`) });
  return [
    ['kind.pc', [pc('windows'), pc('linux'), pc('both')]],
    ['kind.server', [{ kind: 'server', name: t('kind.server'), model: modelLabel('server') }]],
    ['kind.switch', [{ kind: 'switch', name: t('kind.switch'), model: modelLabel('switch') }]],
    ['pal.routers', [{ kind: 'router', name: t('kind.router'), model: modelLabel('router') }, { kind: 'linuxrouter', name: t('kind.linuxrouter'), model: modelLabel('linuxrouter') }]],
    ['kind.cloud', [{ kind: 'cloud', name: t('kind.cloud'), model: modelLabel('cloud') }]],
    ['kind.classlan', [{ kind: 'classlan', name: t('kind.classlan'), model: modelLabel('classlan') }]],
  ];
}

const variantKey = (v: Variant): string => (v.system ? `place-${v.kind}-${v.system}` : `place-${v.kind}`);

function variantBtn(actions: PaletteActions, buttons: Map<string, HTMLButtonElement>, v: Variant, cls: string): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls, 'aria-pressed': 'false' }, staticSvg(ICONS[v.kind]), el('span', { class: 'pal-name' }, v.name), el('span', { class: 'pal-model' }, v.model));
  b.addEventListener('click', () => actions.selectTool({ kind: 'place', device: v.kind, ...(v.system ? { system: v.system } : {}) }, variantKey(v)));
  buttons.set(variantKey(v), b);
  return b;
}

/** A family with several variants: its button opens the menu of them (Esc or leaving it closes it). */
function pileBtn(actions: PaletteActions, buttons: Map<string, HTMLButtonElement>, name: string, variants: readonly Variant[]): HTMLElement {
  const first = variants[0]!;
  const menu = el('div', { class: 'pal-pile-menu', role: 'group', 'aria-label': name, hidden: true });
  const main = el('button', { type: 'button', class: 'pal-item pal-pile-btn', 'aria-expanded': 'false', title: t('pal.pileHint') },
    staticSvg(ICONS[first.kind]), el('span', { class: 'pal-name' }, name), el('span', { class: 'pal-model' }, t('pal.pileCount', { n: String(variants.length) })));
  const pile = el('div', { class: 'pal-pile' }, main, menu);
  const show = (open: boolean): void => { menu.hidden = !open; main.setAttribute('aria-expanded', String(open)); };
  main.addEventListener('click', () => show(menu.hidden));
  menu.append(...variants.map((v) => {
    const b = variantBtn(actions, buttons, v, 'pal-item pal-variant');
    b.addEventListener('click', () => { show(false); main.focus(); });
    return b;
  }));
  pile.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); show(false); main.focus(); } });
  pile.addEventListener('focusout', (e) => { if (!(e.relatedTarget instanceof Node && pile.contains(e.relatedTarget))) show(false); });
  return pile;
}

/** The palette's devices: one button each, or the piles when the setting is on; what restrictions allow only. */
export function deviceGroup(actions: PaletteActions, buttons: Map<string, HTMLButtonElement>, policy: Restrictions = NO_RESTRICTIONS): HTMLElement | null {
  if (!policy.editTopology) return null;
  const items = devicePiles()
    ? piles().map(([name, all]) => [t(name), all.filter((v) => offered(v.kind) && allowsDevice(policy, v.kind))] as const).filter(([, vs]) => vs.length > 0)
      .map(([name, vs]) => (vs.length === 1 ? variantBtn(actions, buttons, vs[0]!, 'pal-item') : pileBtn(actions, buttons, name, vs)))
    : PLACEABLE.filter(([k]) => offered(k) && allowsDevice(policy, k)).map(([k, name]) => variantBtn(actions, buttons, { kind: k, name: t(name), model: modelLabel(k) }, 'pal-item'));
  return items.length ? el('div', { class: 'pal-group pal-devices', role: 'group', 'aria-label': t('pal.devices') }, ...items) : null;
}

/** «Dibujo»: opens the bar with shapes, colours and labels (it is not a tool by itself). */
function drawToggle(actions: PaletteActions): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'pal-item pal-tool pal-draw', 'aria-pressed': 'false', 'aria-expanded': 'false', title: t('draw.openHint') },
    el('span', { class: 'pal-glyph', 'aria-hidden': 'true' }, '✎'), el('span', { class: 'pal-name' }, t('draw.open')));
  b.addEventListener('click', () => {
    const open = actions.toggleDraw();
    b.setAttribute('aria-pressed', String(open));
    b.setAttribute('aria-expanded', String(open));
  });
  return b;
}

/**
 * The palette; classroom restrictions leave out devices, the editing tools (topology locked) and drawing. `actionsBox`
 * (hosted): the element that takes the action groups instead of the palette, and no hint line in it.
 */
export function palette(actions: PaletteActions, buttons: Map<string, HTMLButtonElement>, hintEl: HTMLElement, policy: Restrictions = NO_RESTRICTIONS, actionsBox: HTMLElement | null = null): HTMLElement {
  const toolBtn = (key: string, name: string, tool: Tool, glyph: string): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: `pal-item pal-tool pal-${key}`, 'aria-pressed': 'false' },
      el('span', { class: 'pal-glyph', 'aria-hidden': 'true' }, glyph), el('span', { class: 'pal-name' }, name));
    b.addEventListener('click', () => actions.selectTool(tool, key));
    buttons.set(key, b);
    return b;
  };
  const zoomBtn = (action: 'in' | 'out' | 'fit', glyph: string, label: string): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: 'zoom-btn', 'aria-label': label, title: label }, glyph);
    b.addEventListener('click', () => actions.zoom(action));
    return b;
  };
  const undoBtn = (redo: boolean, glyph: string, label: string): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: `zoom-btn ${redo ? 'redo-btn' : 'undo-btn'}`, 'aria-label': label, title: label, disabled: true }, glyph);
    b.addEventListener('click', () => actions.undo(redo));
    return b;
  };
  const clipBtn = (action: ClipAction, glyph: string): HTMLButtonElement => {
    const label = t(`clip.${action}`);
    const b = el('button', { type: 'button', class: `zoom-btn clip-btn clip-${action}`, 'aria-label': label, title: label }, glyph);
    b.addEventListener('click', () => actions.clip(action));
    return b;
  };
  const edit = policy.editTopology;
  const groups = [
    el('div', { class: 'zoom-group', role: 'group', 'aria-label': t('undo.group') }, undoBtn(false, '↶', t('undo.undo')), undoBtn(true, '↷', t('undo.redo'))),
    ...(edit ? [el('div', { class: 'zoom-group', role: 'group', 'aria-label': t('clip.group') }, clipBtn('copy', '⧉'), clipBtn('paste', '⎘'), clipBtn('duplicate', '⊕'), clipBtn('delete', '🗑︎'))] : []),
    el('div', { class: 'zoom-group', role: 'group', 'aria-label': t('pal.zoomGroup') }, zoomBtn('out', '−', t('pal.zoomOut')), zoomBtn('fit', '⤢', t('pal.zoomFit')), zoomBtn('in', '+', t('pal.zoomIn'))),
  ];
  actionsBox?.replaceChildren(...groups);
  return el(actionsBox ? 'nav' : 'footer', { class: 'palette', 'aria-label': t('pal.label') },
    deviceGroup(actions, buttons, policy),
    el('div', { class: 'pal-group', role: 'group', 'aria-label': t('pal.tools') },
      toolBtn('select', t('pal.select'), { kind: 'select' }, '↖'),
      ...(edit ? [toolBtn('cable', t('pal.cable'), { kind: 'cable' }, '⌇'), toolBtn('delete', t('pal.delete'), { kind: 'delete' }, '✕')] : []),
      ...(policy.drawing ? [drawToggle(actions)] : [])),
    ...(actionsBox ? [] : [...groups, hintEl]));
}
