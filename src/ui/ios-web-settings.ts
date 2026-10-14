/**
 * Router/switch → «Gestión web»: turns the IOS HTTP server on/off, picks its port and how users log in.
 * Every change is applied as the equivalent IOS commands (shown in the tab), as if typed in the CLI.
 */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, button, message, select, table } from './forms.ts';
import { livePanel } from './server-dhcp-dns.ts';
import type { IosDevice } from '../ios/device.ts';
import { applyConfig } from '../ios/session.ts';
import { DEFAULT_HTTP_PORT, MAX_PRIVILEGE } from '../ios/http.ts';
import type { LocalUser } from '../ios/http.ts';
import { effectiveAddress } from '../ios/commands/show-iface.ts';
import { formatIp } from '../core/ip.ts';

const MAX_PORT = 65535;
const USER = /^[A-Za-z0-9._-]{1,32}$/;

function addresses(device: IosDevice): string[] {
  return device.sortedIfaceNames().flatMap((n) => {
    const cfg = device.iface(n);
    const a = cfg && !cfg.switchport ? effectiveAddress(device, cfg) : undefined;
    return a?.ip !== undefined && !cfg?.shutdown ? [formatIp(a.ip)] : [];
  });
}

function urlOf(device: IosDevice, ip: string): string {
  return device.http.port === DEFAULT_HTTP_PORT ? `http://${ip}/` : `http://${ip}:${device.http.port}/`;
}

/** How to reach the web interface from a PC. */
function howTo(device: IosDevice): HTMLElement[] {
  const urls = addresses(device).map((ip) => urlOf(device, ip));
  return [el('h3', {}, t('iosweb.howTo')),
    el('ul', { class: 'muted' },
      el('li', {}, device.http.server
        ? t('iosweb.fromPc', { urls: urls.join(' · ') || t(device.kind === 'switch' ? 'iosweb.needIpVlan' : 'iosweb.needIp') })
        : t('iosweb.off')),
      el('li', {}, t('iosweb.pages')),
      el('li', {}, t('iosweb.curl')))];
}

export function iosWebSettings(device: IosDevice, afterCommand: () => void): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const apply = (lines: string[]): void => {
      const errors = applyConfig(device, lines);
      device.log('%SYS-5-CONFIG_I: Configured from console by console');
      afterCommand();
      refresh();
      if (errors.length) msg.error(errors.join(' '));
      else msg.ok(t('iosweb.applied', { lines: lines.map((l) => l.replace(/ (secret|password) \S+$/, ' $1 ****')).join(' · ') }));
    };
    const on = el('input', { type: 'checkbox', checked: device.http.server });
    const port = input({ value: String(device.http.port), inputmode: 'numeric', maxlength: '5' });
    const auth = select([['enable', 'enable secret / enable password'], ['local', t('iosweb.authLocal')]], device.http.auth);
    const save = (): void => {
      const n = Number(port.value.trim());
      if (!Number.isInteger(n) || n < 1 || n > MAX_PORT) return msg.error(t('iosweb.badPort'));
      apply([on.checked ? 'ip http server' : 'no ip http server', n === DEFAULT_HTTP_PORT ? 'no ip http port' : `ip http port ${n}`, `ip http authentication ${auth.value === 'local' ? 'local' : 'enable'}`]);
    };
    const name = input({ placeholder: 'admin', maxlength: '32' });
    const pass = input({ type: 'password', placeholder: t('iosweb.passPlaceholder') });
    const addUser = (): void => {
      if (!USER.test(name.value.trim())) return msg.error(t('iosweb.badUser'));
      if (!pass.value || /\s/.test(pass.value)) return msg.error(t('iosweb.badPass'));
      apply([`username ${name.value.trim()} privilege ${MAX_PRIVILEGE} secret ${pass.value}`]);
    };
    const users = table<LocalUser>(device.users, [
      { label: t('iosweb.user'), value: (u) => u.name, mono: true },
      { label: t('iosweb.privilege'), value: (u) => String(u.privilege) },
      { label: t('iosweb.key'), value: (u) => (u.secret !== undefined ? 'secret (hash)' : 'password') },
    ], { empty: t('iosweb.noUsers'), onDelete: (u) => apply([`no username ${u.name}`]) });
    const noEnable = device.http.auth === 'enable' && !device.enableSecret && !device.enablePassword;
    return [
      el('h3', {}, t('iosweb.server')),
      el('label', { class: 'switch-row' }, on, el('span', { class: 'switch-label' }, t('iosweb.toggle'))),
      el('div', { class: 'grid2' },
        field(t('iosweb.port'), port, t('iosweb.portHint', { port: DEFAULT_HTTP_PORT })),
        field(t('iosweb.auth'), auth, 'ip http authentication enable | local')),
      el('div', { class: 'actions' }, button(t('iosweb.apply'), save)),
      msg.el,
      el('p', { class: 'form-msg', 'data-kind': noEnable ? 'error' : '' }, noEnable ? t('iosweb.noEnable') : ''),
      el('h3', {}, t('iosweb.users')),
      users,
      el('div', { class: 'grid2' }, field(t('iosweb.user'), name), field(t('iosweb.password'), pass)),
      el('div', { class: 'actions' }, button(t('iosweb.addUser'), addUser)),
      ...howTo(device),
    ];
  });
}
