/**
 * Server → Servicios → DNS: bind9 by operating mode, one labelled block per mode in this order: Caché, Agente de
 * reenvío, Autoritativo, Recursivo, Iterativo (iterative depends on recursive). Each block has its switch, what it is for and its options.
 */
import { t, tDynamic } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, button, onOff, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { DnsSettings } from '../services/config.ts';
import { MODE_DIRECTIVES, dnsModes, setCache, setForwarders, setIterative, setRecursion } from '../services/dns-edit.ts';
import type { DnsMode, ModeState } from '../services/dns-edit.ts';
import { commit } from './dns-commit.ts';
import { forwardersText, GOOGLE_FORWARDERS } from '../services/dns-recursion.ts';
import { DEFAULT_ALLOW_RECURSION, interfaceNetworks, localNetworks, recursionChoice, recursionText } from '../services/dns-aml.ts';
import { DEFAULT_MAX_CACHE_TTL } from '../services/named-options.ts';
import { ROOT_SERVERS } from '../net/dns-roots.ts';
import { livePanel } from './server-dhcp-dns.ts';
import { listenBlock } from './listen-block.ts';
import { publicNamesBlock } from './dns-public-names.ts';
import { authoritativeBody, setAuthoritativeMode } from './server-dns-zones.ts';
import type { ZoneUi } from './server-dns-zones.ts';

function modeBlock(mode: DnsMode, state: ModeState, toggle: ((on: boolean) => void) | null, body: readonly (HTMLElement | null)[]): HTMLElement {
  const sw = onOff(tDynamic(`dnsm.${mode}`), state.on, (on) => toggle?.(on));
  const box = sw.querySelector('input');
  if (box && (state.locked || !toggle)) box.disabled = true;
  const uses = tDynamic(`dnsm.${mode}.uses`).split('|').map((u) => el('li', {}, u));
  return el('section', { class: 'dns-mode', 'data-mode': mode, 'data-on': state.on ? 'yes' : 'no' },
    el('header', { class: 'dns-mode-head' }, sw, el('p', { class: 'muted' }, tDynamic(`dnsm.${mode}.desc`)),
      state.locked ? el('p', { class: 'dns-mode-lock' }, state.locked) : null,
      el('p', { class: 'dns-mode-directive' }, t('dnsm.directive', { text: MODE_DIRECTIVES[mode] }))),
    el('details', { class: 'dns-mode-uses' }, el('summary', {}, t('dnsm.uses')), el('ul', {}, ...uses)),
    ...body);
}

function cacheBlock(server: Server, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const s = server.services.dns;
  const ttl = input({ value: String(s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL), inputmode: 'numeric', 'aria-label': t('dnsm.cache.ttl') });
  const rows = server.dns.forwarder.entries();
  return modeBlock('cache', dnsModes(s).cache, (on) => commit(server, app, msg, setCache(server.services.dns, on), true), [
    s.recursion === true ? null : el('p', { class: 'muted' }, t('dnsm.cache.idle')),
    el('div', { class: 'grid3' }, field(t('dnsm.cache.ttl'), ttl)),
    el('div', { class: 'actions' },
      button(t('dnsm.apply'), () => commit(server, app, msg, setCache(server.services.dns, ttl.value.trim() !== '0', ttl.value), true)),
      button(t('dnsm.cache.flush'), () => { server.dns.forwarder.flush(); app.afterCommand(); }, 'btn btn-quiet')),
    el('h4', {}, t('dnsm.cache.entries')),
    table(rows, [
      { label: t('dns.name'), value: (r) => r.name, mono: true }, { label: t('dns.type'), value: (r) => r.type },
      { label: t('dnsm.cache.answer'), value: (r) => r.what, mono: true }, { label: t('dnsm.cache.left'), value: (r) => String(r.ttl) },
    ], { empty: t('dnsm.cache.empty') }),
  ]);
}

function forwarderBlock(server: Server, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const s = server.services.dns;
  const fwd = input({ value: forwardersText(s), placeholder: GOOGLE_FORWARDERS, inputmode: 'decimal' });
  const apply = (text: string): boolean => commit(server, app, msg, setForwarders(server.services.dns, text), true);
  return modeBlock('forwarder', dnsModes(s).forwarder, (on) => apply(on ? GOOGLE_FORWARDERS : ''), [
    el('div', { class: 'grid3' }, field(t('dnsm.fwd.list'), fwd, t('dnsm.fwd.hint'))),
    el('div', { class: 'actions' }, button(t('dnsm.apply'), () => apply(fwd.value)), button(t('dnsm.fwd.google'), () => apply(GOOGLE_FORWARDERS), 'btn btn-quiet')),
    el('p', { class: 'muted' }, t('dnsm.fwd.note')),
  ]);
}

function iterativeBlock(server: Server, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const s = server.services.dns;
  const roots = ROOT_SERVERS.slice(0, 4).map((r) => `${r.name}  ${r.ip}`).join('\n');
  return modeBlock('iterative', dnsModes(s).iterative, (on) => commit(server, app, msg, setIterative(server.services.dns, on), true), [
    el('p', { class: 'muted' }, t('dnsm.it.explain')),
    el('p', { class: 'muted' }, t('dnsm.it.first')),
    el('h4', {}, t('dnsm.it.roots')),
    el('pre', { class: 'code-view' }, `${roots}\n… (13)`),
  ]);
}

function recursiveBlock(server: Server, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const s = server.services.dns;
  const nets = interfaceNetworks(server.nics());
  const c = recursionChoice(s.allowRecursion ?? DEFAULT_ALLOW_RECURSION, nets);
  const box = (checked: boolean): HTMLInputElement => el('input', { type: 'checkbox', checked });
  const any = box(c.any);
  const localnets = box(c.localnets);
  const localhost = box(c.localhost);
  const netBoxes = nets.map((n) => ({ n, box: box(c.nets.includes(n)) }));
  const customBox = box(c.custom !== '');
  const custom = input({ value: c.custom, placeholder: '192.168.0.0/24; !192.168.0.5', spellcheck: 'false', 'data-field': 'allow-recursion', 'aria-label': t('dnsm.rec.custom') });
  // As «Interfaces de escucha»: any greys out the rest; localnets already covers each local network.
  const sync = (): void => {
    for (const b of [localnets, localhost, customBox]) b.disabled = any.checked;
    for (const { box: b } of netBoxes) b.disabled = any.checked || localnets.checked;
    custom.disabled = any.checked || !customBox.checked;
  };
  for (const b of [any, localnets, customBox]) b.addEventListener('change', sync);
  sync();
  const text = (): string => recursionText({
    any: any.checked, localnets: localnets.checked, localhost: localhost.checked,
    nets: netBoxes.filter((b) => b.box.checked).map((b) => b.n), custom: customBox.checked ? custom.value : '',
  });
  const row = (b: HTMLInputElement, label: string, sub?: string | HTMLElement): HTMLElement =>
    el('label', { class: 'check listen-row' }, b, el('span', { class: 'mono' }, label), typeof sub === 'string' ? el('span', { class: 'muted' }, sub) : sub ?? null);
  const apply = (on: boolean): boolean => commit(server, app, msg, setRecursion(server.services.dns, on, text()), true);
  return modeBlock('recursive', dnsModes(s).recursive, apply, [
    el('p', { class: 'muted' }, t('dnsm.rec.explain')),
    el('fieldset', { class: 'listen-block', 'data-field': 'allow-recursion-boxes' },
      el('legend', {}, t('dnsm.rec.allow')),
      row(any, t('dnsm.rec.any')),
      row(localnets, 'localnets', localNetworks(server.nics())),
      ...netBoxes.map((b) => { const r = row(b.box, b.n); r.classList.add('indent'); return r; }),
      row(localhost, 'localhost', t('dnsm.rec.localhost')),
      row(customBox, t('dnsm.rec.custom'), custom),
      el('p', { class: 'field-hint' }, t('dnsm.rec.boxHint', { nets: localNetworks(server.nics()) }))),
    el('div', { class: 'actions' }, button(t('dnsm.apply'), () => apply(server.services.dns.recursion === true))),
  ]);
}

export function dnsPanel(server: Server, app: AfterChange): HTMLElement {
  // Outside the redraw: the wizard and the selected zone survive the panel's refresh.
  const ui: ZoneUi = { step: 0, draft: undefined, selected: undefined };
  const msg = message();
  return livePanel((refresh) => {
    const after: AfterChange = { ...app, afterCommand: () => { app.afterCommand(); refresh(); } };
    const s: DnsSettings = server.services.dns;
    return [
      onOff(t('dnsm.service'), s.enabled, (on) => { server.setUnit('dns', on); after.afterCommand(); }),
      el('p', { class: 'muted' }, t('dnsm.intro')),
      msg.el,
      listenBlock(server, 'dns', after, msg),
      cacheBlock(server, after, msg),
      forwarderBlock(server, after, msg),
      modeBlock('authoritative', dnsModes(s).authoritative, (on) => setAuthoritativeMode(server, after, msg, on), authoritativeBody(server, after, msg, ui)),
      recursiveBlock(server, after, msg),
      iterativeBlock(server, after, msg),
      publicNamesBlock(server, after, msg),
    ];
  });
}
