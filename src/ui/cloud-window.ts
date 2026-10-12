/** ISP cloud window: provider, public block and domains; per-line mode, speeds, LAN, port forwarding. */
import { el } from './dom.ts';
import { field, input, button, message, select, table, subnav } from './forms.ts';
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
  msg.ok('Guardado.');
}

function ispTab(cloud: Cloud, app: CloudHost): HTMLElement {
  const msg = message();
  return livePanel((refresh) => {
    const s = cloud.settings;
    const isp = input({ value: s.isp, maxlength: '40' });
    const block = input({ value: formatIp(s.block) });
    const apply = (): void => {
      const b = parseIp(block.value.trim());
      if (b === null) return msg.error('Escribe el bloque como 81.32.0.0.');
      save(cloud, { ...s, isp: isp.value.trim(), block: b }, msg, app, refresh);
    };
    const dName = input({ placeholder: 'sede2.es' });
    const dKind = select([['a', 'A: el dominio y *.dominio apuntan a la IP'], ['ns', 'NS: delegado en el servidor DNS de esa IP']]);
    const dIp = input({ placeholder: 'IP pública (p. ej. la WAN de una línea)' });
    const addDomain = (): void => {
      const name = dName.value.trim().toLowerCase();
      const bad = validDomain(name);
      const addr = parseIp(dIp.value.trim());
      if (bad) return msg.error(bad);
      if (addr === null) return msg.error('Escribe una dirección IP pública.');
      if (s.domains.some((d) => d.name === name)) return msg.error(`${name} ya está registrado.`);
      save(cloud, { ...s, domains: [...s.domains, { name, kind: dKind.value === 'ns' ? 'ns' : 'a', ip: addr }] }, msg, app, refresh);
    };
    return [
      el('h3', {}, 'Proveedor'),
      el('div', { class: 'grid2' }, field('Nombre del ISP', isp), field('Bloque público (/16)', block, `Cada línea usa un /29: ${formatIp(lineSubnet(s.block, 'Coaxial0').net)}, ${formatIp(lineSubnet(s.block, 'Coaxial1').net)}…`)),
      el('div', { class: 'actions' }, button('Guardar', apply)),
      msg.el,
      el('h3', {}, 'Dominios registrados'),
      el('p', { class: 'muted' }, 'Los publican los DNS públicos 8.8.8.8 y 8.8.4.4 para todas las nubes.'),
      table<CloudDomain>(s.domains, [
        { label: 'Dominio', value: (d) => d.name, mono: true },
        { label: 'Tipo', value: (d) => (d.kind === 'ns' ? 'NS (delegado)' : 'A') },
        { label: 'IP', value: (d) => formatIp(d.ip), mono: true },
      ], { empty: 'Sin dominios.', onDelete: (d) => save(cloud, { ...s, domains: s.domains.filter((x) => x !== d) }, msg, app, refresh) }),
      el('div', { class: 'grid2' }, field('Dominio', dName), field('Dirección IP', dIp)),
      field('Tipo', dKind),
      el('div', { class: 'actions' }, button('Registrar dominio', addDomain)),
      el('h3', {}, 'Internet emulada'),
      el('ul', { class: 'muted' },
        el('li', {}, `Router del ISP: ${formatIp(ispHop(s.block))}; troncal: ${BACKBONE.map(formatIp).join(', ')}.`),
        el('li', {}, 'DNS públicos 8.8.8.8 y 8.8.4.4 (google.com, dns.google, example.com, ifconfig.me y los dominios registrados).'),
        el('li', {}, 'Webs: www.google.com, example.com y ifconfig.me muestran la IP pública con la que llegas (curl ifconfig.me).')),
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
    el('h3', {}, 'Redirección de puertos (NAT)'),
    table<PortForward>(line.settings.forwards, [
      { label: 'Protocolo', value: (f) => f.proto.toUpperCase() },
      { label: 'Puerto público', value: (f) => String(f.port) },
      { label: 'Destino', value: (f) => `${formatIp(f.ip)}:${f.toPort}`, mono: true },
    ], { empty: 'Sin redirecciones: desde Internet solo responde el router (ping).', onDelete: (f) => change(line.settings.forwards.filter((x) => x !== f)) }),
    el('div', { class: 'grid2' }, field('Protocolo', proto), field('Puerto público', port)),
    el('div', { class: 'grid2' }, field('IP de la LAN', to), field('Puerto interno', toPort)),
    el('div', { class: 'actions' }, button('Añadir redirección', add)),
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
    const mode = select([['router', 'Router del operador'], ['public', 'IP pública (/29)']], c.mode);
    const down = input({ value: String(c.down), inputmode: 'numeric' });
    const up = input({ value: String(c.up), inputmode: 'numeric' });
    const lan = input({ value: formatIp(c.lanIp) });
    const mask = input({ value: formatMask(c.lanPrefix) });
    const apply = (): void => {
      const ip = parseIp(lan.value.trim());
      const prefix = parseMask(mask.value.trim());
      if (ip === null || prefix === null) return msg.error('Revisa la IP y la máscara de la LAN.');
      put({ ...c, mode: mode.value === 'public' ? 'public' : 'router', down: Number(down.value), up: Number(up.value), lanIp: ip, lanPrefix: prefix });
    };
    const peer = app.connected(name);
    const leases = line.leases().map((b) => `${formatIp(b.ip)} → ${b.hostname ?? b.mac}`);
    const nat = line.nat.entries().slice(-8).map((e) => `${e.proto ?? 'ip'} ${formatIp(e.insideLocal)}:${e.localPort ?? ''} → ${formatIp(e.insideGlobal)}:${e.globalPort ?? ''}`);
    return [
      el('h3', {}, `${name} · ${ACCESS_LABEL[accessOf(name)]}`),
      el('p', { class: 'muted' }, peer ? `Conectado a ${peer}.` : 'Sin cable: conecta aquí un router o un PC.'),
      el('div', { class: 'grid2' }, field('Modo de la línea', mode, 'Router del operador: LAN, DHCP y NAT. IP pública: tu router recibe x.y.n.2 por DHCP.'), field('Bajada / subida (Mbit/s)', el('div', { class: 'grid2' }, down, up))),
      c.mode === 'router' ? el('div', { class: 'grid2' }, field('IP del router (LAN)', lan), field('Máscara de la LAN', mask)) : el('div', {}),
      el('div', { class: 'actions' }, button('Guardar', apply)),
      msg.el,
      el('h3', {}, 'Direcciones'),
      el('ul', { class: 'muted' }, ...(c.mode === 'router'
        ? [el('li', {}, `IP pública (WAN): ${formatIp(line.wan())}`), el('li', {}, `LAN ${formatIp(c.lanIp)}/${c.lanPrefix}; DHCP desde .33; DNS 8.8.8.8 y 8.8.4.4.`)]
        : [el('li', {}, `Subred pública ${formatIp(sub.net)}/${LINE_PREFIX}; puerta de enlace ${formatIp(sub.gw)}`), el('li', {}, `DHCP entrega ${formatIp(sub.customer)}; ${formatIp(sub.customer + 1)}–${formatIp(sub.customer + 4)} libres para NAT estático.`)])),
      el('p', { class: 'muted' }, `Concesiones: ${leases.join(' · ') || 'ninguna'}`),
      c.mode === 'router' ? el('p', { class: 'muted mono' }, `NAT: ${nat.join(' · ') || 'sin traducciones'}`) : el('div', {}),
      ...(c.mode === 'router' ? forwardsSection(line, (forwards) => put({ ...c, forwards })) : []),
    ];
  });
}

export function cloudTabs(cloud: Cloud, app: CloudHost): Tab[] {
  return [
    { id: 'isp', label: 'ISP', render: () => ispTab(cloud, app) },
    { id: 'lines', label: 'Líneas', render: () => subnav(CLOUD_PORTS.map((p) => ({ id: p, label: p, render: () => linePanel(cloud, p, app) }))) },
  ];
}
