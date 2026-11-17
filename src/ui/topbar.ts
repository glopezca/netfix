/** Top bar: brand, views, file actions, labs, clock, mode and language. Folds into a menu on phones. */
import { brandImage } from './brand.ts';
import { el } from './dom.ts';
import { EXAMPLES } from '../net/examples.ts';
import { LAB_GROUPS } from '../labs/lab-groups.ts';
import type { Example } from '../net/examples.ts';
import { labText } from './lab-text.ts';
import { t, tDynamic } from '../i18n/t.ts';
import type { MessageKey } from '../i18n/catalog.ts';
import { getLocale, LOCALES, LOCALE_NAMES, LOCALE_SHORT, isLocale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { NO_RESTRICTIONS, allowsLab } from '../classroom/restrictions.ts';
import type { Restrictions } from '../classroom/restrictions.ts';

export type View = 'net' | 'docs' | 'settings' | 'donate' | 'about';
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
const VIEWS: readonly (readonly [View, MessageKey])[] = [['net', 'view.net'], ['settings', 'view.settings'], ['donate', 'view.donate'], ['docs', 'view.docs'], ['about', 'view.about']];

function button(label: string, fn: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'btn', ...attrs }, label);
  b.addEventListener('click', fn);
  return b;
}

type Option = readonly [value: string, label: string];
/** Options, or groups of them (<optgroup>) as [group title, options]. */
type Options = readonly (Option | readonly [string, readonly Option[]])[];

const optionEl = ([v, l]: Option): HTMLOptionElement => el('option', { value: v }, l);

/** A <select> that runs `fn` with the chosen value and goes back to its placeholder. */
function actionSelect(label: string, placeholder: string, options: Options, fn: (v: string) => void): HTMLSelectElement {
  const s = el('select', { class: 'select', 'aria-label': label }, el('option', { value: '' }, placeholder),
    ...options.map((o) => (typeof o[1] === 'string' ? optionEl(o as Option) : el('optgroup', { label: o[0] }, ...(o[1] as readonly Option[]).map(optionEl)))));
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
    // The bar shows the short code; the full name is each option's accessible name (and Settings lists it in full).
    ...LOCALES.map((l) => el('option', { value: l, selected: l === getLocale(), lang: l, 'aria-label': LOCALE_NAMES[l], title: LOCALE_NAMES[l] }, LOCALE_SHORT[l])));
  s.addEventListener('change', () => { if (isLocale(s.value)) actions.setLocale(s.value); });
  return s;
}

/** The labs the classroom allows, by theme (a group with none left is not shown). */
function labGroups(allowed: readonly Example[]): Options {
  return LAB_GROUPS.flatMap(([group, ids]) => {
    const items = ids.flatMap((id) => allowed.filter((e) => e.id === id)).map((e) => [e.id, labText(e).title] as const);
    return items.length ? [[tDynamic(`labgroup.${group}`), items] as const] : [];
  });
}

/** What the classroom restrictions leave of a list: the items whose flag is on. */
function only(items: readonly (readonly [boolean, HTMLElement])[]): HTMLElement[] {
  return items.filter(([on]) => on).map(([, x]) => x);
}

/** `hosted`: the bar goes in the host page's own menu (`toolbar` option of `netfix.lab`/`netfix.embed`), without the
 * logo or the phone menu: the host shows Netfix's name and opens and closes it. */
export function topbar(actions: TopbarActions, clockEl: HTMLElement, mode: Mode, view: View = 'net', policy: Restrictions = NO_RESTRICTIONS, hosted = false): HTMLElement {
  const allowed = EXAMPLES.filter((e) => allowsLab(policy, e.id));
  const labs = actionSelect(t('top.examplesLabel'), t('top.examples'), labGroups(allowed), (id) => actions.loadExample(id));
  const advance = actionSelect(t('top.advanceLabel'), t('top.advance'),
    [[String(MINUTE), t('top.plusMinute')], [String(60 * MINUTE), t('top.plusHour')], [String(24 * 60 * MINUTE), t('top.plusDay')]], (v) => actions.advance(Number(v)));
  const items = [
    el('nav', { class: 'file-actions', 'aria-label': t('top.file') }, ...only([
      [policy.fileNew, button(t('top.new'), () => actions.newWorkspace())], [policy.fileOpen, button(t('top.open'), () => actions.openFile())],
      [policy.fileSave, button(t('top.save'), () => actions.save(), { title: t('top.saveTitle') })], [allowed.length > 0, labs]])),
    el('div', { class: 'time' }, clockEl, ...only([[policy.clock, advance]])),
    ...only([[policy.simulation, segmented(t('top.mode'), [['realtime', t('top.realtime')], ['simulation', t('top.simulation')]], mode, (v) => actions.setMode(v === 'simulation' ? 'simulation' : 'realtime'))]]),
    ...(hosted ? [] : [languageSelect(actions)])]; // hosted, the host's own Language menu sets it
  let closeMenu = (): void => undefined; // hosted, the host closes its own menu
  // Hosted, the host's Help, About and Settings menus open those pages: the bar keeps only the way back to the network.
  const views = segmented(t('top.view'), VIEWS.filter(([v]) => (hosted ? v === 'net' : v !== 'docs' || policy.docs)).map(([v, k]) => [v, t(k)] as const), view, (v) => {
    actions.showView(v as View);
    closeMenu();
  }, 'data-view');
  if (hosted) return el('div', { class: 'topbar is-hosted', role: 'group', 'aria-label': 'Netfix' }, views, ...items);
  const menuId = 'topbar-menu';
  const toggle = el('button', { type: 'button', class: 'btn menu-toggle', 'aria-expanded': 'false', 'aria-controls': menuId }, el('span', { 'aria-hidden': 'true' }, '☰'), el('span', { class: 'menu-toggle-label' }, t('top.menu')));
  const menu = el('div', { class: 'topbar-menu', id: menuId }, ...items);
  const bar = el('header', { class: 'topbar', 'data-open': 'false' },
    el('h1', { class: 'brand' }, brandImage('logo', 'brand-logo', 'Netfix')),
    views, toggle, menu);
  const setOpen = (open: boolean): void => {
    bar.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  closeMenu = () => setOpen(false);
  toggle.addEventListener('click', () => setOpen(bar.dataset.open !== 'true'));
  menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button.btn')) setOpen(false); });
  menu.addEventListener('change', () => setOpen(false));
  return bar;
}
