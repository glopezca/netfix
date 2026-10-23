/** bind9 on Server: authoritative answers for its zones and, with recursion on, forwarding and/or iteration for allowed clients. */
import type { DnsMessage, IpPacket } from '../net/packets.ts';
import { DNS_PORT } from '../net/packets.ts';
import type { DnsSettings } from './config.ts';
import { answerFromZones } from './dns-service.ts';
import { servedZones } from './dns-zones.ts';
import { DEFAULT_MAX_CACHE_TTL, iterates } from './named-options.ts';
import { ROOT_IPS } from '../net/dns-roots.ts';
import { DnsForwarder, recursionAllowed } from './dns-forwarder.ts';
import { formatIp } from '../core/ip.ts';

export interface DnsHost {
  readonly services: { readonly dns: DnsSettings };
  readonly config: { readonly ip?: number; readonly prefix?: number };
  sendUdp(dst: number, sport: number, dport: number, body: { dns: DnsMessage }): boolean;
  log(unit: 'dns', line: string): void;
  readonly hooks: { schedule(delayMs: number, fn: () => void): void };
  readonly clock: { now(): number };
  /** Whether bind listens on the address `dst` (listen-on). */
  dnsListensOn(dst: number): boolean;
}

export class ServerDns {
  private readonly host: DnsHost;
  readonly forwarder: DnsForwarder;

  constructor(host: DnsHost) {
    this.host = host;
    this.forwarder = new DnsForwarder({
      send: (dst, sport, msg) => { host.sendUdp(dst, sport, DNS_PORT, { dns: msg }); },
      reply: (to, port, msg) => { host.sendUdp(to, DNS_PORT, port, { dns: msg }); },
      schedule: (d, fn) => host.hooks.schedule(d, fn),
      now: () => host.clock.now(),
      log: (l) => host.log('dns', l),
    });
  }

  /** Handles a DNS datagram; false when it is not for bind (another service may want it). */
  handle(packet: IpPacket): boolean {
    const udp = packet.udp;
    const dns = udp?.dns;
    if (!udp || !dns) return false;
    if (dns.response) return this.forwarder.onResponse(udp.dport, dns, packet.src);
    if (udp.dport !== DNS_PORT || !this.host.services.dns.enabled) return false;
    // listen-on: bind has no socket on that address, so the query is lost (as with the service stopped).
    if (!this.host.dnsListensOn(packet.dst)) return true;
    this.query(packet.src, udp.sport, packet.dst, dns);
    return true;
  }

  private query(src: number, sport: number, dst: number, q: DnsMessage): void {
    const s = this.host.services.dns;
    const forwarders = s.forwarders ?? [];
    const recursion = s.recursion === true && recursionAllowed(s.allowRecursion ?? 'localnets', src, this.host.config);
    const answer = answerFromZones(q, servedZones(s));
    const head = `client ${formatIp(src)}#${sport} (${q.qname}): query: ${q.qname} IN ${q.qtype} ${q.rd === false ? '-' : '+'} (${formatIp(dst)})`;
    if (answer.rcode === 'REFUSED' && recursion && q.rd !== false) {
      const iterate = iterates(s);
      this.host.log('dns', `${head} → ${forwarders.length ? `forwarding to ${forwarders.map(formatIp).join(', ')}${iterate ? ' (then iterative)' : ''}` : 'iterative resolution'}`);
      this.forwarder.resolve(q, src, sport, { forwarders, iterate, roots: ROOT_IPS, maxTtl: s.maxCacheTtl ?? DEFAULT_MAX_CACHE_TTL });
      return;
    }
    this.host.log('dns', `${head} → ${answer.rcode}`);
    this.host.sendUdp(src, DNS_PORT, sport, { dns: { ...answer, rd: q.rd, ra: recursion } });
  }
}
