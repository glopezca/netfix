/**
 * DNS page of the management GUI: one card per operating mode (Caché, Agente de reenvío, Autoritativo, Iterativo,
 * Recursivo) with its switch, the settings of the chosen mode below, and the generated BIND configuration, explained,
 * beside them. Same editing code as the Services tab (services/dns-edit.ts).
 */
import { t, tDynamic } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, cards, check, choose, form, row, section, text } from './admin-layout.ts';
import { DNS_MODES, MODE_DIRECTIVES, dnsModes } from '../services/dns-edit.ts';
import type { DnsMode } from '../services/dns-edit.ts';
import { forwardersText, GOOGLE_FORWARDERS } from '../services/dns-recursion.ts';
import { DEFAULT_MAX_CACHE_TTL } from '../services/named-options.ts';
import { ROOT_SERVERS } from '../net/dns-roots.ts';
import { zonesTab } from './admin-dns-zones.ts';
import { dnsLink, keepMode, modeOf } from './admin-dns-links.ts';
import type { Query } from './admin-dns-links.ts';
import { dnsSide } from './admin-dns-side.ts';
import { listenForm } from './admin-listen.ts';

function modeCard(server: Server, mode: DnsMode): Markup {
  const state = dnsModes(server.services.dns)[mode];
  const uses = tDynamic(`dnsm.${mode}.uses`).split('|').map((u) => h('li', {}, u));
  return h('article', { class: `web-adm-mode web-adm-mode-${mode}${state.on ? '' : ' web-adm-mode-off'}` },
    h('span', { class: 'web-adm-mode-ico' }),
    h('h3', {}, tDynamic(`dnsm.${mode}`)),
    check(mode, state.on, state.on ? t('wad.on') : t('wad.off'), state.locked !== undefined),
    h('p', {}, tDynamic(`dnsm.${mode}.desc`)),
    state.locked ? h('p', { class: 'web-adm-mode-lock' }, state.locked) : null,
    h('div', { class: 'web-adm-mode-uses' }, h('strong', {}, t('dnsm.uses')), h('ul', {}, uses)),
    h('code', { class: 'web-adm-mode-directive' }, MODE_DIRECTIVES[mode]));
}

function modesForm(server: Server, base: string, mode: DnsMode): Markup {
  return form(base, 'dns', 'dns-modes', keepMode(mode),
    h('section', { class: 'web-adm-intro' }, h('h2', {}, t('wad.modesTitle')), h('p', { class: 'web-adm-help' }, t('wad.modesHelp')),
      check('enabled', server.services.dns.enabled, t('wad.service'))),
    h('div', { class: 'web-adm-modes' }, DNS_MODES.map((m) => modeCard(server, m))),
    buttons(t('wad.saveModes')));
}

function cacheTab(server: Server, base: string): Child {
  const s = server.services.dns;
  const rows = server.dns.forwarder.entries().map((e) => h('tr', {}, h('td', { class: 'web-adm-mono' }, e.name), h('td', {}, e.type), h('td', { class: 'web-adm-mono' }, e.what), h('td', {}, String(e.ttl))));
  return [
    s.recursion === true ? null : h('p', { class: 'web-adm-note' }, t('dnsm.cache.idle')),
    form(base, 'dns', 'dns-cache', keepMode('cache'), row(t('dnsm.cache.ttl'), text('ttl', String(s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL))), buttons()),
    form(base, 'dns', 'dns-flush', keepMode('cache'), h('button', { type: 'submit', class: 'web-adm-small' }, t('dnsm.cache.flush'))),
    h('h3', {}, t('dnsm.cache.entries')),
    rows.length ? h('table', { class: 'web-adm-list' }, h('tr', {}, h('th', {}, t('dns.name')), h('th', {}, t('dns.type')), h('th', {}, t('dnsm.cache.answer')), h('th', {}, t('dnsm.cache.left'))), rows)
      : h('p', { class: 'web-adm-muted' }, t('dnsm.cache.empty')),
  ];
}

function forwarderTab(server: Server, base: string): Child {
  return [
    form(base, 'dns', 'dns-forwarders', keepMode('forwarder'), row(t('dnsm.fwd.list'), text('forwarders', forwardersText(server.services.dns), { placeholder: GOOGLE_FORWARDERS })),
      h('p', { class: 'web-adm-help' }, t('dnsm.fwd.hint')), buttons()),
    form(base, 'dns', 'dns-forwarders', keepMode('forwarder'), h('input', { type: 'hidden', name: 'forwarders', value: GOOGLE_FORWARDERS }),
      h('button', { type: 'submit', class: 'web-adm-small' }, t('dnsm.fwd.google'))),
    h('p', { class: 'web-adm-note' }, t('dnsm.fwd.note')),
  ];
}

function iterativeTab(server: Server, base: string): Child {
  const s = server.services.dns;
  const state = dnsModes(s).iterative;
  const roots = ROOT_SERVERS.map((r) => h('tr', {}, h('td', { class: 'web-adm-mono' }, r.name), h('td', { class: 'web-adm-mono' }, r.ip)));
  return [
    h('p', {}, t('dnsm.it.explain')),
    state.locked ? h('p', { class: 'web-adm-note' }, state.locked) : form(base, 'dns', 'dns-iterative', keepMode('iterative'),
      row(t('wad.forward'), choose('forward', s.forwardOnly === false ? 'first' : 'only', [['first', t('wad.forwardFirst')], ['only', t('wad.forwardOnly')]])), buttons()),
    h('h3', {}, t('dnsm.it.roots')),
    h('table', { class: 'web-adm-list' }, roots),
  ];
}

function recursiveTab(server: Server, base: string): Child {
  const s = server.services.dns;
  return [
    h('p', {}, t('dnsm.rec.explain')),
    form(base, 'dns', 'dns-recursive', keepMode('recursive'), check('recursion', s.recursion === true, t('wad.recursion')),
      row(t('dnsm.rec.allow'), choose('allow', s.allowRecursion ?? 'localnets', [['localnets', t('dns.rec.localnets')], ['any', t('dns.rec.any')]])), buttons()),
  ];
}

function specific(server: Server, base: string, q: Query, mode: DnsMode): Markup {
  const tabs = DNS_MODES.map((m) => h('li', { class: m === mode ? 'web-adm-on' : undefined },
    h('a', { href: dnsLink(base, { mode: m }), class: `web-adm-tab web-adm-tab-${m}` }, tDynamic(`dnsm.${m}`))));
  const body = mode === 'cache' ? cacheTab(server, base) : mode === 'forwarder' ? forwarderTab(server, base)
    : mode === 'iterative' ? iterativeTab(server, base) : mode === 'recursive' ? recursiveTab(server, base) : zonesTab(server, base, q);
  return h('div', { class: 'web-adm-specific' },
    h('h2', {}, t('wad.specific')),
    h('ul', { class: 'web-adm-tabs' }, tabs),
    cards(section(tDynamic(`dnsm.${mode}`), tDynamic(`dnsm.${mode}.desc`), body)));
}

export function dnsPage(server: Server, base: string, q: Query): Child {
  const mode = modeOf(q);
  return h('div', { class: 'web-adm-dns' },
    h('div', { class: 'web-adm-dns-main' }, modesForm(server, base, mode), listenForm(server, base, 'dns'), specific(server, base, q, mode)),
    dnsSide(server, base, q, mode));
}
