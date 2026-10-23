/** ISP cloud window: provider, public block and domains; per-line mode, speeds, LAN, port forwarding. */
import { t } from '../i18n/t.ts';
import { el } from './dom.ts';
import { field, input, button, message, onCommit, select, table, subnav } from './forms.ts';
import { livePanel } from './server-dhcp-dns.ts';
import type { Tab } from './windows.ts';
import type { Cloud } from '../devices/cloud.ts';
import type { CloudPort } from '../devices/cloud-port.ts';
import { ACCESS_LABEL, CLOUD_PORTS, LINE_PREFIX, accessOf, ispHop, lineSubnet, validateCloud, validDomain } from '../devices/cloud-config.ts';
import type { CloudDomain, CloudPortName, CloudPortSettings, PortForward } from '../devices/cloud-config.ts';
import { formatIp, formatMask, parseIp, parseMask } from '../core/ip.ts';
import { BACKBONE } from '../net/internet.ts';

export interface CloudHost {
  afterCommand(): void;
  connected(port: string): string | undefined;
}

function save(cloud: Cloud, next: Cloud['settings'], msg: ReturnType<typeof message>, app: CloudHost, refresh: () => void): void {
  const err = validateCloud(next, cloud.otherBlocks());
  if (err) return msg.error(err);
  cloud.setSettings(next);
  app.afterCommand();
  refresh();
  msg.ok(t('cloud.saved'));
}

function ispTab(cloud: Cloud, app: CloudHost): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const s = cloud.settings;
    const isp = input({ value: s.isp, maxlength: '40' });
    const block = input({ value: formatIp(s.block) });
    const apply = (): void => {
      const b = parseIp(block.value.trim());
      if (b === null) return msg.error(t('cloud.badBlock'));
      if (isp.value.trim() === s.isp && b === s.block) return;
      save(cloud, { ...s, isp: isp.value.trim(), block: b }, msg, app, refresh);
    };
    onCommit(isp, apply);
    onCommit(block, apply);
    const dName = input({ placeholder: 'sede2.es' });
    const dKind = select([['a', t('cloud.kindA')], ['ns', t('cloud.kindNs')]]);
    const dIp = input({ placeholder: t('cloud.domainIpHint') });
    const addDomain = (): void => {
      const name = dName.value.trim().toLowerCase();
      const bad = validDomain(name);
      const addr = parseIp(dIp.value.trim());
      if (bad) return msg.error(bad);
      if (addr === null) return msg.error(t('cloud.needIp'));
      if (s.domains.some((d) => d.name === name)) return msg.error(t('cloud.registered', { name }));
      save(cloud, { ...s, domains: [...s.domains, { name, kind: dKind.value === 'ns' ? 'ns' : 'a', ip: addr }] }, msg, app, refresh);
    };
    return [
      el('h3', {}, t('cloud.provider')),
      el('div', { class: 'grid2' }, field(t('cloud.ispName'), isp), field(t('cloud.block'), block, t('cloud.blockHint', { a: formatIp(lineSubnet(s.block, 'Coaxial0').net), b: formatIp(lineSubnet(s.block, 'Coaxial1').net) }))),
      msg.el,
      el('h3', {}, t('cloud.domains')),
      el('p', { class: 'muted' }, t('cloud.domainsHint')),
      table<CloudDomain>(s.domains, [
        { label: t('cloud.domain'), value: (d) => d.name, mono: true },
        { label: t('cloud.type'), value: (d) => (d.kind === 'ns' ? t('cloud.delegated') : 'A') },
        { label: 'IP', value: (d) => formatIp(d.ip), mono: true },
      ], { empty: t('cloud.noDomains'), onDelete: (d) => save(cloud, { ...s, domains: s.domains.filter((x) => x !== d) }, msg, app, refresh) }),
      el('div', { class: 'grid2' }, field(t('cloud.domain'), dName), field(t('cloud.ipAddress'), dIp)),
      field(t('cloud.type'), dKind),
      el('div', { class: 'actions' }, button(t('cloud.register'), addDomain)),
      el('h3', {}, t('cloud.internet')),
      el('ul', { class: 'muted' },
        el('li', {}, t('cloud.ispRouter', { ip: formatIp(ispHop(s.block)), backbone: BACKBONE.map(formatIp).join(', ') })),
        el('li', {}, t('cloud.publicDns')),
        el('li', {}, t('cloud.webs'))),
    ];
  });
}

function forwardsSection(line: CloudPort, change: (forwards: readonly PortForward[]) => void): HTMLElement[] {
  const proto = select([['tcp', 'TCP'], ['udp', 'UDP']]);
  const port = input({ placeholder: '80', inputmode: 'numeric' });
  const to = input({ placeholder: '192.168.1.10' });
  const toPort = input({ placeholder: '80', inputmode: 'numeric' });
  const add = (): void => change([...line.settings.forwards, { proto: proto.value === 'udp' ? 'udp' : 'tcp', port: Number(port.value), ip: parseIp(to.value.trim()) ?? 0, toPort: Number(toPort.value || port.value) }]);
  return [
    el('h3', {}, t('cloud.forwards')),
    table<PortForward>(line.settings.forwards, [
      { label: t('cloud.protocol'), value: (f) => f.proto.toUpperCase() },
      { label: t('cloud.publicPort'), value: (f) => String(f.port) },
      { label: t('cloud.target'), value: (f) => `${formatIp(f.ip)}:${f.toPort}`, mono: true },
    ], { empty: t('cloud.noForwards'), onDelete: (f) => change(line.settings.forwards.filter((x) => x !== f)) }),
    el('div', { class: 'grid2' }, field(t('cloud.protocol'), proto), field(t('cloud.publicPort'), port)),
    el('div', { class: 'grid2' }, field(t('cloud.lanIp'), to), field(t('cloud.innerPort'), toPort)),
    el('div', { class: 'actions' }, button(t('cloud.addForward'), add)),
  ];
}

function linePanel(cloud: Cloud, name: CloudPortName, app: CloudHost): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const line = cloud.lines.get(name);
    if (!line) return [];
    const c = line.settings;
    const sub = line.line();
    const put = (next: CloudPortSettings): void => save(cloud, { ...cloud.settings, ports: { ...cloud.settings.ports, [name]: next } }, msg, app, refresh);
    const mode = select([['router', t('cloud.modeRouter')], ['public', t('cloud.modePublic')]], c.mode);
    const down = input({ value: String(c.down), inputmode: 'numeric' });
    const up = input({ value: String(c.up), inputmode: 'numeric' });
    const lan = input({ value: formatIp(c.lanIp) });
    const mask = input({ value: formatMask(c.lanPrefix) });
    const relay = el('input', { type: 'checkbox', checked: c.dnsRelay === true });
    const apply = (): void => {
      const ip = parseIp(lan.value.trim());
      const prefix = parseMask(mask.value.trim());
      if (ip === null || prefix === null) return msg.error(t('cloud.badLan'));
      put({ ...c, mode: mode.value === 'public' ? 'public' : 'router', down: Number(down.value), up: Number(up.value), lanIp: ip, lanPrefix: prefix, dnsRelay: relay.checked });
    };
    for (const control of [mode, down, up, lan, mask, relay]) onCommit(control, apply);
    const peer = app.connected(name);
    const leases = line.leases().map((b) => `${formatIp(b.ip)} → ${b.hostname ?? b.mac}`);
    const nat = line.nat.entries().slice(-8).map((e) => `${e.proto ?? 'ip'} ${formatIp(e.insideLocal)}:${e.localPort ?? ''} → ${formatIp(e.insideGlobal)}:${e.globalPort ?? ''}`);
    return [
      el('h3', {}, `${name} · ${ACCESS_LABEL[accessOf(name)]}`),
      el('p', { class: 'muted' }, peer ? t('cloud.connected', { peer }) : t('cloud.noCable')),
      el('div', { class: 'grid2' }, field(t('cloud.mode'), mode, t('cloud.modeHint')), field(t('cloud.speed'), el('div', { class: 'grid2' }, down, up))),
      c.mode === 'router' ? el('div', { class: 'grid2' }, field(t('cloud.routerLan'), lan), field(t('cloud.lanMask'), mask)) : el('div', {}),
      c.mode === 'router' ? el('label', { class: 'check' }, relay, ` ${t('dns.relay')}`) : el('div', {}),
      c.mode === 'router' ? el('p', { class: 'field-hint' }, t('dns.relayHint')) : el('div', {}),
      msg.el,
      el('h3', {}, t('cloud.addresses')),
      el('ul', { class: 'muted' }, ...(c.mode === 'router'
        ? [el('li', {}, t('cloud.wan', { ip: formatIp(line.wan()) })), el('li', {}, t('cloud.lanDhcp', { net: `${formatIp(c.lanIp)}/${c.lanPrefix}` })), el('li', {}, c.dnsRelay ? t('dns.relayOn', { ip: formatIp(c.lanIp) }) : t('cloud.dnsGoogle'))]
        : [el('li', {}, t('cloud.subnet', { net: `${formatIp(sub.net)}/${LINE_PREFIX}`, gw: formatIp(sub.gw) })), el('li', {}, t('cloud.subnetDhcp', { ip: formatIp(sub.customer), from: formatIp(sub.customer + 1), to: formatIp(sub.customer + 4) }))])),
      el('p', { class: 'muted' }, t('cloud.leases', { list: leases.join(' · ') || t('cloud.none') })),
      c.mode === 'router' ? el('p', { class: 'muted mono' }, `NAT: ${nat.join(' · ') || t('cloud.noNat')}`) : el('div', {}),
      ...(c.mode === 'router' ? forwardsSection(line, (forwards) => put({ ...c, forwards })) : []),
    ];
  });
}

interface PortRow {
  readonly name: CloudPortName;
  readonly line: CloudPort;
}

/** «Interfaces»: the six lines at a glance (access, mode, address on the customer side and far end). */
function interfacesTab(cloud: Cloud, app: CloudHost): HTMLElement {
  return livePanel(() => {
    const rows: PortRow[] = CLOUD_PORTS.flatMap((name) => { const line = cloud.lines.get(name); return line ? [{ name, line }] : []; });
    return [
      el('p', { class: 'muted' }, t('cloudif.intro')),
      table<PortRow>(rows, [
        { label: t('iosif.iface'), value: (r) => r.name, mono: true },
        { label: t('cloudif.access'), value: (r) => ACCESS_LABEL[accessOf(r.name)] },
        { label: t('cloud.mode'), value: (r) => (r.line.settings.mode === 'router' ? t('cloud.modeRouter') : t('cloud.modePublic')) },
        { label: t('cloudif.customer'), value: (r) => (r.line.settings.mode === 'router' ? `WAN ${formatIp(r.line.wan())} · LAN ${formatIp(r.line.settings.lanIp)}/${r.line.settings.lanPrefix}` : `${formatIp(r.line.line().net)}/${LINE_PREFIX}`), mono: true },
        { label: t('hostif.peer'), value: (r) => app.connected(r.name) ?? t('cloud.noCable') },
      ], { empty: '—' }),
    ];
  });
}

export function cloudTabs(cloud: Cloud, app: CloudHost): Tab[] {
  return [
    { id: 'isp', label: 'ISP', render: () => ispTab(cloud, app) },
    { id: 'ifaces', label: t('win.ifaces'), render: () => interfacesTab(cloud, app) },
    { id: 'lines', label: t('cloud.lines'), render: () => subnav(CLOUD_PORTS.map((p) => ({ id: p, label: p, render: () => linePanel(cloud, p, app) }))) },
  ];
}
