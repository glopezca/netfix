/** «Nombres públicos» card of the DNS page: the response policy zone switch, its file and the initial list. */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import { h } from './html.ts';
import type { Markup } from './html.ts';
import { buttons, cards, check, form, section } from './admin-layout.ts';
import { rpzEntries, rpzFile, setPublicNames } from '../services/dns-rpz.ts';

type Fields = ReadonlyMap<string, string>;
const FILE_ROWS = 14;

export function rpzForm(server: Server, base: string): Markup {
  const dns = server.services.dns;
  return h('div', {},
    form(base, 'dns', 'dns-rpz', cards(section(t('rpz.title'), t('rpz.desc'),
      check('enabled', dns.publicNames?.enabled === true, t('rpz.enable')),
      dns.recursion === true ? null : h('p', { class: 'web-adm-help' }, t('rpz.needsRecursion')),
      h('p', { class: 'web-adm-help' }, t('rpz.file', { count: rpzEntries(dns).length })),
      h('textarea', { name: 'list', rows: FILE_ROWS, class: 'web-adm-mono web-adm-file', spellcheck: 'false', wrap: 'off' }, rpzFile(dns)))), buttons(t('rpz.apply'))),
    form(base, 'dns', 'dns-rpz-initial', h('input', { type: 'hidden', name: 'enabled', value: dns.publicNames?.enabled ? '1' : '0' }), buttons(t('rpz.initial'))));
}

/** dns-rpz: switch and list together (a bad list changes nothing); dns-rpz-initial: the initial list back. */
export function rpzAction(server: Server, f: Fields, initial: boolean): { ok?: string; error?: string } {
  const enabled = f.get('enabled') === '1';
  const next = setPublicNames(server.services.dns, enabled, initial ? 'initial' : f.get('list') ?? '');
  if ('error' in next) return { error: next.error };
  server.setServices({ ...server.services, dns: next });
  server.dns.forwarder.flush();
  return { ok: t(initial ? 'rpz.restored' : 'rpz.saved') };
}
