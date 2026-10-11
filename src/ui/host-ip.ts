/** "Configuración IP" tab for PCs and servers. */
import { el } from './dom.ts';
import { field, copyRow, input, message } from './forms.ts';
import type { Host } from '../devices/host.ts';
import { formatIp, formatMask, parseIp, parseMask, classfulPrefix } from '../core/ip.ts';
import { formatMacCisco, formatHexId, clientIdFromMac } from '../core/mac.ts';

const DHCP_WAIT_MS = 20_000;

export interface AfterChange {
  afterCommand(): void;
}

export function hostIpConfig(h: Host, app: AfterChange): { root: HTMLElement; dispose: () => void } {
  const name = `mode-${h.id}`;
  const dhcpRadio = el('input', { type: 'radio', name, value: 'dhcp' });
  const staticRadio = el('input', { type: 'radio', name, value: 'static' });
  const inputs = { ip: input({ inputmode: 'decimal' }), mask: input({ inputmode: 'decimal' }), gw: input({ inputmode: 'decimal' }), dns: input({ inputmode: 'decimal' }) };
  const status = el('p', { class: 'status', role: 'status' });
  const msg = message();
  const sendId = el('input', { type: 'checkbox', checked: h.sendClientId });
  const osSel = el('select', { class: 'select' }, el('option', { value: 'windows' }, 'Windows'), el('option', { value: 'linux' }, 'GNU/Linux (Ubuntu)'));
  osSel.value = h.os;
  const idsBox = el('div', { class: 'ids' });

  const renderIds = (): void => {
    idsBox.replaceChildren(
      copyRow('MAC', formatMacCisco(h.mac), 'Para «hardware-address» y las reservas por MAC.'),
      copyRow('Client-ID (opción 61)', formatHexId(clientIdFromMac(h.mac)), h.sendClientId ? 'Para «client-identifier» y «address … client-id».' : 'No se envía: el servidor identificará al equipo por su MAC.'),
    );
  };

  const fill = (): void => {
    const c = h.config;
    dhcpRadio.checked = c.mode === 'dhcp';
    staticRadio.checked = c.mode === 'static';
    inputs.ip.value = c.ip !== undefined ? formatIp(c.ip) : '';
    inputs.mask.value = c.prefix !== undefined ? formatMask(c.prefix) : '';
    inputs.gw.value = c.gateway !== undefined ? formatIp(c.gateway) : '';
    inputs.dns.value = c.dns !== undefined ? formatIp(c.dns) : '';
    for (const i of Object.values(inputs)) i.disabled = c.mode === 'dhcp';
    status.textContent = c.mode !== 'dhcp' ? '' : { idle: '', requesting: 'Solicitando dirección IP…', ok: 'Solicitud DHCP correcta.', failed: 'La solicitud DHCP ha fallado. Se usa APIPA.' }[h.dhcpStatus];
    status.dataset.state = h.dhcpStatus;
    renderIds();
  };

  const applyStatic = (): void => {
    const read = (i: HTMLInputElement): number | undefined | null => (i.value.trim() === '' ? undefined : parseIp(i.value.trim()));
    const ip = read(inputs.ip);
    const gw = read(inputs.gw);
    const dns = read(inputs.dns);
    const mask = inputs.mask.value.trim() === '' ? undefined : parseMask(inputs.mask.value.trim());
    const bad = ip === null ? 'la dirección IP' : mask === null ? 'la máscara' : gw === null ? 'la puerta de enlace' : dns === null ? 'el servidor DNS' : '';
    if (bad) {
      msg.error(`Revisa ${bad}: usa el formato 192.168.1.10.`);
      return;
    }
    msg.clear();
    const prefix = mask ?? (ip !== undefined && ip !== null ? classfulPrefix(ip) : undefined);
    h.setStatic({ ip: ip ?? undefined, prefix, gateway: gw ?? undefined, dns: dns ?? undefined });
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
  sendId.addEventListener('change', () => { h.sendClientId = sendId.checked; app.afterCommand(); renderIds(); });
  osSel.addEventListener('change', () => { h.os = osSel.value === 'linux' ? 'linux' : 'windows'; app.afterCommand(); });
  const dispose = h.onChange(fill);
  const root = el('div', { class: 'pane' },
    el('fieldset', { class: 'mode' }, el('legend', {}, 'Configuración IPv4'),
      el('label', { class: 'radio' }, dhcpRadio, 'DHCP'), el('label', { class: 'radio' }, staticRadio, 'Estática')),
    status,
    el('div', { class: 'grid2' }, field('Dirección IPv4', inputs.ip), field('Máscara de subred', inputs.mask), field('Puerta de enlace', inputs.gw), field('Servidor DNS', inputs.dns)),
    msg.el,
    el('label', { class: 'check' }, sendId, 'Enviar identificador de cliente (opción 61), como Windows'),
    field('Sistema operativo (servicios y banner SSH)', osSel),
    idsBox,
  );
  fill();
  return { root, dispose };
}
