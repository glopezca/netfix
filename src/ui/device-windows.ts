/** Window contents: IOS CLI for routers/switches, Desktop (IP config + prompt) for PCs. */
import { el } from './dom.ts';
import { Terminal } from './terminal.ts';
import type { ConsoleBackend } from './terminal.ts';
import type { WindowManager } from './windows.ts';
import { Session } from '../ios/session.ts';
import type { IosDevice } from '../ios/device.ts';
import { Pc } from '../devices/pc.ts';
import { pcCommand } from '../devices/pc-console.ts';
import type { Placed } from '../net/topology.ts';
import { formatIp, formatMask, parseIp, parseMask } from '../core/ip.ts';
import { formatMacCisco, formatHexId, clientIdFromMac } from '../core/mac.ts';

const DHCP_WAIT_MS = 20_000;

export interface WindowHost {
  readonly windows: WindowManager;
  afterCommand(): void;
}

const terminals = new Map<string, Terminal>();

function iosBackend(device: IosDevice, session: Session): ConsoleBackend {
  return {
    prompt: () => session.prompt(),
    run: (l) => session.input(l),
    help: (l) => session.help(l),
    complete: (l) => session.complete(l),
    ctrlZ: () => session.ctrlZ(),
    secret: () => session.isSecretInput(),
    onAsync: (cb) => device.onConsole(cb),
  };
}

function iosIntro(device: IosDevice): string[] {
  const image = device.kind === 'router' ? 'C2900-UNIVERSALK9-M' : 'C2960-LANBASEK9-M';
  return [
    `Cisco IOS Software, ${image}, RELEASE SOFTWARE (fc2)`,
    'Copyright (c) 1986-2012 by Cisco Systems, Inc.',
    '',
  ];
}

function cliTerminal(placed: Placed, host: WindowHost): Terminal {
  const device = placed.device as IosDevice;
  let term = terminals.get(placed.device.id);
  if (!term) {
    const session = new Session(device, { initialDialog: device.kind === 'router' });
    const intro = [...iosIntro(device), ...session.banner()];
    if (device.kind !== 'router') intro.push('Press RETURN to get started!', '');
    term = new Terminal(iosBackend(device, session), { intro, label: `Consola de ${placed.label}`, afterRun: () => host.afterCommand() });
    terminals.set(placed.device.id, term);
  }
  return term;
}

export function forgetDevice(id: string): void {
  terminals.get(id)?.dispose();
  terminals.delete(id);
  terminals.delete(`${id}:pc`);
}

export function forgetAll(): void {
  for (const t of terminals.values()) t.dispose();
  terminals.clear();
}

export function openDeviceWindow(placed: Placed, host: WindowHost): void {
  const d = placed.device;
  const title = d instanceof Pc ? placed.label : `${placed.label} · ${d.hostname}`;
  if (d instanceof Pc) {
    let dispose = (): void => undefined;
    host.windows.show(d.id, placed.label, [
      { id: 'ip', label: 'Configuración IP', render: () => { const v = pcIpConfig(d, host); dispose = v.dispose; return v.root; } },
      { id: 'cmd', label: 'Símbolo del sistema', render: () => pcPrompt(placed, host).root, onShow: () => pcPrompt(placed, host).focus() },
    ], () => dispose());
    return;
  }
  const term = cliTerminal(placed, host);
  host.windows.show(d.id, title, [{ id: 'cli', label: 'CLI', render: () => term.root, onShow: () => term.focus() }]);
}

// ---------------------------------------------------------------- PC

function pcPrompt(placed: Placed, host: WindowHost): Terminal {
  const pc = placed.device as Pc;
  const key = `${pc.id}:pc`;
  let term = terminals.get(key);
  if (!term) {
    term = new Terminal({ prompt: () => 'C:\\>', run: (l) => pcCommand(pc, l) }, {
      intro: ['Packet Tracer PC Command Line 1.0', 'Escribe help para ver los comandos.', ''],
      label: `Símbolo del sistema de ${placed.label}`,
      afterRun: () => host.afterCommand(),
    });
    terminals.set(key, term);
  }
  return term;
}

function field(label: string, input: HTMLInputElement, hint?: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input, hint ?? null);
}

function copyRow(label: string, value: string, help: string): HTMLElement {
  const btn = el('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': `Copiar ${label}` }, 'Copiar');
  btn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(value).then(() => { btn.textContent = 'Copiado'; }, () => { btn.textContent = 'No disponible'; });
  });
  return el('div', { class: 'id-row' },
    el('div', {}, el('span', { class: 'field-label' }, label), el('code', { class: 'id-value' }, value), el('p', { class: 'id-help' }, help)), btn);
}

function pcIpConfig(pc: Pc, host: WindowHost): { root: HTMLElement; dispose: () => void } {
  const dhcpRadio = el('input', { type: 'radio', name: `mode-${pc.id}`, value: 'dhcp' });
  const staticRadio = el('input', { type: 'radio', name: `mode-${pc.id}`, value: 'static' });
  const inputs = {
    ip: el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' }),
    mask: el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' }),
    gw: el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' }),
    dns: el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off' }),
  };
  const status = el('p', { class: 'status', role: 'status' });
  const error = el('p', { class: 'form-error', role: 'alert' });
  const sendId = el('input', { type: 'checkbox' });
  sendId.checked = pc.sendClientId;
  const idsBox = el('div', { class: 'ids' });

  const renderIds = (): void => {
    idsBox.replaceChildren(
      copyRow('MAC', formatMacCisco(pc.mac), 'Para «hardware-address» y «address … hardware-address».'),
      copyRow('Client-ID (opción 61)', formatHexId(clientIdFromMac(pc.mac)), pc.sendClientId
        ? 'Para «client-identifier» y «address … client-id».'
        : 'No se envía: el servidor identificará al PC por su MAC.'),
    );
  };

  const fill = (): void => {
    const c = pc.config;
    dhcpRadio.checked = c.mode === 'dhcp';
    staticRadio.checked = c.mode === 'static';
    inputs.ip.value = c.ip !== undefined ? formatIp(c.ip) : '';
    inputs.mask.value = c.prefix !== undefined ? formatMask(c.prefix) : '';
    inputs.gw.value = c.gateway !== undefined ? formatIp(c.gateway) : '';
    inputs.dns.value = c.dns !== undefined ? formatIp(c.dns) : '';
    for (const i of Object.values(inputs)) i.disabled = c.mode === 'dhcp';
    status.textContent = c.mode !== 'dhcp' ? '' : {
      idle: '', requesting: 'Solicitando dirección IP…', ok: 'Solicitud DHCP correcta.', failed: 'La solicitud DHCP ha fallado. Se usa APIPA.',
    }[pc.dhcpStatus];
    status.dataset.state = pc.dhcpStatus;
    renderIds();
  };

  const applyStatic = (): void => {
    const read = (i: HTMLInputElement): number | undefined | null => (i.value.trim() === '' ? undefined : parseIp(i.value.trim()));
    const ip = read(inputs.ip);
    const gw = read(inputs.gw);
    const dns = read(inputs.dns);
    const mask = inputs.mask.value.trim() === '' ? undefined : parseMask(inputs.mask.value.trim());
    const bad = ip === null ? 'la dirección IP' : mask === null ? 'la máscara' : gw === null ? 'la puerta de enlace' : dns === null ? 'el servidor DNS' : '';
    error.textContent = bad ? `Revisa ${bad}: usa el formato 192.168.1.10.` : '';
    if (bad) return;
    const prefix = mask ?? (ip !== undefined && ip !== null ? defaultMask(ip) : undefined);
    pc.setStatic({ ip: ip ?? undefined, prefix, gateway: gw ?? undefined, dns: dns ?? undefined });
    host.afterCommand();
    fill();
  };

  dhcpRadio.addEventListener('change', () => {
    error.textContent = '';
    pc.useDhcp();
    fill();
    pc.hooks.runUntil(() => pc.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    host.afterCommand();
    fill();
  });
  staticRadio.addEventListener('change', () => applyStatic());
  for (const i of Object.values(inputs)) i.addEventListener('change', () => applyStatic());
  sendId.addEventListener('change', () => { pc.sendClientId = sendId.checked; host.afterCommand(); renderIds(); });
  const unsub = pc.onChange(fill);
  const root = el('div', { class: 'pc-ip' },
    el('fieldset', { class: 'mode' }, el('legend', {}, 'Configuración IPv4'),
      el('label', { class: 'radio' }, dhcpRadio, 'DHCP'), el('label', { class: 'radio' }, staticRadio, 'Estática')),
    status,
    el('div', { class: 'grid2' },
      field('Dirección IPv4', inputs.ip), field('Máscara de subred', inputs.mask),
      field('Puerta de enlace', inputs.gw), field('Servidor DNS', inputs.dns)),
    error,
    el('label', { class: 'check' }, sendId, 'Enviar identificador de cliente (opción 61), como Windows'),
    idsBox,
  );
  fill();
  return { root, dispose: unsub };
}

function defaultMask(ip: number): number {
  const first = ip >>> 24;
  return first < 128 ? 8 : first < 192 ? 16 : 24;
}
