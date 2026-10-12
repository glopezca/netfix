/**
 * Hosts of the emulated Internet: the public DNS resolvers 8.8.8.8 / 8.8.4.4 (built-in zones, domains
 * registered at the ISP clouds, delegation to the customers' own DNS servers) and a few web servers
 * that tell the visitor its public address (useful to see NAT at work).
 */
import type { DnsMessage, IpPacket } from './packets.ts';
import { DNS_PORT } from './packets.ts';
import type { InternetCore, VirtualHost } from './internet.ts';
import { TcpLayer } from './tcp.ts';
import type { Peer } from './tcp.ts';
import type { DnsRecord } from '../services/config.ts';
import { answerQuery } from '../services/dns-service.ts';
import { normalizeName } from './dns.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { page, h } from '../web/html.ts';
import { respond } from '../web/http.ts';
import type { HttpRequest } from '../web/http.ts';

const ip = (t: string): number => parseIp(t) ?? 0;
export const GOOGLE_DNS = [ip('8.8.8.8'), ip('8.8.4.4')] as const;
const GOOGLE_HOP = ip('142.250.0.1');
const EDGE_HOP = ip('203.0.113.1');
const HOST_TTL = 64;
const RECORD_TTL = 300;
const FORWARD_TIMEOUT_MS = 2000;
const FIRST_QUERY_PORT = 30000;
const QUERY_PORTS = 20000;

interface Site {
  readonly name: string;
  readonly ip: number;
  readonly plain?: boolean;
}

const SITES: readonly Site[] = [
  { name: 'www.google.com', ip: ip('142.250.184.4') },
  { name: 'example.com', ip: ip('93.184.215.14') },
  { name: 'ifconfig.me', ip: ip('34.160.111.145'), plain: true },
];

const A = (name: string, value: string): DnsRecord => ({ name, type: 'A', value, ttl: RECORD_TTL });

/** Built-in public zones (origin → records). */
const ZONES: readonly { origin: string; records: readonly DnsRecord[] }[] = [
  { origin: 'google.com', records: [A('google.com', '142.250.184.4'), A('www.google.com', '142.250.184.4')] },
  { origin: 'dns.google', records: [A('dns.google', '8.8.8.8'), A('dns.google', '8.8.4.4')] },
  { origin: 'example.com', records: [A('example.com', '93.184.215.14'), A('www.example.com', '93.184.215.14')] },
  { origin: 'ifconfig.me', records: [A('ifconfig.me', '34.160.111.145')] },
];

function inZone(qname: string, origin: string): boolean {
  return qname === origin || qname.endsWith(`.${origin}`);
}

/** 8.8.8.8 and 8.8.4.4: echo, and DNS over UDP. */
class PublicDns implements VirtualHost {
  readonly ips = GOOGLE_DNS;
  readonly hop = GOOGLE_HOP;
  private readonly core: InternetCore;
  private readonly pending = new Map<number, { client: number; port: number; id: number; via: number; done: boolean }>();
  private nextPort = 0;

  constructor(core: InternetCore) {
    this.core = core;
  }

  receive(p: IpPacket): void {
    if (p.icmp?.type === 'echo-request') return this.core.send({ src: p.dst, dst: p.src, ttl: HOST_TTL, protocol: 'icmp', icmp: { ...p.icmp, type: 'echo-reply' } });
    const dns = p.udp?.dns;
    if (!dns || !p.udp) return;
    if (dns.response) return this.onUpstream(p.udp.dport, dns);
    // never answer the emulated Internet itself (a domain delegated to 8.8.8.8 would loop forever)
    if (p.udp.dport === DNS_PORT && !this.core.isVirtual(p.src)) this.resolve(p, dns);
  }

  private reply(via: number, to: number, port: number, msg: DnsMessage): void {
    this.core.send({ src: via, dst: to, ttl: HOST_TTL, protocol: 'udp', udp: { sport: DNS_PORT, dport: port, dns: msg } });
  }

  private resolve(p: IpPacket, q: DnsMessage): void {
    const qname = normalizeName(q.qname);
    const zone = ZONES.find((z) => inZone(qname, z.origin));
    if (zone) return this.reply(p.dst, p.src, p.udp?.sport ?? 0, { ...answerQuery(q, zone.records, zone.origin), authoritative: false });
    const reg = this.core.domains().filter((d) => inZone(qname, d.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (!reg) return this.reply(p.dst, p.src, p.udp?.sport ?? 0, { id: q.id, response: true, qname, qtype: q.qtype, rcode: 'NXDOMAIN', answers: [] });
    if (reg.kind === 'a') {
      const records = [A(reg.name, formatIp(reg.ip)), A(`*.${reg.name}`, formatIp(reg.ip))];
      return this.reply(p.dst, p.src, p.udp?.sport ?? 0, { ...answerQuery(q, records, reg.name), authoritative: false });
    }
    this.forward(p, q, reg.ip);
  }

  /** Recursion: asks the domain's own name server and relays the answer. */
  private forward(p: IpPacket, q: DnsMessage, server: number): void {
    if (this.core.isVirtual(server)) return this.reply(p.dst, p.src, p.udp?.sport ?? 0, { id: q.id, response: true, qname: q.qname, qtype: q.qtype, rcode: 'SERVFAIL', answers: [] });
    const sport = FIRST_QUERY_PORT + (this.nextPort++ % QUERY_PORTS);
    const entry = { client: p.src, port: p.udp?.sport ?? 0, id: q.id, via: p.dst, done: false };
    this.pending.set(sport, entry);
    this.core.send({ src: p.dst, dst: server, ttl: HOST_TTL, protocol: 'udp', udp: { sport, dport: DNS_PORT, dns: { ...q, id: sport } } });
    this.core.later(FORWARD_TIMEOUT_MS, () => {
      if (entry.done) return;
      this.pending.delete(sport);
      this.reply(entry.via, entry.client, entry.port, { id: entry.id, response: true, qname: q.qname, qtype: q.qtype, rcode: 'SERVFAIL', answers: [] });
    });
  }

  private onUpstream(port: number, answer: DnsMessage): void {
    const entry = this.pending.get(port);
    if (!entry) return;
    entry.done = true;
    this.pending.delete(port);
    this.reply(entry.via, entry.client, entry.port, { ...answer, id: entry.id, authoritative: false });
  }
}

function sitePage(site: Site, req: HttpRequest, peer: Peer): string {
  const you = formatIp(peer.ip);
  if (site.plain) return `${you}\n`;
  return page(site.name, '',
    h('h1', {}, site.name),
    h('p', {}, 'Servidor web de la Internet emulada de Netfix.'),
    h('p', {}, 'Tu dirección IP pública: ', h('strong', {}, you)),
    h('p', {}, `Host solicitado: ${req.headers?.host ?? req.host} · ruta: ${req.path}`),
    h('p', {}, 'Si tu equipo tiene una IP privada (192.168.x.x, 10.x.x.x), lo que ves aquí es la dirección que le ha puesto el NAT del router.'),
    h('p', { class: 'web-brand-foot' }, h('span', { class: 'web-brand-iso' }, 'Netfix'), 'Internet emulada por Netfix'));
}

class WebSite implements VirtualHost {
  readonly ips: readonly number[];
  readonly hop = EDGE_HOP;
  private readonly tcp: TcpLayer;
  private readonly core: InternetCore;

  constructor(core: InternetCore, site: Site) {
    this.core = core;
    this.ips = [site.ip];
    this.tcp = new TcpLayer({ send: (p) => { core.send(p); return true; }, sourceFor: () => site.ip, schedule: (d, fn) => core.later(d, fn), ttl: HOST_TTL });
    this.tcp.listen(80, (req, peer) => {
      if (req.app !== 'HTTP' || req.kind !== 'request') return null;
      const body = sitePage(site, req, peer);
      return respond('ECS (Netfix)', 200, req.method === 'HEAD' ? '' : body, {}, site.plain ? 'text/plain; charset=UTF-8' : 'text/html; charset=UTF-8');
    });
  }

  receive(p: IpPacket): void {
    if (p.icmp?.type === 'echo-request') return this.core.send({ src: p.dst, dst: p.src, ttl: HOST_TTL, protocol: 'icmp', icmp: { ...p.icmp, type: 'echo-reply' } });
    if (p.tcp) this.tcp.receive(p);
  }
}

export function populateInternet(core: InternetCore): void {
  core.addHost(new PublicDns(core));
  for (const s of SITES) core.addHost(new WebSite(core, s));
}
