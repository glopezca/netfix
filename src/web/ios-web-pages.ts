/** Pages of the IOS HTTP server: frame, home page, EXEC monitor (keyword help as links) and configure. */
import type { IosDevice, ModeName } from '../ios/device.ts';
import { Session } from '../ios/session.ts';
import { MAX_PRIVILEGE } from '../ios/http.ts';
import { h, page } from './html.ts';
import type { Child, Markup } from './html.ts';

export type Transcript = readonly { readonly prompt: string; readonly command: string; readonly output: readonly string[] }[];

const enc = (words: readonly string[]): string => words.map(encodeURIComponent).join('/');

function model(device: IosDevice): string {
  return device.kind === 'router' ? 'router' : 'switch';
}

export function frame(device: IosDevice, title: string, body: readonly Child[]): string {
  const nav: [string, string][] = [['/', 'Home'], ['/level/15/exec/-', 'Monitor'], ['/level/15/configure/-', 'Configure'], ['/level/15/dm', 'Device Manager']];
  return page(title, 'web-ios',
    h('div', { class: 'web-ios-top' }, h('span', { class: 'web-ios-logo' }, 'cisco'), h('span', { class: 'web-ios-host' }, `${device.hostname} · ${device.model}`)),
    h('div', { class: 'web-ios-nav' }, nav.map(([href, label]) => h('a', { href }, label))),
    h('div', { class: 'web-ios-main' }, body),
    h('p', { class: 'web-brand-foot' }, h('span', { class: 'web-brand-iso' }, 'Netfix'), 'Servidor HTTP de IOS emulado por Netfix'));
}

export function homePage(device: IosDevice, level: number): Markup {
  const levels = Array.from({ length: level + 1 }, (_, i) => i);
  const item = (href: string, label: string, text: string): Markup => h('li', {}, h('a', { href }, label), ` - ${text}`);
  return h('div', {},
    h('h1', {}, 'Cisco Systems'),
    h('h2', {}, `Accessing Cisco ${device.model} "${device.hostname}"`),
    h('ul', { class: 'web-ios-home' },
      item('/level/15/exec/-/show/interfaces/CR', 'Show interfaces', 'display the status of the interfaces.'),
      item('/level/15/exec/-/show/running-config/CR', 'Show running-config', 'display the current configuration.'),
      h('li', {}, h('a', { href: `/level/${level}/exec/-` }, `Monitor the ${model(device)}`), ' - HTML access to the command line interface at level ',
        levels.map((n, i) => [i ? ',' : '', h('a', { href: `/level/${n}/exec/-` }, String(n))])),
      level >= MAX_PRIVILEGE ? item('/level/15/configure/-', 'Configure', 'send configuration commands, one per line.') : null,
      level >= MAX_PRIVILEGE ? item('/level/15/dm', 'Device Manager', 'port status and quick port settings.') : null,
      item(`/level/${level}/exec/-/ping`, 'Extended Ping', 'send ping commands.')));
}

function helpList(device: IosDevice, level: number, base: string, words: readonly string[]): Markup {
  const s = new Session(device);
  s.mode = (level >= MAX_PRIVILEGE ? 'exec' : 'user') as ModeName;
  const lines = s.help(words.length ? `${words.join(' ')} ` : '');
  const rows = lines.map((line) => {
    const m = /^\s*(\S+)\s*(.*)$/.exec(line);
    const kw = m?.[1] ?? '';
    const text = m?.[2] ?? '';
    if (kw === '<cr>') return h('li', {}, h('a', { href: `${base}/${enc([...words, 'CR'])}` }, 'CR'), ' - run the command');
    if (kw === '|' || kw.startsWith('%')) return null;
    if (/^[a-z][\w-]*$/.test(kw)) return h('li', {}, h('a', { href: `${base}/${enc([...words, kw])}` }, kw), text ? ` - ${text}` : '');
    return h('li', {}, h('code', {}, kw), text ? ` - ${text}` : '');
  });
  return h('ul', { class: 'web-ios-help' }, rows);
}

function transcript(t: Transcript): Markup {
  return h('pre', { class: 'web-ios-out' }, t.map((r) => [`${r.prompt}${r.command}\n`, r.output.length ? `${r.output.join('\n')}\n` : '']));
}

export function execPage(device: IosDevice, level: number, base: string, url: string, command: string, ran: Transcript | null): Markup {
  return h('div', {},
    h('h3', {}, `Command base-URL was: ${base}`),
    h('h3', {}, `Complete URL was: ${url}`),
    ran ? [h('h3', {}, `Command was: ${command}`), transcript(ran)] : helpList(device, level, base, command ? command.split(/\s+/) : []),
    h('form', { action: base, method: 'get', class: 'web-ios-form' },
      h('label', {}, 'Command ', h('input', { type: 'text', name: 'command', size: 60, value: command })),
      h('button', { type: 'submit' }, 'Run')));
}

export function configurePage(ran: Transcript | null): Markup {
  return h('div', {},
    h('h3', {}, 'Configure - enter configuration commands, one per line.'),
    ran ? transcript(ran) : null,
    h('form', { action: '/level/15/configure/-', method: 'post', class: 'web-ios-form' },
      h('textarea', { name: 'command', rows: 10, cols: 70, placeholder: 'interface GigabitEthernet0/1\n description Enlace\n no shutdown' }),
      h('p', {}, h('button', { type: 'submit' }, 'Send'))));
}
