/** Simulation mode: captured frames as an event list, step/play animation and PDU details. */
import { t } from '../i18n/t.ts';
import { el, svg, clear, prefersReducedMotion } from './dom.ts';
import type { Canvas } from './canvas.ts';
import type { Topology } from '../net/topology.ts';
import type { SimEvent } from '../net/network.ts';
import type { Frame, AppPayload } from '../net/packets.ts';
import { tcpService } from '../net/packets.ts';
import { formatIp, formatMask } from '../core/ip.ts';
import { formatMacCisco, formatHexId } from '../core/mac.ts';

const PROTOCOLS = ['DHCP', 'DNS', 'ARP', 'ICMP', 'TCP', 'HTTP', 'SMTP', 'POP3', 'IMAP', 'SSH'] as const;
const BASE_STEP_MS = 700;
const MAX_ROWS = 600;

export class SimPanel {
  readonly root: HTMLElement;
  private readonly tbody: HTMLTableSectionElement;
  private readonly detail: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly counter: HTMLElement;
  private readonly filters = new Map<string, boolean>(PROTOCOLS.map((p) => [p, true]));
  private events: SimEvent[] = [];
  private cursor = 0;
  private playing = false;
  private speed = 1;
  private timer = 0;
  private topo: Topology;
  private readonly canvas: Canvas;
  private unsubscribe: () => void = () => undefined;
  private active = false;

  constructor(topo: Topology, canvas: Canvas) {
    this.topo = topo;
    this.canvas = canvas;
    this.tbody = el('tbody');
    this.detail = el('div', { class: 'pdu', 'aria-live': 'polite' }, el('p', { class: 'muted' }, t('sim.pick')));
    this.playBtn = el('button', { type: 'button', class: 'btn' }, t('sim.play'));
    this.counter = el('span', { class: 'sim-count' });
    const step = el('button', { type: 'button', class: 'btn' }, t('sim.step'));
    const reset = el('button', { type: 'button', class: 'btn btn-quiet' }, t('sim.clear'));
    const speed = el('input', { type: 'range', min: '0.25', max: '4', step: '0.25', value: '1', 'aria-label': t('sim.speedLabel') });
    this.playBtn.addEventListener('click', () => this.togglePlay());
    step.addEventListener('click', () => this.step());
    reset.addEventListener('click', () => this.reset());
    speed.addEventListener('input', () => { this.speed = Number(speed.value); });
    const filterBox = el('div', { class: 'filters', role: 'group', 'aria-label': t('sim.filters') }, ...PROTOCOLS.map((p) => {
      const cb = el('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => { this.filters.set(p, cb.checked); });
      return el('label', { class: `chip chip-${p.toLowerCase()}` }, cb, p);
    }));
    const table = el('table', { class: 'events' },
      el('thead', {}, el('tr', {}, el('th', {}, t('sim.time')), el('th', {}, t('sim.from')), el('th', {}, t('sim.to')), el('th', {}, t('sim.type')))), this.tbody);
    this.root = el('aside', { class: 'simpanel', 'aria-label': t('sim.panel'), hidden: true },
      el('h2', {}, t('sim.events')),
      el('div', { class: 'sim-controls' }, this.playBtn, step, reset),
      el('label', { class: 'speed' }, t('sim.speed'), speed),
      filterBox, this.counter,
      el('div', { class: 'events-wrap' }, table),
      this.detail);
    this.attach(topo);
  }

  /** Stops listening to the network (the interface is rebuilt in another language). */
  dispose(): void {
    this.unsubscribe();
  }

  attach(topo: Topology): void {
    this.unsubscribe();
    this.topo = topo;
    this.reset();
    this.unsubscribe = topo.net.onFrame((e) => this.capture(e));
  }

  setActive(active: boolean): void {
    this.active = active;
    this.root.hidden = !active;
    if (!active) this.pause();
  }

  private capture(e: SimEvent): void {
    if (!this.active || !this.filters.get(e.protocol)) return;
    if (this.events.length >= MAX_ROWS) return;
    this.events.push(e);
    this.tbody.appendChild(this.row(e, this.events.length - 1));
    this.updateCounter();
  }

  private label(id: string): string {
    return this.topo.get(id)?.label ?? id;
  }

  private row(e: SimEvent, idx: number): HTMLTableRowElement {
    const tr = el('tr', { tabindex: '0', 'data-idx': String(idx) },
      el('td', {}, (e.time / 1000).toFixed(3)), el('td', {}, this.label(e.from.device)), el('td', {}, this.label(e.to.device)),
      el('td', {}, el('span', { class: `chip chip-${e.protocol.toLowerCase()}` }, typeName(e.frame))));
    const pick = (): void => this.select(idx);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (k) => { if (k.key === 'Enter') pick(); });
    return tr;
  }

  private select(idx: number): void {
    const e = this.events[idx];
    if (!e) return;
    for (const r of this.tbody.querySelectorAll('tr')) r.classList.toggle('is-current', r.getAttribute('data-idx') === String(idx));
    this.detail.replaceChildren(...pduView(e, this.label(e.from.device), this.label(e.to.device)));
  }

  private updateCounter(): void {
    this.counter.textContent = t('sim.count', { n: this.cursor, total: this.events.length });
  }

  private togglePlay(): void {
    if (this.playing) this.pause();
    else {
      this.playing = true;
      this.playBtn.textContent = t('sim.pause');
      this.loop();
    }
  }

  private pause(): void {
    this.playing = false;
    this.playBtn.textContent = t('sim.play');
    window.clearTimeout(this.timer);
  }

  private loop(): void {
    if (!this.playing) return;
    if (!this.step()) {
      this.pause();
      return;
    }
    this.timer = window.setTimeout(() => this.loop(), BASE_STEP_MS / this.speed);
  }

  /** Animates the next captured event. Returns false when none is left. */
  step(): boolean {
    const e = this.events[this.cursor];
    if (!e) return false;
    this.select(this.cursor);
    this.tbody.querySelector(`tr[data-idx="${this.cursor}"]`)?.scrollIntoView({ block: 'nearest' });
    this.cursor++;
    this.updateCounter();
    this.animate(e);
    return true;
  }

  reset(): void {
    this.pause();
    this.events = [];
    this.cursor = 0;
    clear(this.tbody);
    clear(this.canvas.packetLayer);
    this.detail.replaceChildren(el('p', { class: 'muted' }, t('sim.pick')));
    this.updateCounter();
  }

  private animate(e: SimEvent): void {
    const a = this.canvas.centerOf(e.from.device);
    const b = this.canvas.centerOf(e.to.device);
    if (!a || !b) return;
    const env = svg('g', { class: `envelope env-${e.protocol.toLowerCase()}` },
      svg('rect', { x: -10, y: -7, width: 20, height: 14, rx: 2 }), svg('path', { d: 'M-10 -7 L0 1 L10 -7' }));
    this.canvas.packetLayer.appendChild(env);
    const duration = prefersReducedMotion() ? 0 : (BASE_STEP_MS * 0.85) / this.speed;
    const t0 = performance.now();
    const tick = (now: number): void => {
      const k = duration === 0 ? 1 : Math.min(1, (now - t0) / duration);
      env.setAttribute('transform', `translate(${a.x + (b.x - a.x) * k} ${a.y + (b.y - a.y) * k})`);
      if (k < 1) requestAnimationFrame(tick);
      else window.setTimeout(() => env.remove(), duration === 0 ? BASE_STEP_MS / this.speed : 120);
    };
    requestAnimationFrame(tick);
  }
}

function appSummary(p: AppPayload): string {
  switch (p.app) {
    case 'HTTP': return p.kind === 'request' ? `${p.method} ${p.path}` : `${p.status} ${p.reason}`;
    case 'SSH': return p.kind === 'auth' ? 'auth' : p.kind === 'output' ? t('sim.encIn') : t('sim.encOut');
    default: return p.kind === 'reply' ? p.code : p.kind === 'request' && 'mail' in p ? 'MAIL/RCPT/DATA' : 'USER/PASS';
  }
}

function appFields(p: AppPayload): [string, string | undefined][] {
  switch (p.app) {
    case 'HTTP': return p.kind === 'request' ? [[t('pdu.request'), `${p.method} ${p.path} HTTP/1.1`], ['Host', p.host]] : [[t('pdu.status'), `HTTP/1.1 ${p.status} ${p.reason}`], ['Server', p.server], ['Content-Type', p.contentType], [t('pdu.size'), `${p.body.length} bytes`]];
    case 'SSH': return [[t('pdu.content'), t('pdu.encrypted')], [t('pdu.message'), p.kind]];
    default:
      if (p.kind === 'reply') return [[t('pdu.reply'), `${p.code} ${p.text}`], [t('pdu.messages'), p.messages ? String(p.messages.length) : undefined]];
      if ('mail' in p) return [['HELO', p.helo], ['MAIL FROM', p.mail.from], ['RCPT TO', p.mail.to.join(', ')], ['Subject', p.mail.subject]];
      return [['USER', p.user], ['PASS', '•'.repeat(Math.min(8, p.password.length))], [t('pdu.note'), t('pdu.clearPass', { app: p.app })]];
  }
}

function typeName(f: Frame): string {
  const dhcp = f.ip?.udp?.dhcp;
  if (dhcp) return `DHCP ${dhcp.options.messageType}`;
  if (f.arp) return `ARP ${f.arp.op === 'request' ? 'Request' : 'Reply'}`;
  if (f.ip?.icmp) return `ICMP ${f.ip.icmp.type}`;
  const dns = f.ip?.udp?.dns;
  if (dns) return `DNS ${dns.response ? `${dns.rcode ?? 'NOERROR'}` : `${dns.qtype}?`} ${dns.qname}`;
  const tcp = f.ip?.tcp;
  if (tcp) return tcp.data ? `${tcp.data.app} ${appSummary(tcp.data)}` : `TCP ${tcp.flags.join(',')} ${tcpService(tcp)}`;
  return 'IPv4';
}

function kv(rows: readonly [string, string | undefined][]): HTMLElement {
  return el('dl', { class: 'kv' }, ...rows.filter(([, v]) => v !== undefined && v !== '').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v ?? '')]));
}

function pduView(e: SimEvent, from: string, to: string): HTMLElement[] {
  const f = e.frame;
  const out: HTMLElement[] = [el('h3', {}, `${typeName(f)} · ${from} → ${to}`)];
  out.push(el('h4', {}, 'Ethernet II'), kv([[t('pdu.src'), formatMacCisco(f.src)], [t('pdu.dst'), formatMacCisco(f.dst)], ['802.1Q VLAN', f.vlan?.toString()], [t('pdu.port'), `${e.from.port} → ${e.to.port}`]]));
  if (f.arp) {
    out.push(el('h4', {}, 'ARP'), kv([[t('pdu.op'), f.arp.op], [t('pdu.senderIp'), formatIp(f.arp.senderIp)], [t('pdu.senderMac'), formatMacCisco(f.arp.senderMac)], [t('pdu.targetIp'), formatIp(f.arp.targetIp)]]));
    return out;
  }
  const ip = f.ip;
  if (!ip) return out;
  out.push(el('h4', {}, 'IPv4'), kv([[t('pdu.src'), formatIp(ip.src)], [t('pdu.dst'), formatIp(ip.dst)], ['TTL', String(ip.ttl)], [t('pdu.protocol'), ip.protocol.toUpperCase()]]));
  const d = ip.udp?.dhcp;
  if (d) {
    const o = d.options;
    out.push(el('h4', {}, `UDP ${ip.udp?.sport} → ${ip.udp?.dport} · DHCP`), kv([
      ['op', d.op], [t('pdu.dhcpType'), o.messageType], ['xid', `0x${d.xid.toString(16).toUpperCase()}`],
      ['ciaddr', formatIp(d.ciaddr)], ['yiaddr', formatIp(d.yiaddr)], ['siaddr', formatIp(d.siaddr)], ['giaddr', formatIp(d.giaddr)],
      ['chaddr', formatMacCisco(d.chaddr)], ['Client-ID (61)', o.clientId ? formatHexId(o.clientId) : undefined], ['Host name (12)', o.hostname],
      [t('pdu.requested'), o.requestedIp !== undefined ? formatIp(o.requestedIp) : undefined],
      [t('pdu.server'), o.serverId !== undefined ? formatIp(o.serverId) : undefined],
      [t('pdu.mask'), o.subnetPrefix !== undefined ? formatMask(o.subnetPrefix) : undefined],
      ['Router (3)', o.routers?.map(formatIp).join(', ')], ['DNS (6)', o.dnsServers?.map(formatIp).join(', ')],
      [t('pdu.domain'), o.domainName], ['Lease (51)', o.leaseSeconds !== undefined ? `${o.leaseSeconds} s` : undefined],
      ['TFTP (150)', o.tftpServers?.map(formatIp).join(', ')], [t('pdu.opt82'), o.relayAgentInfo ? t('pdu.present') : undefined],
      ['Boot file', d.file],
    ]));
  } else if (ip.icmp) {
    out.push(el('h4', {}, 'ICMP'), kv([[t('pdu.type'), ip.icmp.type], ['id', String(ip.icmp.id)], ['seq', String(ip.icmp.seq)]]));
  } else if (ip.udp?.dns) {
    const q = ip.udp.dns;
    out.push(el('h4', {}, `UDP ${ip.udp.sport} → ${ip.udp.dport} · DNS`), kv([
      ['id', String(q.id)], ['QR', q.response ? t('pdu.response') : t('pdu.query')], [t('pdu.question'), `${q.qname} IN ${q.qtype}`], ['rcode', q.rcode], ['AA', q.authoritative ? t('pdu.yes') : undefined],
      [t('pdu.answers'), q.answers?.map((a) => `${a.name} ${a.ttl} ${a.type} ${a.priority !== undefined ? `${a.priority} ` : ''}${a.data}`).join(' · ')],
      [t('pdu.authority'), q.authority?.map((a) => `${a.name} ${a.type}`).join(' · ')],
    ]));
  } else if (ip.tcp) {
    const tc = ip.tcp;
    out.push(el('h4', {}, `TCP ${tc.sport} → ${tc.dport} (${tcpService(tc)})`), kv([['Flags', tc.flags.join(', ')], ['seq', String(tc.seq)], ['ack', String(tc.ack)]]));
    if (tc.data) out.push(el('h4', {}, tc.data.app), kv(appFields(tc.data)));
  }
  return out;
}
