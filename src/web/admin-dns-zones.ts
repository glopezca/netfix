/**
 * Autoritativo tab of the DNS page: the zone list (with the automatic reverse zones), the wizard in its order —
 * 1 SOA → 2 NS → 3 kind (GET forms that carry the draft in hidden fields) → 4 records — and the zone editor.
 */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import { buttons, choose, form, row, text } from './admin-layout.ts';
import { draftStep } from '../services/dns-edit.ts';
import type { ZoneDraft } from '../services/dns-edit.ts';
import { recordTypesFor, rnameToEmail, servedZones, soaText, zoneProblems } from '../services/dns-zones.ts';
import type { ServedZone } from '../services/dns-zones.ts';
import { DEFAULT_TTL } from '../services/config.ts';
import { dnsLink, keepMode } from './admin-dns-links.ts';
import type { Query } from './admin-dns-links.ts';

type Step = 1 | 2 | 3;
const DRAFT_KEYS = ['name', 'mname', 'email', 'refresh', 'retry', 'expire', 'minimum', 'ns', 'kind'] as const;
const DEFAULTS: ZoneDraft = { name: '', mname: '', email: '', refresh: '604800', retry: '86400', expire: '2419200', minimum: '3600', ns: '', kind: 'forward' };

const hidden = (name: string, value: string): Markup => h('input', { type: 'hidden', name, value });

/** The draft carried by the wizard (z_* fields), with the usual defaults filled from the zone name. */
export function draftFrom(q: Query): ZoneDraft {
  const get = (k: string, d: string): string => (q.get(`z_${k}`) ?? d).slice(0, 253);
  const name = get('name', '').trim().toLowerCase();
  return {
    name, mname: get('mname', '').trim() || (name ? `ns.${name}` : ''), email: get('email', '').trim() || (name ? `admin@${name}` : ''),
    refresh: get('refresh', DEFAULTS.refresh), retry: get('retry', DEFAULTS.retry), expire: get('expire', DEFAULTS.expire), minimum: get('minimum', DEFAULTS.minimum),
    ns: get('ns', ''), kind: q.get('z_kind') === 'reverse' ? 'reverse' : 'forward',
  };
}

const draftParams = (d: ZoneDraft): Record<string, string> => Object.fromEntries(DRAFT_KEYS.map((k) => [`z_${k}`, d[k]]));

function zoneList(base: string, zones: readonly ServedZone[], selected: string | undefined): Markup {
  if (!zones.length) return h('p', { class: 'web-adm-muted' }, t('dnsm.zone.none'));
  const del = (name: string): Markup => form(base, 'dns', 'zone-del', keepMode('authoritative'), hidden('zone', name), h('button', { type: 'submit', class: 'web-adm-small' }, t('wa.remove')));
  const rows = zones.map(({ zone: z, auto }) => h('tr', { class: z.name === selected ? 'web-adm-selected' : undefined },
    h('td', { class: 'web-adm-mono' }, h('a', { href: dnsLink(base, { mode: 'authoritative', zone: z.name }) }, z.name)),
    h('td', {}, t(z.kind === 'reverse' ? 'dnsm.zone.reverse' : 'dnsm.zone.forward')), h('td', { class: 'web-adm-mono' }, z.ns.join(', ')),
    h('td', {}, String(z.records.length)), h('td', {}, h('span', { class: auto ? 'web-adm-badge web-adm-badge-auto' : 'web-adm-badge' }, t(auto ? 'dnsm.zone.auto' : 'dnsm.zone.manual'))),
    h('td', {}, auto ? null : del(z.name))));
  const head = [t('dnsm.zone.name'), t('dnsm.zone.kind'), t('dnsm.zone.ns'), t('dnsm.zone.records'), t('dnsm.zone.origin'), ''].map((c) => h('th', {}, c));
  return h('table', { class: 'web-adm-list' }, h('tr', {}, head), rows);
}

function stepInputs(step: Step, d: ZoneDraft): Child {
  if (step === 1) return [h('p', { class: 'web-adm-help' }, t('dnsm.wiz.help1')),
    row(t('dnsm.wiz.name'), text('z_name', d.name, { placeholder: 'aula.lab' })), h('p', { class: 'web-adm-help' }, t('dnsm.wiz.nameHint')),
    row(t('dnsm.wiz.mname'), text('z_mname', d.mname, { placeholder: 'ns.aula.lab' })), row(t('dnsm.wiz.email'), text('z_email', d.email, { placeholder: 'admin@aula.lab' })),
    row(t('dnsm.wiz.refresh'), text('z_refresh', d.refresh)), row(t('dnsm.wiz.retry'), text('z_retry', d.retry)),
    row(t('dnsm.wiz.expire'), text('z_expire', d.expire)), row(t('dnsm.wiz.minimum'), text('z_minimum', d.minimum))];
  if (step === 2) return [h('p', { class: 'web-adm-help' }, t('dnsm.wiz.help2')), row(t('dnsm.zone.ns'), text('z_ns', d.ns || d.mname)), h('p', { class: 'web-adm-help' }, t('dnsm.wiz.nsHint'))];
  return [h('p', { class: 'web-adm-help' }, t('dnsm.wiz.help3')), row(t('dnsm.zone.kind'), choose('z_kind', d.kind, [['forward', t('dnsm.wiz.forward')], ['reverse', t('dnsm.wiz.reverse')]]))];
}

/** Fields of the other steps travel hidden, so going forward or back keeps what was typed. */
function carried(step: Step, d: ZoneDraft): Markup[] {
  const shown: Readonly<Record<Step, readonly string[]>> = { 1: ['name', 'mname', 'email', 'refresh', 'retry', 'expire', 'minimum'], 2: ['ns'], 3: ['kind'] };
  return DRAFT_KEYS.filter((k) => !shown[step].includes(k)).map((k) => hidden(`z_${k}`, d[k]));
}

function stepForm(base: string, step: Step, d: ZoneDraft): Markup {
  const back = step > 1 ? h('a', { href: dnsLink(base, { mode: 'authoritative', wiz: String(step - 1), ...draftParams(d) }), class: 'web-adm-link' }, t('dnsm.wiz.back')) : null;
  const cancel = h('a', { href: dnsLink(base, { mode: 'authoritative' }), class: 'web-adm-link' }, t('dnsm.wiz.cancel'));
  const nav = h('div', { class: 'web-adm-buttons' }, back, h('button', { type: 'submit', class: 'web-adm-save' }, step === 3 ? t('dnsm.wiz.create') : t('dnsm.wiz.next')), cancel);
  if (step === 3) return form(base, 'dns', 'zone-add', keepMode('authoritative'), hidden('wiz', '3'), ...carried(3, d), stepInputs(3, d), nav);
  return h('form', { method: 'get', action: `${base}/` }, hidden('page', 'dns'), hidden('mode', 'authoritative'), hidden('wiz', String(step + 1)), ...carried(step, d), stepInputs(step, d), nav);
}

function wizard(server: Server, base: string, q: Query): Markup {
  const want = Number(q.get('wiz'));
  if (![1, 2, 3].includes(want)) return h('p', {}, h('a', { href: dnsLink(base, { mode: 'authoritative', wiz: '1' }), class: 'web-adm-button' }, t('dnsm.wiz.start')));
  const d = draftFrom(q);
  let step = want as Step;
  let error: string | null = null;
  for (const s of [1, 2] as const) {
    if (s >= want) break;
    error = draftStep(d, s, server.services.dns.zones);
    if (error) { step = s; break; }
  }
  const titles = [t('dnsm.wiz.step1'), t('dnsm.wiz.step2'), t('dnsm.wiz.step3'), t('dnsm.wiz.step4')];
  return h('div', { class: 'web-adm-wizard' },
    h('h3', {}, t('dnsm.wiz.title')),
    h('ol', { class: 'web-adm-steps' }, titles.map((title, i) => h('li', { class: i + 1 === step ? 'web-adm-on' : i + 1 < step ? 'web-adm-done' : undefined }, title))),
    error ? h('p', { class: 'web-adm-error' }, error) : null,
    stepForm(base, step, d));
}

function recordRows(base: string, z: ServedZone): Markup {
  const rows = z.zone.records.map((r, i) => h('tr', {}, h('td', { class: 'web-adm-mono' }, r.name), h('td', {}, r.type),
    h('td', { class: 'web-adm-mono' }, `${r.type === 'MX' ? `${r.priority ?? 10} ` : ''}${r.value}`), h('td', {}, String(r.ttl)),
    h('td', {}, z.auto ? null : form(base, 'dns', 'zone-record-del', keepMode('authoritative'), hidden('zone', z.zone.name), hidden('key', String(i)), h('button', { type: 'submit', class: 'web-adm-small' }, t('wa.remove'))))));
  if (!rows.length) return h('p', { class: 'web-adm-muted' }, t('dnsm.ed.noRecords'));
  return h('table', { class: 'web-adm-list' }, h('tr', {}, [t('dns.name'), t('dns.type'), t('dns.value'), 'TTL', ''].map((c) => h('th', {}, c))), rows);
}

function zoneEditor(base: string, z: ServedZone): Markup {
  const zone = z.zone;
  const types = recordTypesFor(zone.kind);
  const problems = zoneProblems(zone);
  const keep = [keepMode('authoritative'), hidden('zone', zone.name)];
  const editable: Child = z.auto ? h('p', { class: 'web-adm-note' }, t('dnsm.ed.auto')) : [
    form(base, 'dns', 'zone-ns', ...keep, row(t('dnsm.zone.ns'), text('ns', zone.ns.join(', '))), h('button', { type: 'submit', class: 'web-adm-small' }, t('dnsm.ed.saveNs'))),
    form(base, 'dns', 'zone-record-add', ...keep, h('h4', {}, t('dnsm.ed.newRecord')), h('p', { class: 'web-adm-help' }, t('dnsm.ed.types', { types: types.join(', ') })),
      row(t('dns.type'), choose('type', types[0] ?? 'A', types.map((x) => [x, x] as const))), row(t('dns.name'), text('name', '', { placeholder: zone.kind === 'reverse' ? '10' : 'www' })),
      row(t('dns.value'), text('value', '')), row(t('dns.priority'), text('priority', '10')), row('TTL (s)', text('ttl', String(DEFAULT_TTL))), buttons(t('dnsm.ed.add'))),
    form(base, 'dns', 'zone-del', ...keep, h('button', { type: 'submit', class: 'web-adm-small web-adm-danger' }, t('dnsm.ed.delete'))),
  ];
  return h('div', { class: 'web-adm-zone' },
    h('h3', {}, `${t('dnsm.wiz.step4')} — ${t('dnsm.ed.title', { name: zone.name })}`),
    h('p', { class: 'web-adm-mono web-adm-soa' }, `SOA ${soaText(zone.soa)} (${rnameToEmail(zone.soa.rname)})`),
    recordRows(base, z), editable,
    h('h4', {}, t('dnsm.ed.check')),
    problems.length ? h('ul', { class: 'web-adm-problems' }, problems.map((p) => h('li', {}, p))) : h('p', { class: 'web-adm-muted' }, t('dnsm.ed.ok')));
}

export function zonesTab(server: Server, base: string, q: Query): Child {
  const s = server.services.dns;
  const zones = servedZones({ ...s, authoritative: true });
  const selected = zones.find((z) => z.zone.name === q.get('zone'));
  return [
    s.authoritative === false ? h('p', { class: 'web-adm-note' }, t('dnsm.zone.off')) : null,
    h('h3', {}, t('dnsm.zone.list')),
    zoneList(base, zones, selected?.zone.name),
    h('p', { class: 'web-adm-note' }, t('dnsm.zone.autoInfo')),
    wizard(server, base, q),
    selected ? zoneEditor(base, selected) : h('p', { class: 'web-adm-muted' }, t('dnsm.wiz.help4')),
  ];
}
