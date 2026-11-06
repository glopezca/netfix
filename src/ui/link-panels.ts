/**
 * Servicios → mDNS (avahi-daemon) and Servicios → winbind of a GNU/Linux device with those packages: the daemon on or
 * off, and what each one is configured with (the name avahi publishes and whether it publishes; «wins» in
 * /etc/nsswitch.conf). Done as root would do it (shells/link-services.ts); the files are in Configuración.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { button, field, input, message, onOff } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { avahiConfig } from '../net/avahi.ts';
import { avahiSettings, setAvahiSettings, setUnitRunning, setWinsLookup, unitOn, winsLookupOn } from '../shells/link-services.ts';

export function mdnsPanel(host: Host, app: AfterChange): LivePanel {
  const msg = message();
  return liveHostPanel(host, () => {
    const running = unitOn(host, 'avahi-daemon');
    const conf = avahiSettings(host);
    const name = input({ value: conf.hostName, placeholder: host.runtimeName().toLowerCase(), 'aria-label': t('mdns.name') });
    const publish = el('input', { type: 'checkbox', checked: conf.publish });
    const apply = (): void => {
      if (!setAvahiSettings(host, { hostName: name.value, publish: publish.checked })) return msg.error(t('mdns.badName'));
      msg.ok(t('mdns.applied'));
      app.afterCommand();
    };
    const live = avahiConfig(host);
    const now = !running ? t('mdns.stopped') : live.publish ? t('mdns.publishing', { name: `${live.hostName || host.runtimeName().toLowerCase()}.local` }) : t('mdns.silent');
    return [
      onOff(t('mdns.service'), running, (on) => { setUnitRunning(host, 'avahi-daemon', on); app.afterCommand(); }),
      el('p', { class: 'muted' }, t('mdns.intro')),
      el('p', {}, now),
      msg.el,
      el('div', { class: 'inline-form' }, field(t('mdns.name'), name)),
      el('label', { class: 'check' }, publish, ` ${t('mdns.publish')}`),
      el('div', { class: 'actions' }, button(t('mdns.apply'), apply)),
      el('p', { class: 'muted' }, t('mdns.hint')),
    ];
  });
}

export function winbindPanel(host: Host, app: AfterChange): LivePanel {
  return liveHostPanel(host, () => {
    const nss = hasPackage(host, 'libnss-winbind');
    const wins = el('input', { type: 'checkbox', checked: winsLookupOn(host), disabled: !nss });
    wins.addEventListener('change', () => { setWinsLookup(host, wins.checked); app.afterCommand(); });
    return [
      onOff(t('wbd.service'), unitOn(host, 'winbind'), (on) => { setUnitRunning(host, 'winbind', on); app.afterCommand(); }),
      el('p', { class: 'muted' }, t('wbd.intro')),
      el('label', { class: 'check' }, wins, ` ${t('wbd.wins')}`),
      el('p', { class: 'muted' }, nss ? t('wbd.winsHint') : t('wbd.noNss')),
    ];
  });
}
