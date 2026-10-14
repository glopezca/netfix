/**
 * IOS router / switch → «Interfaces»: state, MAC and far end of every interface, with description, address
 * (routed ports and SVIs), switchport mode and VLAN, and shutdown. Every change is applied as CLI commands,
 * so the running-config and the messages are those of IOS.
 */
import { el } from './dom.ts';
import { button, field, input, message, onOff, select } from './forms.ts';
import type { IosDevice } from '../ios/device.ts';
import type { IfaceConfig } from '../ios/interfaces.ts';
import { isSubinterface } from '../ios/interfaces.ts';
import { Session } from '../ios/session.ts';
import { formatIp, formatMask, parseIp, parseMask } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { t } from '../i18n/t.ts';

const MAX_DESCRIPTION = 200;
const MAX_VLAN = 4094;

export interface IosIfacesHost {
  afterCommand(): void;
  /** «PC0 (FastEthernet0)» at the far end of the cable, if any. */
  peer(port: string): string | undefined;
}

type Msg = ReturnType<typeof message>;

function stateText(d: IosDevice, c: IfaceConfig): string {
  if (c.shutdown) return t('iosif.adminDown');
  const rt = d.ifaceRuntime(c.name);
  return rt.protocolUp ? t('iosif.up') : t('iosif.down');
}

/** Commands for the address of a routed port or SVI; a string is a local validation error. */
export function addressCommands(c: IfaceConfig, ipText: string, maskText: string): string[] | string {
  if (ipText === '' && maskText === '') return c.address ? ['no ip address'] : [];
  const ip = parseIp(ipText);
  if (ip === null) return t('ip.check', { field: t('ip.field.ip') });
  const prefix = parseMask(maskText);
  // A dotted mask with holes goes to IOS as typed: it answers «Bad mask 0x…» like the real one.
  if (prefix === null && parseIp(maskText) === null) return t('ip.checkMask');
  return [`ip address ${formatIp(ip)} ${prefix === null ? maskText : formatMask(prefix)}`];
}

export function switchportCommands(c: IfaceConfig, mode: string, vlanText: string): string[] | string {
  const out = mode !== c.switchportMode ? [`switchport mode ${mode}`] : [];
  if (mode !== 'access') return out;
  // The access VLAN only matters (and is only checked) in access mode.
  const vlan = Number(vlanText);
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > MAX_VLAN) return t('iosif.badVlan');
  return vlan !== c.accessVlan ? [...out, `switchport access vlan ${vlan}`] : out;
}

export interface IfaceForm {
  readonly description: string;
  readonly ip: string;
  readonly mask: string;
  readonly mode: string;
  readonly vlan: string;
}

/** Only the commands for what changed (each one makes IOS redo work: ARP flush, «Creating vlan»…). */
export function changedCommands(c: IfaceConfig, f: IfaceForm): string[] | string {
  const text = f.description.replace(/[\r\n]+/g, ' ').trim();
  const desc = text === (c.description ?? '') ? [] : [text ? `description ${text}` : 'no description'];
  if (c.switchport) {
    const sw = switchportCommands(c, f.mode, f.vlan.trim());
    return typeof sw === 'string' ? sw : [...desc, ...sw];
  }
  const same = c.address ? f.ip.trim() === formatIp(c.address.ip) && parseMask(f.mask.trim()) === c.address.prefix : f.ip.trim() === '' && f.mask.trim() === '';
  const addr = same ? [] : addressCommands(c, f.ip.trim(), f.mask.trim());
  return typeof addr === 'string' ? addr : [...desc, ...addr];
}

/** Real IOS errors among the CLI answers (informational «%» lines such as «Creating vlan 20» are not). */
const IOS_ERROR = /^(%\s?(Invalid|Incomplete|Ambiguous|Unrecognized|Inconsistent)|Bad mask|% .* overlaps with)/;

/**
 * Types the commands in a configuration session, as at the console: unlike applyConfig (which reads a
 * saved configuration), entering an interface does not turn it on. The lines do not go to `show history`
 * (the user did not type them) and leaving logs %SYS-5-CONFIG_I like `end`. Returns what IOS answered.
 */
export function configureIface(d: IosDevice, name: string, sub: readonly string[]): { readonly output: string[]; readonly failed: boolean } {
  const history = [...d.history];
  const session = new Session(d);
  session.mode = 'config';
  const output = [`interface ${name}`, ...sub].flatMap((l) => session.input(l)).filter((l) => l.trim() !== '' && !/^\s+\^$/.test(l));
  session.endConfig();
  d.history.splice(0, d.history.length, ...history);
  return { output, failed: output.some((l) => IOS_ERROR.test(l)) };
}

/** Cabled ports only: subinterfaces, SVIs and loopbacks have no cable nor MAC of their own here. */
function physical(name: string): boolean {
  return !isSubinterface(name) && !/^(Vlan|Loopback|Tunnel)/.test(name);
}

interface RowCtx {
  readonly d: IosDevice;
  readonly host: IosIfacesHost;
  readonly msg: Msg;
}

function ifaceRow(x: RowCtx, c: IfaceConfig): HTMLElement {
  const { d, host, msg } = x;
  const desc = input({ value: c.description ?? '', maxlength: String(MAX_DESCRIPTION), 'aria-label': `${t('iosif.description')} ${c.name}` });
  const ip = input({ inputmode: 'decimal', value: c.address ? formatIp(c.address.ip) : '', 'aria-label': `${t('router.address')} ${c.name}` });
  const mask = input({ inputmode: 'decimal', value: c.address ? formatMask(c.address.prefix) : '', 'aria-label': `${t('router.mask')} ${c.name}` });
  const mode = select([['access', 'access'], ['trunk', 'trunk'], ['dynamic auto', 'dynamic auto']], c.switchportMode);
  const vlan = input({ inputmode: 'numeric', value: String(c.accessVlan), 'aria-label': `VLAN ${c.name}` });
  // Only this row is drawn again, and only when IOS accepted the change: a rejected value stays as typed.
  const send = (sub: readonly string[]): void => {
    if (!sub.length) return msg.ok(t('iosif.nothing', { name: c.name }));
    const r = configureIface(d, c.name, sub);
    host.afterCommand();
    if (r.failed) return msg.error(r.output.join(' '));
    const fresh = d.iface(c.name);
    if (fresh) row.replaceWith(ifaceRow(x, fresh));
    msg.ok([t('iosif.applied', { name: c.name }), ...r.output].join(' '));
  };
  const apply = (): void => {
    const cmds = changedCommands(c, { description: desc.value, ip: ip.value, mask: mask.value, mode: mode.value, vlan: vlan.value });
    if (typeof cmds === 'string') return msg.error(cmds);
    send(cmds);
  };
  const peer = physical(c.name) ? host.peer(c.name) : undefined;
  const details = physical(c.name) ? `${stateText(d, c)} · ${formatMacCisco(d.ifaceRuntime(c.name).mac)}` : stateText(d, c);
  const row = el('div', { class: 'nic-row' },
    el('div', { class: 'nic-name' }, el('strong', { class: 'mono' }, c.name), el('span', { class: 'mono muted' }, details),
      ...(physical(c.name) ? [el('span', { class: 'muted' }, peer ? t('iosif.peer', { peer }) : t('router.noCable'))] : [])),
    field(t('iosif.description'), desc),
    ...(c.switchport
      ? [el('div', { class: 'grid2' }, field(t('iosif.mode'), mode), field('VLAN', vlan))]
      : [el('div', { class: 'grid2' }, field(t('router.address'), ip), field(t('router.mask'), mask))]),
    el('div', { class: 'nic-actions' }, onOff(t('iosif.port'), !c.shutdown, (on) => send([on ? 'no shutdown' : 'shutdown'])), button(t('router.apply'), apply)));
  return row;
}

export interface IosIfacesPanel {
  readonly root: HTMLElement;
  /** Draws it again (the CLI may have changed the interfaces). */
  refresh(): void;
}

export function iosInterfaces(d: IosDevice, host: IosIfacesHost): IosIfacesPanel {
  const msg = message();
  const list = el('div', { class: 'nic-list' });
  const draw = (): void => {
    list.replaceChildren(...[...d.ifaces.values()].map((c) => ifaceRow({ d, host, msg }, c)));
  };
  draw();
  const root = el('div', { class: 'pane' }, el('p', { class: 'muted' }, t('iosif.intro')), msg.el, list);
  return { root, refresh: () => { msg.clear(); draw(); } };
}
