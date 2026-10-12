/** "Configuración IP" tab for PCs and servers. */
import { el } from './dom.ts';
import { field, copyRow, input, message } from './forms.ts';
import type { Host } from '../devices/host.ts';
import { formatIp, formatMask, parseIp, parseMask, classfulPrefix } from '../core/ip.ts';
import { formatMacCisco, formatHexId, parseHexId, asciiToHex } from '../core/mac.ts';

const DHCP_WAIT_MS = 20_000;

export interface AfterChange {
  afterCommand(): void;
}

/** Custom Client-ID (hex or ASCII) and the MAC / option 61 rows to copy into server configs. */
function clientIdSection(h: Host, app: AfterChange, msg: ReturnType<typeof message>): { form: HTMLElement; box: HTMLElement; render: () => void } {
  const box = el('div', { class: 'ids' });
  const customId = input({ placeholder: 'vacío = 01 + MAC', value: h.clientIdOverride ? formatHexId(h.clientIdOverride) : '' });
  const customFmt = el('select', { class: 'select', 'aria-label': 'Formato del Client-ID' }, el('option', { value: 'hex' }, 'Hexadecimal'), el('option', { value: 'ascii' }, 'Texto ASCII'));
  const applyCustomId = (): void => {
    const text = customId.value.trim();
    const hex = text === '' ? undefined : customFmt.value === 'ascii' ? asciiToHex(text) : parseHexId(text);
    if (hex === null) return msg.error('Client-ID no válido: usa hexadecimal (0161.756c.61) o elige «Texto ASCII».');
    msg.clear();
    h.clientIdOverride = hex;
    app.afterCommand();
    render();
  };
  customId.addEventListener('change', applyCustomId);
  customFmt.addEventListener('change', applyCustomId);

  const render = (): void => {
    box.replaceChildren(
      copyRow('MAC', formatMacCisco(h.mac), 'Para «hardware-address» y las reservas por MAC.'),
      copyRow('Client-ID (opción 61)', formatHexId(h.clientId() ?? ''), h.sendClientId ? 'Para «client-identifier», «address … client-id» y las reservas por Client-ID.' : 'No se envía: el servidor identificará al equipo por su MAC.'),
    );
  };

  const form = el('div', { class: 'grid2' }, field('Client-ID personalizado (como «send dhcp-client-identifier»)', customId), field('Formato', customFmt));
  return { form, box, render };
}

type IpInputs = Readonly<Record<'ip' | 'mask' | 'gw' | 'dns', HTMLInputElement>>;

/** Static configuration from the form, or the message for the first invalid field. */
function readStatic(inputs: IpInputs): { ip?: number; prefix?: number; gateway?: number; dns?: number } | string {
  const read = (i: HTMLInputElement): number | undefined | null => (i.value.trim() === '' ? undefined : parseIp(i.value.trim()));
  const ip = read(inputs.ip);
  const gw = read(inputs.gw);
  const dns = read(inputs.dns);
  const mask = inputs.mask.value.trim() === '' ? undefined : parseMask(inputs.mask.value.trim());
  const bad = ip === null ? 'la dirección IP' : mask === null ? 'la máscara' : gw === null ? 'la puerta de enlace' : dns === null ? 'el servidor DNS' : '';
  if (bad) return `Revisa ${bad}: usa el formato 192.168.1.10.`;
  const prefix = mask ?? (ip !== undefined && ip !== null ? classfulPrefix(ip) : undefined);
  return { ip: ip ?? undefined, prefix, gateway: gw ?? undefined, dns: dns ?? undefined };
}

const DHCP_TEXT: Readonly<Record<Host['dhcpStatus'], string>> = { idle: '', requesting: 'Solicitando dirección IP…', ok: 'Solicitud DHCP correcta.', failed: 'La solicitud DHCP ha fallado. Se usa APIPA.' };

interface Parts {
  readonly dhcpRadio: HTMLInputElement;
  readonly staticRadio: HTMLInputElement;
  readonly status: HTMLElement;
  readonly inputs: IpInputs;
  readonly msg: HTMLElement;
  readonly sendId: HTMLInputElement;
  readonly osSel: HTMLSelectElement;
  readonly ids: { readonly form: HTMLElement; readonly box: HTMLElement };
}

function layout(p: Parts): HTMLElement {
  const { dhcpRadio, staticRadio, status, inputs, sendId, osSel, ids } = p;
  return el('div', { class: 'pane' },
    el('fieldset', { class: 'mode' }, el('legend', {}, 'Configuración IPv4'),
      el('label', { class: 'radio' }, dhcpRadio, 'DHCP'), el('label', { class: 'radio' }, staticRadio, 'Estática')),
    status,
    el('div', { class: 'grid2' }, field('Dirección IPv4', inputs.ip), field('Máscara de subred', inputs.mask), field('Puerta de enlace', inputs.gw), field('Servidor DNS', inputs.dns)),
    p.msg,
    el('label', { class: 'check' }, sendId, 'Enviar identificador de cliente (opción 61), como Windows'),
    ids.form,
    field('Sistema operativo (servicios y banner SSH)', osSel),
    ids.box,
  );
}

export function hostIpConfig(h: Host, app: AfterChange): { root: HTMLElement; dispose: () => void } {
  const name = `mode-${h.id}`;
  const dhcpRadio = el('input', { type: 'radio', name, value: 'dhcp' });
  const staticRadio = el('input', { type: 'radio', name, value: 'static' });
  const inputs: IpInputs = { ip: input({ inputmode: 'decimal' }), mask: input({ inputmode: 'decimal' }), gw: input({ inputmode: 'decimal' }), dns: input({ inputmode: 'decimal' }) };
  const status = el('p', { class: 'status', role: 'status' });
  const msg = message();
  const sendId = el('input', { type: 'checkbox', checked: h.sendClientId });
  const osSel = el('select', { class: 'select' }, el('option', { value: 'windows' }, 'Windows'), el('option', { value: 'linux' }, 'GNU/Linux (Ubuntu)'));
  osSel.value = h.os;
  const ids = clientIdSection(h, app, msg);
  const fill = (): void => {
    const c = h.config;
    dhcpRadio.checked = c.mode === 'dhcp';
    staticRadio.checked = c.mode === 'static';
    inputs.ip.value = c.ip !== undefined ? formatIp(c.ip) : '';
    inputs.mask.value = c.prefix !== undefined ? formatMask(c.prefix) : '';
    inputs.gw.value = c.gateway !== undefined ? formatIp(c.gateway) : '';
    inputs.dns.value = c.dns !== undefined ? formatIp(c.dns) : '';
    for (const i of Object.values(inputs)) i.disabled = c.mode === 'dhcp';
    status.textContent = c.mode !== 'dhcp' ? '' : DHCP_TEXT[h.dhcpStatus];
    status.dataset.state = h.dhcpStatus;
    ids.render();
  };

  const applyStatic = (): void => {
    const r = readStatic(inputs);
    if (typeof r === 'string') return msg.error(r);
    msg.clear();
    h.setStatic(r);
    app.afterCommand();
    fill();
  };

  dhcpRadio.addEventListener('change', () => {
    msg.clear();
    h.useDhcp();
    fill();
    h.hooks.runUntil(() => h.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    app.afterCommand();
    fill();
  });
  staticRadio.addEventListener('change', applyStatic);
  for (const i of Object.values(inputs)) i.addEventListener('change', applyStatic);
  sendId.addEventListener('change', () => { h.sendClientId = sendId.checked; app.afterCommand(); ids.render(); });
  osSel.addEventListener('change', () => { h.os = osSel.value === 'linux' ? 'linux' : 'windows'; app.afterCommand(); });
  const dispose = h.onChange(fill);
  const root = layout({ dhcpRadio, staticRadio, status, inputs, msg: msg.el, sendId, osSel, ids });
  fill();
  return { root, dispose };
}
