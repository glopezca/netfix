/**
 * «Interfaces de escucha» card of the DHCP and DNS pages (Kea interfaces-config, BIND listen-on). The simulated browser
 * runs no scripts, so every box stays enabled and «Todas» wins over them.
 */
import { t } from '../i18n/t.ts';
import type { Server } from '../devices/server.ts';
import type { Markup } from './html.ts';
import { buttons, cards, check, form, section } from './admin-layout.ts';
import { listenChoices, setDhcpInterfaces, setDnsListen } from '../services/listen.ts';

type Fields = ReadonlyMap<string, string>;
type Service = 'dns' | 'dhcp';
const UNIT: Readonly<Record<Service, string>> = { dns: 'bind9', dhcp: 'kea-dhcp4-server' };

export function listenForm(server: Server, base: string, service: Service): Markup {
  const current = service === 'dns' ? server.services.dns.listenOn : server.services.dhcp.interfaces;
  const boxes = listenChoices(server, service === 'dns').map((c) =>
    check(`if_${c.name}`, current?.includes(c.name) ?? false, [c.name, c.port, c.address ?? t('listen.noAddress')].filter(Boolean).join(' · ')));
  return form(base, service, `${service}-listen`, cards(section(t('listen.title'), t(service === 'dns' ? 'listen.dnsHint' : 'listen.dhcpHint'),
    check('all', current === undefined, t('listen.all')), ...boxes)), buttons(t('listen.apply', { unit: UNIT[service] })));
}

/** Applies the form: «all» → every interface; otherwise the ticked ones, which must exist. */
export function listenAction(server: Server, service: Service, f: Fields): { ok?: string; error?: string } {
  const names = listenChoices(server, service === 'dns').map((c) => c.name);
  const ticked = [...f.keys()].filter((k) => k.startsWith('if_')).map((k) => k.slice(3));
  const list = f.has('all') ? undefined : ticked;
  const s = server.services;
  const next = service === 'dhcp' ? setDhcpInterfaces(s, list, names) : setDnsListen(s.dns, list, names);
  if ('error' in next) return { error: next.error };
  server.setServices('dns' in next ? next : { ...s, dns: next });
  return { ok: t('listen.saved', { unit: UNIT[service] }) };
}
