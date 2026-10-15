/**
 * Drawing bar: shapes (rectangle, ellipse, line, freehand, text), basic colours, an RGB picker, fill and stroke
 * width, and buttons to delete the selected drawing or all of them. It floats over the workspace and opens from the
 * palette's «Dibujo» button.
 */
import { el } from './dom.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { BASIC_COLORS, normaliseColor } from '../net/annotations.ts';
import type { AnnotationStyle, ShapeKind } from '../net/annotations.ts';

const WIDTHS: readonly number[] = [1, 2, 4, 6];

/** Current drawing style; the canvas also applies a change to the selected drawing. */
export class DrawState {
  color = BASIC_COLORS[5] ?? '#1976d2';
  fill = true;
  width = 2;
  /** Id of the selected drawing (set by the drawing layer). */
  selected: string | null = null;
  private readonly listeners = new Set<(s: AnnotationStyle) => void>();
  private readonly selectListeners = new Set<(id: string | null) => void>();

  style(): AnnotationStyle {
    return { color: this.color, fill: this.fill, width: this.width };
  }

  set(change: Partial<AnnotationStyle>): void {
    if (change.color !== undefined) this.color = normaliseColor(change.color) ?? this.color;
    if (change.fill !== undefined) this.fill = change.fill;
    if (change.width !== undefined) this.width = change.width;
    for (const f of this.listeners) f(this.style());
  }

  onChange(f: (s: AnnotationStyle) => void): void {
    this.listeners.add(f);
  }

  select(id: string | null): void {
    if (id === this.selected) return;
    this.selected = id;
    for (const f of this.selectListeners) f(id);
  }

  onSelect(f: (id: string | null) => void): void {
    this.selectListeners.add(f);
  }
}

export const SHAPES: readonly (readonly [ShapeKind, MessageKey, string])[] = [
  ['rect', 'draw.rect', '▭'], ['ellipse', 'draw.ellipse', '◯'], ['line', 'draw.line', '╱'], ['free', 'draw.free', '✎'], ['text', 'draw.text', 'T'],
];

export interface DrawBarActions {
  pick(shape: ShapeKind): void;
  deleteSelected(): void;
  /** Asks first; nothing happens when the workspace has no drawings. */
  deleteAll(): void;
}

/** «Borrar dibujo» (enabled while a drawing is selected) and «Borrar todos». */
function deleteButtons(state: DrawState, actions: DrawBarActions): HTMLElement {
  const one = el('button', { type: 'button', class: 'btn btn-small draw-delete', disabled: true, title: t('draw.deleteHint') }, t('draw.delete'));
  one.addEventListener('click', () => actions.deleteSelected());
  state.onSelect((id) => { one.disabled = id === null; });
  const all = el('button', { type: 'button', class: 'btn btn-small danger draw-delete-all' }, t('draw.deleteAll'));
  all.addEventListener('click', () => actions.deleteAll());
  return el('div', { class: 'draw-group' }, one, all);
}

function swatch(state: DrawState, color: string, picker: HTMLInputElement): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'draw-swatch', 'data-color': color, 'aria-label': t('draw.color', { color }), title: color });
  b.style.backgroundColor = color;
  b.addEventListener('click', () => { picker.value = color; state.set({ color }); });
  return b;
}

/** The bar; `buttons` receives the shape buttons (keys draw-rect…) so the palette can mark the active tool. */
export function drawBar(state: DrawState, actions: DrawBarActions, buttons: Map<string, HTMLButtonElement>): HTMLElement {
  const shapes = SHAPES.map(([shape, key, glyph]) => {
    const b = el('button', { type: 'button', class: 'draw-tool', 'aria-pressed': 'false', 'aria-label': t(key), title: t(key) }, glyph);
    b.addEventListener('click', () => actions.pick(shape));
    buttons.set(`draw-${shape}`, b);
    return b;
  });
  const picker = el('input', { type: 'color', class: 'draw-picker', value: state.color, 'aria-label': t('draw.rgb'), title: t('draw.rgb') });
  picker.addEventListener('input', () => state.set({ color: picker.value }));
  const fill = el('input', { type: 'checkbox', checked: state.fill });
  fill.addEventListener('change', () => state.set({ fill: fill.checked }));
  const width = el('select', { class: 'select draw-width', 'aria-label': t('draw.width') }, ...WIDTHS.map((w) => el('option', { value: String(w) }, `${w} px`)));
  width.value = String(state.width);
  width.addEventListener('change', () => state.set({ width: Number(width.value) }));
  const current = el('span', { class: 'draw-current', 'aria-hidden': 'true' });
  const paint = (): void => { current.style.backgroundColor = state.color; picker.value = state.color; };
  state.onChange(paint);
  paint();
  return el('div', { class: 'draw-bar', role: 'toolbar', 'aria-label': t('draw.title'), hidden: true },
    el('div', { class: 'draw-group' }, ...shapes),
    el('div', { class: 'draw-group draw-colors' }, current, ...BASIC_COLORS.map((c) => swatch(state, c, picker)), picker),
    el('label', { class: 'check draw-fill' }, fill, ` ${t('draw.fill')}`),
    width,
    deleteButtons(state, actions));
}
