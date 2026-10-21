/**
 * The DNS hierarchy of the emulated Internet, for iterative resolution: the 13 root servers refer to the servers of
 * each top-level domain, these refer to the domain's own name servers (the public zones, a registrar for domains
 * registered at an ISP cloud with an address, or the customer's server for domains delegated to it), and those
 * answer with authority. Every step is a real UDP exchange, visible in simulation mode.
 */
import type { DnsAnswer, DnsMessage, IpPacket } from './packets.ts';
import { DNS_PORT } from './packets.ts';
import type { InternetCore, VirtualHost } from './internet.ts';
import { ROOT_IPS, ROOT_SERVERS } from './dns-roots.ts';
import { ZONES, inZone } from './internet-zones.ts';
import { A } from './internet-zones.ts';
import { answerQuery } from '../services/dns-service.ts';
import { normalizeName } from './dns.ts';
import { formatIp, parseIp } from '../core/ip.ts';

const ip = (t: string): number => parseIp(t) ?? 0;
const HOST_TTL = 64;
const REFERRAL_TTL = 172800;
const SOA_TTL = 86400;

interface Server { readonly name: string; readonly ip: string }

const TLDS: Readonly<Record<string, Server>> = {
  com: { name: 'a.gtld-servers.net', ip: '192.5.6.30' }, net: { name: 'a.gtld-servers.net', ip: '192.5.6.30' },
  org: { name: 'a0.org.afilias-nst.info', ip: '199.19.56.1' }, es: { name: 'a.nic.es', ip: '194.69.254.1' },
  me: { name: 'a0.nic.me', ip: '199.253.59.1' }, google: { name: 'ns-tld1.charlestonroadregistry.com', ip: '216.239.32.105' },
  arpa: { name: 'a.ns.arpa', ip: '199.180.182.53' },
};
/** Any other top-level domain of a domain registered at an ISP cloud. */
const GENERIC_TLD_IP = '192.0.47.53';
/** DNS of the registrar that publishes the domains registered with an address (no server of their own). */
const REGISTRAR: Server = { name: 'ns1.registro-isp.net', ip: '203.0.113.53' };

const tldOf = (name: string): string => name.split('.').pop() ?? '';
const tldServer = (tld: string): Server => TLDS[tld] ?? { name: `a.nic.${tld}`, ip: GENERIC_TLD_IP };
const ns = (zone: string, s: Server): DnsAnswer => ({ name: zone, type: 'NS', ttl: REFERRAL_TTL, data: s.name });
const glue = (s: Server): DnsAnswer => ({ name: s.name, type: 'A', ttl: REFERRAL_TTL, data: s.ip });
const soa = (zone: string, mname: string): DnsAnswer => ({ name: zone, type: 'SOA', ttl: SOA_TTL, data: `${mname} hostmaster.${zone || 'root-servers.net'} 2026102100 1800 900 604800 ${SOA_TTL}` });

abstract class DnsHost implements VirtualHost {
  abstract readonly ips: readonly number[];
  abstract readonly hop: number;
  protected readonly core: InternetCore;

  constructor(core: InternetCore) {
    this.core = core;
  }

  receive(p: IpPacket): void {
    if (p.icmp?.type === 'echo-request') return this.core.send({ src: p.dst, dst: p.src, ttl: HOST_TTL, protocol: 'icmp', icmp: { ...p.icmp, type: 'echo-reply' } });
    const q = p.udp?.dns;
    if (!q || q.response || p.udp?.dport !== DNS_PORT || this.core.isVirtual(p.src)) return;
    const base = { id: q.id, response: true, qname: normalizeName(q.qname), qtype: q.qtype, rd: q.rd, ra: false };
    this.core.send({ src: p.dst, dst: p.src, ttl: HOST_TTL, protocol: 'udp', udp: { sport: DNS_PORT, dport: p.udp.sport, dns: { ...base, ...this.answer(q, base.qname) } } });
  }

  protected abstract answer(q: DnsMessage, qname: string): Partial<DnsMessage>;

  /** Registered domains (and public zones) the hierarchy knows, longest first. */
  protected known(): { name: string; kind: 'a' | 'ns' | 'zone'; server: Server }[] {
    const zones = ZONES.filter((z) => z.ns).map((z) => ({ name: z.origin, kind: 'zone' as const, server: z.ns as Server }));
    const regs = this.core.domains().map((d) => ({ name: normalizeName(d.name), kind: d.kind, server: d.kind === 'ns' ? { name: `ns1.${normalizeName(d.name)}`, ip: formatIp(d.ip) } : REGISTRAR }));
    return [...zones, ...regs].sort((a, b) => b.name.length - a.name.length);
  }
}

/** a.root-servers.net … m.root-servers.net: referrals to the TLD servers. */
class RootDns extends DnsHost {
  readonly ips = ROOT_IPS;
  readonly hop = ip('199.7.91.1');

  protected answer(q: DnsMessage, qname: string): Partial<DnsMessage> {
    if (qname === '') return q.qtype === 'NS' ? { rcode: 'NOERROR', authoritative: true, answers: ROOT_SERVERS.map((r) => ns('', r)) } : { rcode: 'NOERROR', authoritative: true, answers: [], authority: [soa('', 'a.root-servers.net')] };
    const tld = tldOf(qname);
    const exists = TLDS[tld] !== undefined || this.known().some((d) => tldOf(d.name) === tld);
    if (!exists) return { rcode: 'NXDOMAIN', authoritative: true, answers: [], authority: [soa('', 'a.root-servers.net')] };
    const server = tldServer(tld);
    return { rcode: 'NOERROR', authoritative: false, answers: [], authority: [ns(tld, server)], additional: [glue(server)] };
  }
}

/** The TLD servers: referrals to the domain's servers; in-addr.arpa answered here (PTR of the public zones). */
class TldDns extends DnsHost {
  readonly ips = [...new Set([...Object.values(TLDS).map((s) => s.ip), GENERIC_TLD_IP])].map(ip);
  readonly hop = ip('192.5.6.1');

  protected answer(q: DnsMessage, qname: string): Partial<DnsMessage> {
    const tld = tldOf(qname);
    const reverse = ZONES.find((z) => z.origin === 'in-addr.arpa');
    if (reverse && inZone(qname, 'in-addr.arpa')) return { ...answerQuery(q, reverse.records, reverse.origin), ra: false };
    const domain = this.known().find((d) => inZone(qname, d.name));
    if (!domain) return { rcode: qname === tld ? 'NOERROR' : 'NXDOMAIN', authoritative: true, answers: [], authority: [soa(tld, tldServer(tld).name)] };
    return { rcode: 'NOERROR', authoritative: false, answers: [], authority: [ns(domain.name, domain.server)], additional: [glue(domain.server)] };
  }
}

/** Authoritative servers of the public zones and the registrar's DNS for domains registered with an address. */
class AuthDns extends DnsHost {
  readonly ips = [...new Set([...ZONES.flatMap((z) => (z.ns ? [z.ns.ip] : [])), REGISTRAR.ip])].map(ip);
  readonly hop = ip('216.239.32.1');

  protected answer(q: DnsMessage, qname: string): Partial<DnsMessage> {
    const zone = ZONES.filter((z) => z.ns && inZone(qname, z.origin)).sort((a, b) => b.origin.length - a.origin.length)[0];
    if (zone) return { ...answerQuery(q, zone.records, zone.origin), ra: false };
    const reg = this.core.domains().filter((d) => d.kind === 'a' && inZone(qname, normalizeName(d.name))).sort((a, b) => b.name.length - a.name.length)[0];
    if (!reg) return { rcode: 'REFUSED', answers: [] };
    const name = normalizeName(reg.name);
    return { ...answerQuery(q, [A(name, formatIp(reg.ip)), A(`*.${name}`, formatIp(reg.ip))], name), ra: false };
  }
}

export function addDnsHierarchy(core: InternetCore): void {
  core.addHost(new RootDns(core));
  core.addHost(new TldDns(core));
  core.addHost(new AuthDns(core));
}
