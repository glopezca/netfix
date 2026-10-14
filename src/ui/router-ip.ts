/** "Interfaces" tab of the Linux router: address per NIC, WAN by DHCP, gateway, DNS, forwarding and routes. */
import { el } from './dom.ts';
import { button, field, input, message, onOff, table } from './forms.ts';
import { liveHostPanel } from './live.ts';
import type { LivePanel } from './live.ts';
import type { AfterChange } from './host-ip.ts';
import type { LinuxRouter } from '../devices/linux-router.ts';
import type { NicInfo, StaticRoute } from '../devices/host-nics.ts';
import { routeTo } from '../devices/host-nics.ts';
import { saveSysctl } from '../shells/kernel-save.ts';
import { formatIp, formatMask, inSubnet, parseIp, parseMask } from '../core/ip.ts';
import { t } from '../i18n/t.ts';

const DHCP_WAIT_MS = 20_000;

function readAddress(ipText: string, maskText: string): { ip: number; prefix: number } | null | undefined {
  if (ipText.trim() === '' && maskText.trim() === '') return undefined;
  const ip = parseIp(ipText.trim());
  const prefix = parseMask(maskText.trim());
  return ip === null || prefix === null ? null : { ip, prefix };
}

function nicRow(r: LinuxRouter, n: NicInfo, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const ip = input({ inputmode: 'decimal', value: n.ip !== undefined ? formatIp(n.ip) : '', 'aria-label': `${t('router.address')} ${n.linux}` });
  const mask = input({ inputmode: 'decimal', value: n.prefix !== undefined ? formatMask(n.prefix) : '', 'aria-label': `${t('router.mask')} ${n.linux}` });
  const isWan = n.port === r.primaryPort();
  const dhcp = el('input', { type: 'checkbox', checked: isWan && r.config.mode === 'dhcp', 'aria-label': t('router.dhcp') });
  ip.disabled = mask.disabled = dhcp.checked;
  const apply = (): void => {
    const a = readAddress(ip.value, mask.value);
    if (a === null) return msg.error(t('router.errAddress', { iface: n.linux }));
    msg.clear();
    if (isWan) r.setStatic({ ip: a?.ip, prefix: a?.prefix, gateway: r.config.gateway, dns: r.config.dns });
    else r.setNicAddress(n.port, a);
    app.afterCommand();
  };
  dhcp.addEventListener('change', () => {
    if (dhcp.checked) {
      r.useDhcp();
      r.hooks.runUntil(() => r.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
      app.afterCommand();
    } else apply();
  });
  const state = n.adminUp ? (n.up ? t('router.up') : `${t('router.up')} (${t('router.noCable')})`) : t('router.down');
  const toggle = onOff(state, n.adminUp, (on) => { r.setNicUp(n.port, on); app.afterCommand(); });
  return el('div', { class: 'nic-row' },
    el('div', { class: 'nic-name' }, el('strong', {}, n.port), el('span', { class: 'mono muted' }, n.linux)),
    field(t('router.address'), ip), field(t('router.mask'), mask),
    el('div', { class: 'nic-actions' }, toggle, button(t('router.apply'), apply)),
    ...(isWan ? [el('label', { class: 'check nic-dhcp' }, dhcp, t('router.dhcp'))] : []),
  );
}

function gatewaySection(r: LinuxRouter, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement {
  const c = r.config;
  const gw = input({ inputmode: 'decimal', value: c.gateway !== undefined ? formatIp(c.gateway) : '' });
  const dns = input({ inputmode: 'decimal', value: c.dns !== undefined ? formatIp(c.dns) : '' });
  gw.disabled = dns.disabled = c.mode === 'dhcp';
  const apply = (): void => {
    const g = gw.value.trim() === '' ? undefined : parseIp(gw.value.trim());
    const d = dns.value.trim() === '' ? undefined : parseIp(dns.value.trim());
    const reachable = g === undefined || r.nics().some((n) => n.ip !== undefined && n.prefix !== undefined && g !== null && inSubnet(g, n.ip, n.prefix));
    if (g === null || d === null || !reachable) return msg.error(t('router.errGateway'));
    msg.clear();
    r.setStatic({ ip: c.ip, prefix: c.prefix, gateway: g, dns: d });
    app.afterCommand();
  };
  gw.addEventListener('change', apply);
  dns.addEventListener('change', apply);
  return el('div', { class: 'grid2' }, field(t('router.gateway'), gw), field(t('router.dns'), dns));
}

function routesSection(r: LinuxRouter, app: AfterChange, msg: ReturnType<typeof message>): HTMLElement[] {
  const dest = input({ placeholder: '10.0.0.0/8', 'aria-label': t('router.dest') });
  const via = input({ inputmode: 'decimal', placeholder: '192.168.1.254', 'aria-label': t('router.via') });
  const add = (): void => {
    const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(dest.value.trim());
    const net = m ? parseIp(m[1] ?? '') : null;
    const gw = parseIp(via.value.trim());
    const prefix = Number(m?.[2]);
    const ok = net !== null && gw !== null && prefix <= 32 && r.nics().some((n) => n.ip !== undefined && n.prefix !== undefined && inSubnet(gw, n.ip, n.prefix));
    if (!ok || net === null || gw === null) return msg.error(t('router.errRoute'));
    msg.clear();
    const route = routeTo(net, prefix, gw);
    r.setStaticRoutes([...r.staticRoutes.filter((x) => !(x.net === route.net && x.prefix === route.prefix)), route]);
    app.afterCommand();
  };
  const rows = table<StaticRoute>(r.staticRoutes, [
    { label: t('router.dest'), value: (x) => `${formatIp(x.net)}/${x.prefix}`, mono: true },
    { label: t('router.via'), value: (x) => formatIp(x.via), mono: true },
  ], { empty: t('router.noRoutes'), onDelete: (x) => { r.setStaticRoutes(r.staticRoutes.filter((y) => y !== x)); app.afterCommand(); } });
  return [el('h3', {}, t('router.routes')), el('p', { class: 'muted' }, t('router.routesIntro')), rows,
    el('div', { class: 'grid2' }, field(t('router.dest'), dest), field(t('router.via'), via)), button(t('router.addRoute'), add)];
}

export function routerInterfaces(r: LinuxRouter, app: AfterChange): LivePanel {
  // Outside the redraw: an action that changes the device redraws the panel before reporting.
  const msg = message();
  return liveHostPanel(r, () => {
    const forwarding = r.kernel.sysctl.enabled('net.ipv4.ip_forward');
    return [
      el('p', { class: 'muted' }, t('router.ifacesIntro')),
      onOff(t('router.forwarding'), forwarding, (on) => {
        const err = saveSysctl(r, 'net.ipv4.ip_forward', on ? '1' : '0');
        if (err) msg.error(err);
        app.afterCommand();
      }),
      ...(forwarding ? [] : [el('p', { class: 'status', 'data-state': 'failed' }, t('router.forwardingOff'))]),
      el('h3', {}, t('router.ifaces')),
      ...r.nics().map((n) => nicRow(r, n, app, msg)),
      gatewaySection(r, app, msg),
      msg.el,
      ...routesSection(r, app, msg),
    ];
  });
}
