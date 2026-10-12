/**
 * Router/switch → «Gestión web»: turns the IOS HTTP server on/off, picks its port and how users log in.
 * Every change is applied as the equivalent IOS commands (shown in the tab), as if typed in the CLI.
 */
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

export function iosWebSettings(device: IosDevice, afterCommand: () => void): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const apply = (lines: string[]): void => {
      const errors = applyConfig(device, lines);
      device.log('%SYS-5-CONFIG_I: Configured from console by console');
      afterCommand();
      refresh();
      if (errors.length) msg.error(errors.join(' '));
      else msg.ok(`Aplicado: ${lines.map((l) => l.replace(/ (secret|password) \S+$/, ' $1 ****')).join(' · ')}`);
    };
    const on = el('input', { type: 'checkbox', checked: device.http.server });
    const port = input({ value: String(device.http.port), inputmode: 'numeric', maxlength: '5' });
    const auth = select([['enable', 'enable secret / enable password'], ['local', 'usuarios locales (username)']], device.http.auth);
    const save = (): void => {
      const n = Number(port.value.trim());
      if (!Number.isInteger(n) || n < 1 || n > MAX_PORT) return msg.error('El puerto debe ser un número de 1 a 65535.');
      apply([on.checked ? 'ip http server' : 'no ip http server', n === DEFAULT_HTTP_PORT ? 'no ip http port' : `ip http port ${n}`, `ip http authentication ${auth.value === 'local' ? 'local' : 'enable'}`]);
    };
    const name = input({ placeholder: 'admin', maxlength: '32' });
    const pass = input({ type: 'password', placeholder: 'contraseña' });
    const addUser = (): void => {
      if (!USER.test(name.value.trim())) return msg.error('Usuario: letras, números, punto, guion o guion bajo (máx. 32).');
      if (!pass.value || /\s/.test(pass.value)) return msg.error('Escribe una contraseña sin espacios.');
      apply([`username ${name.value.trim()} privilege ${MAX_PRIVILEGE} secret ${pass.value}`]);
    };
    const users = table<LocalUser>(device.users, [
      { label: 'Usuario', value: (u) => u.name, mono: true },
      { label: 'Privilegio', value: (u) => String(u.privilege) },
      { label: 'Clave', value: (u) => (u.secret !== undefined ? 'secret (hash)' : 'password') },
    ], { empty: 'Sin usuarios locales.', onDelete: (u) => apply([`no username ${u.name}`]) });
    const urls = addresses(device).map((ip) => urlOf(device, ip));
    const noEnable = device.http.auth === 'enable' && !device.enableSecret && !device.enablePassword;
    return [
      el('h3', {}, 'Servidor HTTP del dispositivo'),
      el('label', { class: 'switch-row' }, on, el('span', { class: 'switch-label' }, 'Gestión web (ip http server)')),
      el('div', { class: 'grid2' },
        field('Puerto', port, `Por defecto ${DEFAULT_HTTP_PORT} (ip http port).`),
        field('Autenticación', auth, 'ip http authentication enable | local')),
      el('div', { class: 'actions' }, button('Aplicar', save)),
      msg.el,
      el('p', { class: 'form-msg', 'data-kind': noEnable ? 'error' : '' }, noEnable ? 'Sin enable secret nadie puede entrar: configúralo en la CLI o usa usuarios locales.' : ''),
      el('h3', {}, 'Usuarios locales (privilegio 15)'),
      users,
      el('div', { class: 'grid2' }, field('Usuario', name), field('Contraseña', pass)),
      el('div', { class: 'actions' }, button('Añadir usuario', addUser)),
      el('h3', {}, 'Cómo conectarse'),
      el('ul', { class: 'muted' },
        el('li', {}, device.http.server
          ? `Desde el navegador de un PC: ${urls.join(' · ') || '(asigna antes una IP a una interfaz' + (device.kind === 'switch' ? ' Vlan' : '') + ')'}`
          : 'El servidor está apagado: no escucha en ningún puerto.'),
        el('li', {}, 'Páginas: inicio, Monitor (/level/15/exec/-), Configure (/level/15/configure/-) y Device Manager (/level/15/dm).'),
        el('li', {}, 'También con curl -u usuario:clave desde una terminal GNU/Linux.')),
    ];
  });
}
