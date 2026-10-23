/** Small form and table builders for the device windows. All text goes through textContent. */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

export function input(attrs: Record<string, string> = {}): HTMLInputElement {
  return el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...attrs });
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || nextId('f');
  control.id = id;
  return el('label', { class: 'field', for: id }, el('span', { class: 'field-label' }, label), control, hint ? el('span', { class: 'field-hint' }, hint) : null);
}

export function select(options: readonly (readonly [string, string])[], value?: string): HTMLSelectElement {
  const s = el('select', { class: 'select' }, ...options.map(([v, label]) => el('option', { value: v }, label)));
  if (value !== undefined) s.value = value;
  return s;
}

export function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

/** On/Off switch like Packet Tracer's service panels. */
export function onOff(label: string, on: boolean, change: (on: boolean) => void): HTMLElement {
  const box = el('input', { type: 'checkbox', role: 'switch', checked: on });
  box.addEventListener('change', () => change(box.checked));
  return el('label', { class: 'switch-row' }, box, el('span', { class: 'switch-label' }, label), el('span', { class: 'switch-state' }, on ? t('common.on') : t('common.off')));
}

export function message(): { el: HTMLElement; ok(text: string): void; error(text: string): void; clear(): void } {
  const p = el('p', { class: 'form-msg', role: 'status' });
  return {
    el: p,
    ok: (t) => { p.dataset.kind = 'ok'; p.textContent = t; },
    error: (t) => { p.dataset.kind = 'error'; p.textContent = t; },
    clear: () => { p.textContent = ''; delete p.dataset.kind; },
  };
}

export interface Column<T> {
  readonly label: string;
  readonly value: (row: T) => string;
  readonly mono?: boolean;
}

/** Table with optional row selection, per-row action buttons and a delete button. */
export function table<T>(rows: readonly T[], cols: readonly Column<T>[], opts: { empty: string; onSelect?: (row: T) => void; onDelete?: (row: T) => void; selected?: (row: T) => boolean; actions?: (row: T) => HTMLButtonElement[] }): HTMLElement {
  if (rows.length === 0) return el('p', { class: 'muted' }, opts.empty);
  const hasActions = Boolean(opts.onDelete || opts.actions);
  const head = el('tr', {}, ...cols.map((c) => el('th', {}, c.label)), hasActions ? el('th', {}, '') : null);
  const body = rows.map((r) => {
    const tr = el('tr', { class: opts.selected?.(r) ? 'is-current' : '' }, ...cols.map((c) => el('td', { class: c.mono ? 'mono' : '' }, c.value(r))));
    if (opts.onSelect) {
      tr.tabIndex = 0;
      tr.addEventListener('click', () => opts.onSelect?.(r));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onSelect?.(r); });
    }
    if (hasActions) {
      const buttons = [...(opts.actions?.(r) ?? []), ...(opts.onDelete ? [button(t('common.delete'), () => opts.onDelete?.(r), 'btn btn-quiet btn-small')] : [])];
      buttons.forEach((b) => b.addEventListener('click', (e) => e.stopPropagation()));
      tr.appendChild(el('td', { class: 'row-actions' }, ...buttons));
    }
    return tr;
  });
  return el('div', { class: 'table-wrap' }, el('table', { class: 'grid-table' }, el('thead', {}, head), el('tbody', {}, ...body)));
}

export function copyRow(label: string, value: string, help: string): HTMLElement {
  const btn = button(t('common.copy'), () => {
    void navigator.clipboard?.writeText(value).then(() => { btn.textContent = t('common.copied'); }, () => { btn.textContent = t('common.unavailable'); });
  }, 'btn btn-quiet');
  btn.setAttribute('aria-label', t('common.copyX', { label }));
  return el('div', { class: 'id-row' },
    el('div', {}, el('span', { class: 'field-label' }, label), el('code', { class: 'id-value' }, value), el('p', { class: 'id-help' }, help)), btn);
}

/** Vertical sub-navigation used inside a window tab (Servicios → DHCP / DNS / …). */
/** Side navigation of a pane; items with `keep` are drawn once and kept (an open terminal survives a visit to another item). */
export function subnav(items: readonly { id: string; label: string; render: () => HTMLElement; keep?: boolean }[]): HTMLElement {
  const content = el('div', { class: 'subnav-content' });
  const kept = new Map<string, HTMLElement>();
  const buttons = items.map((it) => {
    const b = el('button', { type: 'button', class: 'subnav-item', 'aria-pressed': 'false' }, it.label);
    b.addEventListener('click', () => show(it.id));
    return b;
  });
  const show = (id: string): void => {
    items.forEach((it, i) => buttons[i]?.setAttribute('aria-pressed', String(it.id === id)));
    const item = items.find((it) => it.id === id);
    if (!item) return void content.replaceChildren(el('p', {}, ''));
    const view = kept.get(item.id) ?? item.render();
    if (item.keep) kept.set(item.id, view);
    content.replaceChildren(view);
  };
  if (items[0]) show(items[0].id);
  return el('div', { class: 'subnav' }, el('nav', { class: 'subnav-list', 'aria-label': t('win.services') }, ...buttons), content);
}

/**
 * Applies a field as soon as it changes (Enter, or leaving it). The work runs once the browser has moved the focus,
 * so a panel that redraws itself keeps the control the user went to.
 */
export function onCommit(control: HTMLInputElement | HTMLSelectElement, apply: () => void): void {
  watchPointer();
  control.addEventListener('change', () => {
    // A click elsewhere ended the edit: redrawing between its pointerdown and pointerup would swallow it.
    if (!pointerDown) { setTimeout(apply, 0); return; }
    let done = false;
    const later = (): void => { if (!done) { done = true; setTimeout(apply, 0); } };
    window.addEventListener('pointerup', later, { once: true });
    window.addEventListener('pointercancel', later, { once: true });
  });
}

let pointerDown = false;
let watching = false;

function watchPointer(): void {
  if (watching) return;
  watching = true;
  window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  for (const end of ['pointerup', 'pointercancel'] as const) window.addEventListener(end, () => { pointerDown = false; }, true);
}
