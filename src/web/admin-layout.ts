/**
 * Page frame of the management GUI of Server and Linux router: a top bar, a side menu grouped by area and the page
 * as cards (title, help, form). The look lives in the app's CSS (`web-adm-*`): the simulated browser copies no
 * styles or scripts, so icons are CSS glyphs and every interaction is a link or a form.
 */
import { t, tDynamic } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h, page } from './html.ts';
import type { Child, Markup } from './html.ts';
import { ABOUT } from '../docs/about-data.ts';

export interface AdminPage {
  readonly id: string;
  readonly tab: string;
}

/** Name of a page or area in the current language. */
export const pageLabel = (id: string): string => tDynamic(`wa.page.${id}`);
const tabLabel = (id: string): string => tDynamic(`wa.tab.${id}`);

export const TABS: readonly string[] = ['setup', 'services', 'security', 'admin', 'status'];

export const PAGES: readonly AdminPage[] = [
  { id: 'setup', tab: 'setup' },
  { id: 'ssh', tab: 'services' }, { id: 'dhcp', tab: 'services' }, { id: 'dns', tab: 'services' },
  { id: 'web', tab: 'services' }, { id: 'mail', tab: 'services' },
  { id: 'firewall', tab: 'security' }, { id: 'routing', tab: 'security' }, { id: 'vpn', tab: 'security' },
  { id: 'admin', tab: 'admin' },
  { id: 'status', tab: 'status' }, { id: 'files', tab: 'status' }, { id: 'log', tab: 'status' },
];

/** Pages of a device: Security (firewall, routes, VPN) only on a Linux router; Ficheros only on Linux. */
export function pagesOf(server: Server): readonly AdminPage[] {
  return PAGES.filter((p) => (p.tab !== 'security' || server.kind === 'linuxrouter') && (p.id !== 'files' || server.os === 'linux'));
}

/** A card: title, help line and its content. */
export function section(title: string, help: string, ...body: Child[]): Markup {
  return h('section', { class: 'web-adm-card' },
    h('header', { class: 'web-adm-card-head' }, h('h2', {}, title), help ? h('p', { class: 'web-adm-help' }, help) : null),
    h('div', { class: 'web-adm-card-body' }, ...body));
}

/** Cards of one form, one after the other. */
export function cards(...children: Child[]): Markup {
  return h('div', { class: 'web-adm-cards' }, ...children);
}

export function row(label: string, control: Child): Markup {
  return h('div', { class: 'web-adm-row' }, h('label', {}, h('span', { class: 'web-adm-field' }, label), control));
}

export function text(name: string, value: string, extra: Readonly<Record<string, string | number | boolean>> = {}): Markup {
  return h('input', { type: 'text', name, value, ...extra });
}

/** A checkbox drawn as a switch. */
export function check(name: string, on: boolean, label: string, disabled = false): Markup {
  return h('label', { class: 'web-adm-check' }, h('input', { type: 'checkbox', name, value: '1', checked: on, disabled }), h('span', { class: 'web-adm-check-label' }, label));
}

export function choose(name: string, value: string, options: readonly (readonly [string, string])[]): Markup {
  return h('select', { name }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

/** A form posting to the current page; `action` tells the server what to do. */
export function form(base: string, pageId: string, action: string, ...children: Child[]): Markup {
  return h('form', { method: 'post', action: `${base}/?page=${pageId}` }, h('input', { type: 'hidden', name: 'action', value: action }), ...children);
}

export function buttons(save = t('wa.save')): Markup {
  return h('div', { class: 'web-adm-buttons' }, h('button', { type: 'submit', class: 'web-adm-save' }, save), h('button', { type: 'reset', class: 'web-adm-reset' }, t('wa.cancel')));
}

function menu(server: Server, base: string, current: AdminPage): Markup {
  const pages = pagesOf(server);
  const groups = TABS.filter((id) => pages.some((p) => p.tab === id)).map((tab) => h('li', { class: 'web-adm-group' },
    h('span', { class: 'web-adm-group-name' }, tabLabel(tab)),
    h('ul', {}, pages.filter((p) => p.tab === tab).map((p) => h('li', { class: p.id === current.id ? 'web-adm-on' : undefined },
      h('a', { href: `${base}/?page=${p.id}`, class: `web-adm-nav web-adm-nav-${p.id}` }, pageLabel(p.id)))))));
  return h('nav', { class: 'web-adm-menu' }, h('ul', {}, groups));
}

export function frame(server: Server, base: string, current: AdminPage, notice: { ok?: string; error?: string }, body: Child): string {
  const kind = server.kind === 'linuxrouter' ? 'Router Linux' : server.os === 'windows' ? 'Windows Server' : 'Server';
  return page(`${server.name} · ${pageLabel(current.id)}`, 'web-adm',
    h('header', { class: 'web-adm-top' },
      h('span', { class: 'web-brand-logo', title: 'Netfix' }, 'Netfix'),
      h('span', { class: 'web-adm-product' }, t('wa.product')),
      h('span', { class: 'web-adm-device' }, `${server.name} · ${kind}`),
      h('span', { class: 'web-adm-version' }, t('wa.firmware', { version: ABOUT.version }))),
    h('div', { class: 'web-adm-layout' },
      menu(server, base, current),
      h('main', { class: 'web-adm-main' },
        h('div', { class: 'web-adm-title' }, h('h1', {}, pageLabel(current.id)), h('p', { class: 'web-adm-help' }, tDynamic(`wa.desc.${current.id}`))),
        notice.ok ? h('p', { class: 'web-adm-ok' }, notice.ok) : null,
        notice.error ? h('p', { class: 'web-adm-error' }, notice.error) : null,
        h('div', { class: `web-adm-page web-adm-page-${current.id}` }, body))),
    h('footer', { class: 'web-adm-foot web-brand-foot' }, h('span', { class: 'web-brand-iso' }, 'Netfix'), t('wa.foot')));
}
