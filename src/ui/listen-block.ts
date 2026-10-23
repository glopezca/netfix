/**
 * «Interfaces de escucha» of the DHCP (Kea interfaces-config) and DNS (BIND listen-on) panels: one box per interface
 * and «All»; Apply restarts the service, as systemctl restart would after editing the file.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { button, message } from './forms.ts';
import type { AfterChange } from './host-ip.ts';
import type { Server } from '../devices/server.ts';
import { listenChoices, setDhcpInterfaces, setDnsListen } from '../services/listen.ts';

type Service = 'dns' | 'dhcp';

const UNIT: Readonly<Record<Service, string>> = { dns: 'bind9', dhcp: 'kea-dhcp4-server' };

function apply(server: Server, service: Service, list: readonly string[] | undefined, names: readonly string[]): string | null {
  const s = server.services;
  if (service === 'dhcp') {
    const next = setDhcpInterfaces(s, list, names);
    if ('error' in next) return next.error;
    server.setServices(next);
    return null;
  }
  const next = setDnsListen(s.dns, list, names);
  if ('error' in next) return next.error;
  server.setServices({ ...s, dns: next });
  return null;
}

export function listenBlock(server: Server, service: Service, app: AfterChange, shared?: ReturnType<typeof message>): HTMLElement {
  const msg = shared ?? message();
  const choices = listenChoices(server, service === 'dns');
  const current = service === 'dns' ? server.services.dns.listenOn : server.services.dhcp.interfaces;
  const all = el('input', { type: 'checkbox', checked: current === undefined });
  const boxes = choices.map((c) => ({ name: c.name, box: el('input', { type: 'checkbox', checked: current?.includes(c.name) ?? false, disabled: current === undefined }) }));
  all.addEventListener('change', () => boxes.forEach((b) => { b.box.disabled = all.checked; }));
  const unit = UNIT[service];
  const run = (): void => {
    const err = apply(server, service, all.checked ? undefined : boxes.filter((b) => b.box.checked).map((b) => b.name), choices.map((c) => c.name));
    if (err) return msg.error(err);
    msg.ok(t('listen.saved', { unit }));
    app.afterCommand();
  };
  const row = (box: HTMLInputElement, text: string, sub?: string): HTMLElement =>
    el('label', { class: 'check listen-row' }, box, el('span', { class: 'mono' }, text), sub ? el('span', { class: 'muted' }, sub) : null);
  return el('section', { class: 'listen-block' },
    el('h3', {}, t('listen.title')),
    el('p', { class: 'muted' }, t(service === 'dns' ? 'listen.dnsHint' : 'listen.dhcpHint')),
    row(all, t('listen.all')),
    ...boxes.map((b, i) => {
      const c = choices[i];
      return row(b.box, b.name, [c?.port, c?.address ?? t('listen.noAddress')].filter(Boolean).join(' · '));
    }),
    el('div', { class: 'actions' }, button(t('listen.apply', { unit }), run)),
    shared ? null : msg.el);
}
