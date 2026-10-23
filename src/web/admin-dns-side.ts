/**
 * Side of the DNS page: the BIND configuration exactly as /etc/bind has it (options, zone list, zone files), an
 * explanation of each part in plain words, and how the modes combine.
 */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Child, Markup } from './html.ts';
import type { DnsMode } from '../services/dns-edit.ts';
import { listenChoices } from '../services/listen.ts';
import { bindFiles, NAMED_LOCAL } from '../services/bind-files.ts';
import { NAMED_OPTIONS, DEFAULT_MAX_CACHE_TTL, iterates } from '../services/named-options.ts';
import { rnameToEmail, servedZones } from '../services/dns-zones.ts';
import { forwardersText } from '../services/dns-recursion.ts';
import { dnsLink } from './admin-dns-links.ts';
import type { Query } from './admin-dns-links.ts';

type FileTab = 'options' | 'local' | 'zones';
const FILE_TABS: readonly FileTab[] = ['options', 'local', 'zones'];

/** One span per line (the CSS numbers them); comments get their own colour. */
function codeLines(text: string): Markup {
  const lines = text.replace(/\n$/, '').split('\n').map((l) => h('span', { class: /^\s*(\/\/|;)/.test(l) ? 'web-adm-line web-adm-cm' : 'web-adm-line' }, l));
  return h('pre', { class: 'web-adm-code' }, lines);
}

function fileText(server: Server, tab: FileTab): string {
  const files = bindFiles(server.services.dns, listenChoices(server, true));
  if (tab === 'options') return files.get(NAMED_OPTIONS) ?? '';
  if (tab === 'local') return `// ${NAMED_LOCAL}\n${files.get(NAMED_LOCAL) ?? ''}`;
  const zones = [...files].filter(([p]) => p.startsWith('/etc/bind/db.'));
  return zones.length ? zones.map(([p, c]) => `; ${p}\n${c}`).join('\n') : `; ${t('wad.ex.noZones')}`;
}

function generated(server: Server, base: string, q: Query, mode: DnsMode): Markup {
  const tab = FILE_TABS.find((f) => f === q.get('file')) ?? 'options';
  const tabs = FILE_TABS.map((f) => h('li', { class: f === tab ? 'web-adm-on' : undefined },
    h('a', { href: dnsLink(base, { mode, zone: q.get('zone'), file: f }) }, t(f === 'options' ? 'wad.file.options' : f === 'local' ? 'wad.file.local' : 'wad.file.zones'))));
  return h('section', { class: 'web-adm-card web-adm-generated' },
    h('header', { class: 'web-adm-card-head' }, h('h2', {}, t('wad.generated'))),
    h('ul', { class: 'web-adm-filetabs' }, tabs),
    codeLines(fileText(server, tab)));
}

const item = (title: string, text: string): Markup => h('details', { class: 'web-adm-explain-item' }, h('summary', {}, title), h('p', {}, text));

function explanation(server: Server): Child[] {
  const s = server.services.dns;
  const allow = s.allowRecursion === 'any' ? 'any' : 'localnets; localhost';
  const fwd = forwardersText(s);
  const ttl = s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL;
  const zones = servedZones(s).map(({ zone: z, auto }) => item(t('wad.ex.t.zone', { kind: t(z.kind === 'reverse' ? 'zone.kind.reverse' : 'zone.kind.forward'), name: z.name }),
    `${t('wad.ex.zone', { mname: z.soa.mname, mail: rnameToEmail(z.soa.rname), serial: z.soa.serial, ns: z.ns.join(', '), count: z.records.length })}${auto ? ` ${t('wad.ex.zoneAuto')}` : ''}`));
  return [
    item(t('wad.ex.t.recursion'), s.recursion === true ? t('wad.ex.recursionYes', { allow }) : t('wad.ex.recursionNo')),
    fwd ? item(t('wad.ex.t.forward', { mode: s.forwardOnly === false ? 'first' : 'only' }), `${t('wad.ex.forwarders', { list: fwd })} ${t(s.forwardOnly === false ? 'wad.ex.first' : 'wad.ex.only')}`) : null,
    item(t('wad.ex.t.iterative'), iterates(s) ? t('wad.ex.iterativeOn') : t('wad.ex.iterativeOff')),
    item(t('wad.ex.t.cache'), ttl > 0 ? t('wad.ex.cacheOn', { ttl }) : t('wad.ex.cacheOff')),
    ...(zones.length ? zones : [h('p', { class: 'web-adm-muted' }, t('wad.ex.noZones'))]),
  ];
}

export function dnsSide(server: Server, base: string, q: Query, mode: DnsMode): Markup {
  return h('aside', { class: 'web-adm-dns-side' },
    generated(server, base, q, mode),
    h('section', { class: 'web-adm-card web-adm-explain' }, h('header', { class: 'web-adm-card-head' }, h('h2', {}, t('wad.explain'))), explanation(server)),
    h('section', { class: 'web-adm-compat' }, h('h2', {}, t('wad.compat')), h('p', {}, t('wad.compatText'))));
}
