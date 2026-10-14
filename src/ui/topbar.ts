/** Top bar: brand, views, file actions, labs, clock, mode and language. Folds into a menu on phones. */
import { brandImage } from './brand.ts';
import { el } from './dom.ts';
import { EXAMPLES } from '../net/examples.ts';
import { labText } from './lab-text.ts';
import { t } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { getLocale, LOCALES, LOCALE_NAMES, LOCALE_SHORT, isLocale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';

export type View = 'net' | 'docs' | 'donate' | 'about';
export type Mode = 'realtime' | 'simulation';

export interface TopbarActions {
  newWorkspace(): void;
  openFile(): void;
  save(): void;
  loadExample(id: string): void;
  advance(ms: number): void;
  setMode(mode: Mode): void;
  showView(view: View): void;
  setLocale(locale: Locale): void;
}

const MINUTE = 60_000;
const VIEWS: readonly (readonly [View, MessageKey])[] = [['net', 'view.net'], ['docs', 'view.docs'], ['donate', 'view.donate'], ['about', 'view.about']];

function button(label: string, fn: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'btn', ...attrs }, label);
  b.addEventListener('click', fn);
  return b;
}

/** A <select> that runs `fn` with the chosen value and goes back to its placeholder. */
function actionSelect(label: string, placeholder: string, options: readonly (readonly [string, string])[], fn: (v: string) => void): HTMLSelectElement {
  const s = el('select', { class: 'select', 'aria-label': label }, el('option', { value: '' }, placeholder), ...options.map(([v, l]) => el('option', { value: v }, l)));
  s.addEventListener('change', () => {
    const v = s.value;
    s.value = '';
    if (v) fn(v);
  });
  return s;
}

function segmented(label: string, items: readonly (readonly [string, string])[], current: string, fn: (v: string) => void, attr = 'data-value'): HTMLElement {
  const buttons = items.map(([v, text]) => {
    const b = el('button', { type: 'button', class: 'seg', 'aria-pressed': String(v === current), [attr]: v }, text);
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      fn(v);
    });
    return b;
  });
  return el('div', { class: 'segmented', role: 'group', 'aria-label': label }, ...buttons);
}

function languageSelect(actions: TopbarActions): HTMLSelectElement {
  const s = el('select', { class: 'select select-lang', 'aria-label': t('top.language'), title: t('top.language') },
    ...LOCALES.map((l) => el('option', { value: l, selected: l === getLocale(), lang: l }, `${LOCALE_SHORT[l]} · ${LOCALE_NAMES[l]}`)));
  s.addEventListener('change', () => { if (isLocale(s.value)) actions.setLocale(s.value); });
  return s;
}

export function topbar(actions: TopbarActions, clockEl: HTMLElement, mode: Mode, view: View = 'net'): HTMLElement {
  const labs = actionSelect(t('top.examplesLabel'), t('top.examples'), EXAMPLES.map((e) => [e.id, labText(e).title] as const), (id) => actions.loadExample(id));
  const advance = actionSelect(t('top.advanceLabel'), t('top.advance'),
    [[String(MINUTE), t('top.plusMinute')], [String(60 * MINUTE), t('top.plusHour')], [String(24 * 60 * MINUTE), t('top.plusDay')]], (v) => actions.advance(Number(v)));
  const menuId = 'topbar-menu';
  const toggle = el('button', { type: 'button', class: 'btn menu-toggle', 'aria-expanded': 'false', 'aria-controls': menuId }, el('span', { 'aria-hidden': 'true' }, '☰'), el('span', { class: 'menu-toggle-label' }, t('top.menu')));
  const menu = el('div', { class: 'topbar-menu', id: menuId },
    el('nav', { class: 'file-actions', 'aria-label': t('top.file') },
      button(t('top.new'), () => actions.newWorkspace()), button(t('top.open'), () => actions.openFile()),
      button(t('top.save'), () => actions.save(), { title: t('top.saveTitle') }), labs),
    el('div', { class: 'time' }, clockEl, advance),
    segmented(t('top.mode'), [['realtime', t('top.realtime')], ['simulation', t('top.simulation')]], mode, (v) => actions.setMode(v === 'simulation' ? 'simulation' : 'realtime')),
    languageSelect(actions));
  const bar = el('header', { class: 'topbar', 'data-open': 'false' },
    el('h1', { class: 'brand' }, brandImage('logo', 'brand-logo', 'Netfix')),
    segmented(t('top.view'), VIEWS.map(([v, k]) => [v, t(k)] as const), view, (v) => {
      actions.showView(v as View);
      setOpen(false);
    }, 'data-view'),
    toggle, menu);
  const setOpen = (open: boolean): void => {
    bar.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(bar.dataset.open !== 'true'));
  menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button.btn')) setOpen(false); });
  menu.addEventListener('change', () => setOpen(false));
  return bar;
}
