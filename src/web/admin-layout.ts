/** Page frame of the Server management GUI, laid out like a Linksys WRT300N (no third-party marks). */
import { t, tDynamic } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h, page } from './html.ts';
import type { Child, Markup } from './html.ts';
import { ABOUT } from '../docs/about-data.ts';

export interface AdminPage {
  readonly id: string;
  readonly tab: string;
}

/** Name of a page or tab in the current language. */
export const pageLabel = (id: string): string => tDynamic(`wa.page.${id}`);
const tabLabel = (id: string): string => tDynamic(`wa.tab.${id}`);

export const TABS: readonly string[] = ['setup', 'services', 'security', 'admin', 'status'];

export const PAGES: readonly AdminPage[] = [
  { id: 'setup', tab: 'setup' },
  { id: 'dhcp', tab: 'services' }, { id: 'dns', tab: 'services' }, { id: 'web', tab: 'services' },
  { id: 'mail', tab: 'services' }, { id: 'ssh', tab: 'services' },
  { id: 'firewall', tab: 'security' }, { id: 'routing', tab: 'security' }, { id: 'vpn', tab: 'security' },
  { id: 'admin', tab: 'admin' },
  { id: 'status', tab: 'status' }, { id: 'log', tab: 'status' },
];

/** One section row: dark label column, form column, help column. */
export function section(title: string, help: string, ...body: Child[]): Markup {
  return h('tr', {}, h('th', { class: 'web-wrt-label' }, title), h('td', { class: 'web-wrt-body' }, ...body), h('td', { class: 'web-wrt-help' }, help));
}

export function row(label: string, control: Child): Markup {
  return h('div', { class: 'web-wrt-row' }, h('label', {}, h('span', { class: 'web-wrt-field' }, label), control));
}

export function text(name: string, value: string, extra: Readonly<Record<string, string | number | boolean>> = {}): Markup {
  return h('input', { type: 'text', name, value, ...extra });
}

export function check(name: string, on: boolean, label: string): Markup {
  return h('label', { class: 'web-wrt-check' }, h('input', { type: 'checkbox', name, value: '1', checked: on }), ` ${label}`);
}

export function choose(name: string, value: string, options: readonly (readonly [string, string])[]): Markup {
  return h('select', { name }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

/** A form posting to the current page; `action` tells the server what to do. */
export function form(base: string, pageId: string, action: string, ...children: Child[]): Markup {
  return h('form', { method: 'post', action: `${base}/?page=${pageId}` }, h('input', { type: 'hidden', name: 'action', value: action }), ...children);
}

export function buttons(): Markup {
  return h('div', { class: 'web-wrt-buttons' }, h('button', { type: 'submit', class: 'web-wrt-save' }, t('wa.save')), h('button', { type: 'reset' }, t('wa.cancel')));
}

export function frame(server: Server, base: string, current: AdminPage, notice: { ok?: string; error?: string }, body: Child): string {
  const link = (id: string): string => `${base}/?page=${id}`;
  const tabs = TABS.map((id) => {
    const label = tabLabel(id);
    const first = PAGES.find((p) => p.tab === id)?.id ?? id;
    return h('li', { class: id === current.tab ? 'web-wrt-tab web-wrt-on' : 'web-wrt-tab' }, h('a', { href: link(first) }, label));
  });
  const subs = PAGES.filter((p) => p.tab === current.tab).map((p) => h('li', { class: p.id === current.id ? 'web-wrt-on' : undefined }, h('a', { href: link(p.id) }, pageLabel(p.id))));
  return page(`Server · ${pageLabel(current.id)}`, 'web-wrt',
    h('div', { class: 'web-wrt-top' }, h('span', { class: 'web-brand-logo', title: 'Netfix' }, 'Netfix'), h('span', {}, t('wa.firmware', { version: ABOUT.version }))),
    h('div', { class: 'web-wrt-title' }, h('span', { class: 'web-wrt-product' }, t('wa.product')), h('span', { class: 'web-wrt-model' }, server.name)),
    h('ul', { class: 'web-wrt-tabs' }, tabs),
    h('ul', { class: 'web-wrt-subtabs' }, subs),
    notice.ok ? h('p', { class: 'web-wrt-ok' }, notice.ok) : null,
    notice.error ? h('p', { class: 'web-wrt-error' }, notice.error) : null,
    h('table', { class: 'web-wrt-page' }, body),
    h('p', { class: 'web-wrt-foot web-brand-foot' }, h('span', { class: 'web-brand-iso' }, 'Netfix'), t('wa.foot')));
}
