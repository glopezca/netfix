/** Bottom palette: devices to place, editing tools, zoom controls and the hint line. */
import { el, staticSvg } from './dom.ts';
import type { Tool } from './canvas.ts';
import { ICONS, modelLabel } from './icons.ts';
import type { DeviceKind } from '../net/topology.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { NO_RESTRICTIONS, allowsDevice } from '../classroom/restrictions.ts';
import type { Restrictions } from '../classroom/restrictions.ts';

export interface PaletteActions {
  selectTool(tool: Tool, key: string): void;
  zoom(action: 'in' | 'out' | 'fit'): void;
  /** Shows or hides the drawing bar; returns whether it is now open. */
  toggleDraw(): boolean;
  /** Undo (false) or redo (true) the last workspace edit. */
  undo(redo: boolean): void;
}

export const PLACEABLE: readonly (readonly [DeviceKind, MessageKey])[] = [
  ['pc', 'kind.pc'], ['server', 'kind.server'], ['switch', 'kind.switch'], ['router', 'kind.router'], ['linuxrouter', 'kind.linuxrouter'], ['cloud', 'kind.cloud'],
];

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

/** The palette; classroom restrictions leave out devices, the editing tools (topology locked) and drawing. */
export function palette(actions: PaletteActions, buttons: Map<string, HTMLButtonElement>, hintEl: HTMLElement, policy: Restrictions = NO_RESTRICTIONS): HTMLElement {
  const deviceBtn = (kind: DeviceKind, name: string): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: 'pal-item', 'aria-pressed': 'false' },
      staticSvg(ICONS[kind]), el('span', { class: 'pal-name' }, name), el('span', { class: 'pal-model' }, modelLabel(kind)));
    b.addEventListener('click', () => actions.selectTool({ kind: 'place', device: kind }, `place-${kind}`));
    buttons.set(`place-${kind}`, b);
    return b;
  };
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
  const edit = policy.editTopology;
  const devices = edit ? PLACEABLE.filter(([k]) => allowsDevice(policy, k)) : [];
  return el('footer', { class: 'palette' },
    ...(devices.length ? [el('div', { class: 'pal-group pal-devices', role: 'group', 'aria-label': t('pal.devices') }, ...devices.map(([k, name]) => deviceBtn(k, t(name))))] : []),
    el('div', { class: 'pal-group', role: 'group', 'aria-label': t('pal.tools') },
      toolBtn('select', t('pal.select'), { kind: 'select' }, '↖'),
      ...(edit ? [toolBtn('cable', t('pal.cable'), { kind: 'cable' }, '⌇'), toolBtn('delete', t('pal.delete'), { kind: 'delete' }, '✕')] : []),
      ...(policy.drawing ? [drawToggle(actions)] : [])),
    el('div', { class: 'zoom-group', role: 'group', 'aria-label': t('undo.group') }, undoBtn(false, '↶', t('undo.undo')), undoBtn(true, '↷', t('undo.redo'))),
    el('div', { class: 'zoom-group', role: 'group' }, zoomBtn('out', '−', t('pal.zoomOut')), zoomBtn('fit', '⤢', t('pal.zoomFit')), zoomBtn('in', '+', t('pal.zoomIn'))),
    hintEl);
}
