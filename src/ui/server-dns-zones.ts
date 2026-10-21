/**
 * The Autoritativo block of the DNS panel: the zone list (hand-made and automatic reverse zones), the zone wizard in
 * its order (1 SOA → 2 NS → 3 kind) and, for the selected zone, step 4: its records, NS list and named-checkzone.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, select, button, message, table } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import type { DnsRecord, DnsRecordType, DnsZone } from '../services/config.ts';
import { DEFAULT_TTL } from '../services/config.ts';
import { addRecord, addZone, draftStep, removeRecord, removeZone, setAuthoritative, setZoneNs, ymdOf } from '../services/dns-edit.ts';
import type { ZoneDraft } from '../services/dns-edit.ts';
import { recordTypesFor, rnameToEmail, servedZones, soaText, zoneProblems } from '../services/dns-zones.ts';
import type { ServedZone } from '../services/dns-zones.ts';
import { displayName } from '../services/dns-names.ts';
import { commit } from './dns-commit.ts';

type Msg = ReturnType<typeof message>;

/** What the panel remembers between redraws: the wizard step and draft, and the selected zone. */
export interface ZoneUi {
  step: 0 | 1 | 2 | 3;
  draft: ZoneDraft | undefined;
  selected: string | undefined;
}

const EMPTY_DRAFT: ZoneDraft = { name: '', mname: '', email: '', refresh: '604800', retry: '86400', expire: '2419200', minimum: '3600', ns: '', kind: 'forward' };

export function setAuthoritativeMode(server: Server, app: AfterChange, msg: Msg, on: boolean): void {
  commit(server, app, msg, setAuthoritative(server.services.dns, on));
}

function zoneList(server: Server, app: AfterChange, msg: Msg, ui: ZoneUi, zones: readonly ServedZone[]): HTMLElement {
  return table(zones, [
    { label: t('dnsm.zone.name'), value: (z) => z.zone.name, mono: true },
    { label: t('dnsm.zone.kind'), value: (z) => t(z.zone.kind === 'reverse' ? 'dnsm.zone.reverse' : 'dnsm.zone.forward') },
    { label: t('dnsm.zone.ns'), value: (z) => z.zone.ns.join(', '), mono: true },
    { label: t('dnsm.zone.records'), value: (z) => String(z.zone.records.length) },
    { label: t('dnsm.zone.origin'), value: (z) => t(z.auto ? 'dnsm.zone.auto' : 'dnsm.zone.manual') },
  ], {
    empty: t('dnsm.zone.none'),
    selected: (z) => z.zone.name === ui.selected,
    onSelect: (z) => { ui.selected = z.zone.name; app.afterCommand(); },
    actions: (z) => (z.auto ? [] : [button(t('common.delete'), () => {
      if (ui.selected === z.zone.name) ui.selected = undefined;
      commit(server, app, msg, removeZone(server.services.dns, z.zone.name));
    }, 'btn btn-quiet btn-small')]),
  });
}

function stepFields(ui: ZoneUi, d: ZoneDraft): { fields: HTMLElement[]; read: () => ZoneDraft } {
  if (ui.step === 1) {
    const f = { name: input({ value: d.name, placeholder: 'aula.lab' }), mname: input({ value: d.mname, placeholder: 'ns.aula.lab' }), email: input({ value: d.email, placeholder: 'admin@aula.lab' }),
      refresh: input({ value: d.refresh, inputmode: 'numeric' }), retry: input({ value: d.retry, inputmode: 'numeric' }), expire: input({ value: d.expire, inputmode: 'numeric' }), minimum: input({ value: d.minimum, inputmode: 'numeric' }) };
    const fields = [el('p', { class: 'muted' }, t('dnsm.wiz.help1')), el('div', { class: 'grid3' }, field(t('dnsm.wiz.name'), f.name, t('dnsm.wiz.nameHint')), field(t('dnsm.wiz.mname'), f.mname), field(t('dnsm.wiz.email'), f.email),
      field(t('dnsm.wiz.refresh'), f.refresh), field(t('dnsm.wiz.retry'), f.retry), field(t('dnsm.wiz.expire'), f.expire), field(t('dnsm.wiz.minimum'), f.minimum))];
    return { fields, read: () => {
      const name = f.name.value.trim().toLowerCase();
      return { ...d, name, mname: f.mname.value.trim() || `ns.${name}`, email: f.email.value.trim() || `admin@${name}`, refresh: f.refresh.value, retry: f.retry.value, expire: f.expire.value, minimum: f.minimum.value };
    } };
  }
  if (ui.step === 2) {
    const ns = input({ value: d.ns || d.mname, placeholder: 'ns.aula.lab' });
    return { fields: [el('p', { class: 'muted' }, t('dnsm.wiz.help2')), el('div', { class: 'grid3' }, field(t('dnsm.zone.ns'), ns, t('dnsm.wiz.nsHint')))], read: () => ({ ...d, ns: ns.value }) };
  }
  const kind = select([['forward', t('dnsm.wiz.forward')], ['reverse', t('dnsm.wiz.reverse')]], d.kind);
  return { fields: [el('p', { class: 'muted' }, t('dnsm.wiz.help3')), el('div', { class: 'grid3' }, field(t('dnsm.zone.kind'), kind))], read: () => ({ ...d, kind: kind.value === 'reverse' ? 'reverse' : 'forward' }) };
}

function wizard(server: Server, app: AfterChange, msg: Msg, ui: ZoneUi): HTMLElement {
  if (ui.step === 0) return el('div', { class: 'actions' }, button(t('dnsm.wiz.start'), () => { ui.step = 1; ui.draft = EMPTY_DRAFT; app.afterCommand(); }));
  const d = ui.draft ?? EMPTY_DRAFT;
  const step = ui.step;
  const { fields, read } = stepFields(ui, d);
  const next = (): void => {
    const draft = read();
    ui.draft = draft;
    const err = draftStep(draft, step, server.services.dns.zones);
    if (err) { msg.error(err); return; }
    if (step < 3) { ui.step = (step + 1) as 2 | 3; msg.clear(); app.afterCommand(); return; }
    if (commit(server, app, msg, addZone(server.services.dns, draft, ymdOf(server.clock.now())))) {
      ui.selected = server.services.dns.zones[server.services.dns.zones.length - 1]?.name;
      ui.step = 0;
      ui.draft = undefined;
      msg.ok(t('dnsm.ed.created', { name: ui.selected ?? '' }));
    }
  };
  const titles = [t('dnsm.wiz.step1'), t('dnsm.wiz.step2'), t('dnsm.wiz.step3')];
  return el('div', { class: 'dns-wizard' },
    el('h4', {}, t('dnsm.wiz.title')),
    el('ol', { class: 'dns-steps' }, ...titles.map((title, i) => el('li', { class: i + 1 === step ? 'is-current' : i + 1 < step ? 'is-done' : '' }, title)), el('li', {}, t('dnsm.wiz.step4'))),
    ...fields,
    el('div', { class: 'actions' },
      step > 1 ? button(t('dnsm.wiz.back'), () => { ui.draft = read(); ui.step = (step - 1) as 1 | 2; app.afterCommand(); }, 'btn btn-quiet') : null,
      button(step === 3 ? t('dnsm.wiz.create') : t('dnsm.wiz.next'), next),
      button(t('dnsm.wiz.cancel'), () => { ui.step = 0; ui.draft = undefined; msg.clear(); app.afterCommand(); }, 'btn btn-quiet')));
}

function recordForm(server: Server, app: AfterChange, msg: Msg, zone: DnsZone): HTMLElement[] {
  const types = recordTypesFor(zone.kind);
  const type = select(types.map((x) => [x, x] as const));
  const name = input({ placeholder: zone.kind === 'reverse' ? '10' : 'www  ·  @  ·  *' });
  const value = input({ placeholder: zone.kind === 'reverse' ? `www.${zone.name.endsWith('in-addr.arpa') ? 'aula.lab' : zone.name}.` : '192.168.1.10' });
  const prio = input({ value: '10', inputmode: 'numeric' });
  const ttl = input({ value: String(DEFAULT_TTL), inputmode: 'numeric' });
  const prioField = field(t('dns.priority'), prio);
  prioField.hidden = true;
  const preview = el('p', { class: 'muted', 'aria-live': 'polite' });
  const show = (): void => { preview.textContent = name.value.trim() ? t('dns.fullName', { name: displayName(name.value, zone.name) }) : ''; };
  type.addEventListener('change', () => { prioField.hidden = type.value !== 'MX'; });
  name.addEventListener('input', show);
  const add = (): void => {
    const rec: DnsRecord = { name: name.value.trim().toLowerCase(), type: type.value as DnsRecordType, value: value.value.trim(), ttl: Number(ttl.value) || DEFAULT_TTL, ...(type.value === 'MX' ? { priority: Number(prio.value) } : {}) };
    commit(server, app, msg, addRecord(server.services.dns, zone.name, rec, ymdOf(server.clock.now())));
  };
  return [
    el('h4', {}, t('dnsm.ed.newRecord')),
    el('p', { class: 'muted' }, t('dnsm.ed.types', { types: types.join(', ') })),
    el('div', { class: 'grid3' }, field(t('dns.type'), type), field(t('dns.name'), name), field(t('dns.value'), value), prioField, field('TTL (s)', ttl)),
    preview,
    el('div', { class: 'actions' }, button(t('dnsm.ed.add'), add)),
  ];
}

function recordsTable(server: Server, app: AfterChange, msg: Msg, zone: DnsZone, editable: boolean): HTMLElement {
  const rows = zone.records.map((r, i) => ({ r, i }));
  return table(rows, [
    { label: t('dns.name'), value: (x) => x.r.name, mono: true },
    { label: t('dns.fullNameCol'), value: (x) => displayName(x.r.name, zone.name), mono: true },
    { label: t('dns.type'), value: (x) => x.r.type },
    { label: t('dns.value'), value: (x) => (x.r.type === 'MX' ? `${x.r.priority ?? 10} ${x.r.value}` : x.r.value), mono: true },
    { label: 'TTL', value: (x) => String(x.r.ttl) },
  ], { empty: t('dnsm.ed.noRecords'), ...(editable ? { onDelete: (x: { r: DnsRecord; i: number }) => commit(server, app, msg, removeRecord(server.services.dns, zone.name, x.i, ymdOf(server.clock.now()))) } : {}) });
}

function zoneEditor(server: Server, app: AfterChange, msg: Msg, served: ServedZone): HTMLElement {
  const z = served.zone;
  const problems = zoneProblems(z);
  const ns = input({ value: z.ns.join(', ') });
  const head = [el('h4', {}, `${t('dnsm.wiz.step4')} — ${t('dnsm.ed.title', { name: z.name })}`),
    el('p', { class: 'mono dns-soa' }, `${t('dnsm.ed.soa')}: ${soaText(z.soa)}  (${rnameToEmail(z.soa.rname)})`)];
  if (served.auto) return el('div', { class: 'dns-zone-editor' }, ...head, el('p', { class: 'muted' }, t('dnsm.ed.auto')), recordsTable(server, app, msg, z, false));
  return el('div', { class: 'dns-zone-editor' }, ...head,
    el('div', { class: 'grid3' }, field(t('dnsm.zone.ns'), ns)),
    el('div', { class: 'actions' }, button(t('dnsm.ed.saveNs'), () => commit(server, app, msg, setZoneNs(server.services.dns, z.name, ns.value, ymdOf(server.clock.now()))), 'btn btn-quiet')),
    recordsTable(server, app, msg, z, true),
    ...recordForm(server, app, msg, z),
    el('h4', {}, t('dnsm.ed.check')),
    problems.length ? el('ul', { class: 'dns-problems' }, ...problems.map((p) => el('li', {}, p))) : el('p', { class: 'muted' }, t('dnsm.ed.ok')));
}

export function authoritativeBody(server: Server, app: AfterChange, msg: Msg, ui: ZoneUi): HTMLElement[] {
  const s = server.services.dns;
  const zones = servedZones({ ...s, authoritative: true });
  const selected = zones.find((z) => z.zone.name === ui.selected);
  return [
    s.authoritative === false ? el('p', { class: 'dns-mode-lock' }, t('dnsm.zone.off')) : null,
    el('h4', {}, t('dnsm.zone.list')),
    zoneList(server, app, msg, ui, zones),
    el('p', { class: 'muted dns-auto-info' }, t('dnsm.zone.autoInfo')),
    wizard(server, app, msg, ui),
    selected ? zoneEditor(server, app, msg, selected) : el('p', { class: 'muted' }, t('dnsm.wiz.help4')),
  ].filter((x): x is HTMLElement => x !== null);
}
