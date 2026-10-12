/** Device Manager of the IOS web server: front panel, interface table and quick port settings. */
import type { IosDevice } from '../ios/device.ts';
import { effectiveAddress, ifaceStatus } from '../ios/commands/show-iface.ts';
import { isSubinterface, parseIfaceName } from '../ios/interfaces.ts';
import { formatIp, formatMask, parseIp, parseMask } from '../core/ip.ts';
import { h } from './html.ts';
import type { Markup } from './html.ts';
import type { Transcript } from './ios-web-pages.ts';

const MAX_DESCRIPTION = 240;
const MAX_VLAN = 4094;

export interface DmNotice {
  readonly ran?: Transcript;
  readonly error?: string;
}

function physical(name: string): boolean {
  const type = parseIfaceName(name)?.type;
  return !isSubinterface(name) && type !== 'Vlan' && type !== 'Loopback';
}

function portState(device: IosDevice, name: string): 'up' | 'down' | 'off' {
  if (device.iface(name)?.shutdown) return 'off';
  return device.ifaceRuntime(name).protocolUp ? 'up' : 'down';
}

function panel(device: IosDevice): Markup {
  const ports = device.sortedIfaceNames().filter(physical);
  return h('div', { class: 'web-ios-panel', title: 'Front panel' }, ports.map((p) => {
    const state = portState(device, p);
    return h('span', { class: `web-ios-port web-ios-${state}`, title: `${p}: ${state}` }, p.split('/').at(-1) ?? p);
  }));
}

function addressOf(device: IosDevice, name: string): string {
  const cfg = device.iface(name);
  if (!cfg) return '';
  if (cfg.switchport) return `VLAN ${cfg.switchportMode === 'trunk' ? 'trunk' : cfg.accessVlan}`;
  const a = effectiveAddress(device, cfg);
  return a.ip !== undefined && a.prefix !== undefined ? `${formatIp(a.ip)} ${formatMask(a.prefix)}` : 'unassigned';
}

function ifaceTable(device: IosDevice): Markup {
  const rows = device.sortedIfaceNames().map((n) => {
    const cfg = device.iface(n);
    if (!cfg) return null;
    const st = ifaceStatus(device, cfg);
    return h('tr', {}, h('td', {}, n), h('td', {}, addressOf(device, n)), h('td', {}, st.status), h('td', {}, st.protocol), h('td', {}, cfg.description ?? ''));
  });
  return h('table', { class: 'web-ios-grid' }, h('tr', {}, ['Interface', 'IP address / VLAN', 'Status', 'Protocol', 'Description'].map((c) => h('th', {}, c))), rows);
}

function settingsForm(device: IosDevice): Markup {
  const names = device.sortedIfaceNames();
  const isSwitch = device.kind === 'switch';
  const row = (label: string, control: Markup): Markup => h('tr', {}, h('th', {}, label), h('td', {}, control));
  return h('form', { action: '/level/15/dm', method: 'post', class: 'web-ios-form' },
    h('table', { class: 'web-ios-settings' },
      row('Interface', h('select', { name: 'iface' }, names.map((n) => h('option', { value: n }, n)))),
      row('Description', h('input', { type: 'text', name: 'description', size: 40, maxlength: MAX_DESCRIPTION })),
      row('Administrative state', h('select', { name: 'state' }, h('option', { value: '' }, '(no change)'), h('option', { value: 'up' }, 'Enabled (no shutdown)'), h('option', { value: 'down' }, 'Disabled (shutdown)'))),
      isSwitch ? row('Access VLAN', h('input', { type: 'text', name: 'vlan', size: 6, placeholder: '1-4094' })) : null,
      row('IP address', h('input', { type: 'text', name: 'ip', size: 16, placeholder: isSwitch ? 'SVI only' : 'A.B.C.D' })),
      row('Subnet mask', h('input', { type: 'text', name: 'mask', size: 16, placeholder: '255.255.255.0' }))),
    h('p', {}, h('button', { type: 'submit' }, 'Apply')));
}

export function deviceManager(device: IosDevice, notice: DmNotice | null): Markup {
  return h('div', {},
    h('h2', {}, `Device Manager - ${device.hostname}`),
    notice?.error ? h('p', { class: 'web-ios-error' }, notice.error) : null,
    notice?.ran ? [h('p', { class: 'web-ios-ok' }, 'Configuration applied:'), h('pre', { class: 'web-ios-out' }, notice.ran.map((r) => `${r.prompt}${r.command}\n${r.output.map((l) => `${l}\n`).join('')}`))] : null,
    panel(device),
    h('p', { class: 'web-ios-legend' }, h('span', { class: 'web-ios-port web-ios-up' }, ''), ' up ', h('span', { class: 'web-ios-port web-ios-down' }, ''), ' no link ', h('span', { class: 'web-ios-port web-ios-off' }, ''), ' shutdown'),
    ifaceTable(device),
    h('h3', {}, 'Port Settings'),
    settingsForm(device));
}

/** Builds the configuration lines of the port settings form, or explains what is wrong. */
export function portLines(device: IosDevice, f: ReadonlyMap<string, string>): string[] | string {
  const name = f.get('iface') ?? '';
  const cfg = device.iface(name);
  if (!cfg) return 'Choose an existing interface.';
  const lines = [`interface ${name}`];
  const description = f.get('description')?.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (description) lines.push(` description ${description.slice(0, MAX_DESCRIPTION)}`);
  const vlan = f.get('vlan')?.trim();
  if (vlan) {
    if (!cfg.switchport) return `${name} is not a switch port: it has no access VLAN.`;
    if (!/^\d{1,4}$/.test(vlan) || Number(vlan) < 1 || Number(vlan) > MAX_VLAN) return 'The access VLAN must be a number from 1 to 4094.';
    lines.push(` switchport access vlan ${Number(vlan)}`);
  }
  const ip = f.get('ip')?.trim();
  if (ip) {
    const addr = parseIp(ip);
    const prefix = parseMask((f.get('mask') ?? '').trim());
    if (addr === null || prefix === null) return 'Check the IP address and the subnet mask.';
    if (cfg.switchport) return `${name} is a switch port: give the address to an SVI (interface Vlan).`;
    lines.push(` ip address ${formatIp(addr)} ${formatMask(prefix)}`);
  }
  const state = f.get('state');
  if (state === 'up') lines.push(' no shutdown');
  if (state === 'down') lines.push(' shutdown');
  return lines.length > 1 ? lines : 'Nothing to change.';
}

export function portSettings(device: IosDevice, f: ReadonlyMap<string, string>, apply: (lines: string[]) => Transcript): DmNotice {
  const lines = portLines(device, f);
  return typeof lines === 'string' ? { error: lines } : { ran: apply(lines) };
}
