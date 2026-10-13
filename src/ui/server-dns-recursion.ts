/** Server → Services → DNS: forwarders, forward only/first, allow-recursion and the cache. */
import { el } from './dom.ts';
import { field, input, select, button, message } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import { applyRecursion, forwardersText, GOOGLE_FORWARDERS } from '../services/dns-recursion.ts';
import { t } from '../i18n/t.ts';

export function recursionForm(server: Server, app: AfterChange, refresh: () => void): HTMLElement[] {
  const s = server.services.dns;
  const fwd = input({ value: forwardersText(s), placeholder: GOOGLE_FORWARDERS, inputmode: 'decimal', autocomplete: 'off' });
  const mode = select([['only', t('dns.rec.only')], ['first', t('dns.rec.first')]], s.forwardOnly === false ? 'first' : 'only');
  const allow = select([['localnets', t('dns.rec.localnets')], ['any', t('dns.rec.any')]], s.allowRecursion ?? 'localnets');
  const msg = message();
  const save = (): void => {
    const next = applyRecursion(server.services.dns, { forwarders: fwd.value, forwardOnly: mode.value !== 'first', allowRecursion: allow.value === 'any' ? 'any' : 'localnets' });
    if ('error' in next) return msg.error(next.error);
    server.setServices({ ...server.services, dns: next });
    server.dns.forwarder.flush();
    app.afterCommand();
    refresh();
  };
  return [
    el('h3', {}, t('dns.rec.title')),
    el('p', { class: 'muted' }, t('dns.rec.help')),
    el('div', { class: 'grid3' },
      field(t('dns.rec.forwarders'), fwd, t('dns.rec.forwardersHint')),
      field(t('dns.rec.mode'), mode),
      field(t('dns.rec.allow'), allow)),
    el('div', { class: 'actions' },
      button(t('dns.rec.save'), save),
      button(t('dns.rec.google'), () => { fwd.value = GOOGLE_FORWARDERS; save(); }),
      button(t('dns.rec.flush'), () => { server.dns.forwarder.flush(); refresh(); })),
    msg.el,
    el('p', { class: 'muted' }, t('dns.rec.cache', { count: server.dns.forwarder.cacheSize() })),
  ];
}
