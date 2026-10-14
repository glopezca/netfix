/** Bottom palette: devices to place, editing tools, zoom controls and the hint line. */
import { el, staticSvg } from './dom.ts';
import type { Tool } from './canvas.ts';
import { ICONS, modelLabel } from './icons.ts';
import type { DeviceKind } from '../net/topology.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';

export interface PaletteActions {
  selectTool(tool: Tool, key: string): void;
  zoom(action: 'in' | 'out' | 'fit'): void;
}

export const PLACEABLE: readonly (readonly [DeviceKind, MessageKey])[] = [
  ['router', 'kind.router'], ['switch', 'kind.switch'], ['pc', 'kind.pc'], ['server', 'kind.server'], ['linuxrouter', 'kind.linuxrouter'], ['cloud', 'kind.cloud'],
];

export function palette(actions: PaletteActions, buttons: Map<string, HTMLButtonElement>, hintEl: HTMLElement): HTMLElement {
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
  return el('footer', { class: 'palette' },
    el('div', { class: 'pal-group pal-devices', role: 'group', 'aria-label': t('pal.devices') }, ...PLACEABLE.map(([k, name]) => deviceBtn(k, t(name)))),
    el('div', { class: 'pal-group', role: 'group', 'aria-label': t('pal.tools') },
      toolBtn('select', t('pal.select'), { kind: 'select' }, '↖'),
      toolBtn('cable', t('pal.cable'), { kind: 'cable' }, '⌇'),
      toolBtn('delete', t('pal.delete'), { kind: 'delete' }, '✕')),
    el('div', { class: 'zoom-group', role: 'group' }, zoomBtn('out', '−', t('pal.zoomOut')), zoomBtn('fit', '⤢', t('pal.zoomFit')), zoomBtn('in', '+', t('pal.zoomIn'))),
    hintEl);
}
