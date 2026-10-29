/**
 * mDNS (RFC 6762) for hosts with avahi-daemon or libnss-mdns installed: `ping pc1.local` asks the link by multicast
 * (224.0.0.251:5353, never routed) and the host whose name it is answers if it runs avahi-daemon, with a unicast reply
 * to the asking port (a «legacy» one-shot query, as nss-mdns sends). The packets cross the simulated network: switches
 * flood them, routers stop them, nftables can drop them.
 */
import type { Host } from '../devices/host.ts';
import type { IpPacket } from './packets.ts';
import type { StackHost } from './ipstack.ts';
import { registerLocalSockets } from './ipstack.ts';
import { hasPackage } from './host-packages.ts';
import { runSync } from './sync.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export const MDNS_GROUP = parseIp('224.0.0.251') ?? 0;
export const MDNS_PORT = 5353;
/** nss-mdns gives up after about a second without an answer. */
const QUERY_MS = 1000;
const LINK_LOCAL_TTL = 255;
const ANSWER_TTL = 120;
/** One-shot query ports, clear of the stub resolver's 50000-50999. */
const FIRST_PORT = 52000;
const PORTS = 8000;

/** avahi-daemon answers for the host's name. */
const answers = (h: object): boolean => hasPackage(h, 'avahi-daemon');

/** libnss-mdns (avahi-daemon brings it) makes the resolver ask mDNS for names under .local. */
export const asksMdns = (h: object): boolean => hasPackage(h, 'avahi-daemon') || hasPackage(h, 'libnss-mdns');

const waiting = new WeakMap<object, Map<number, (ip: number) => void>>();
let nextPort = 0;

function answer(host: Host, iface: string, p: IpPacket): void {
  const q = p.udp?.dns;
  const own = host.l3Iface(iface)?.addrs[0]?.ip;
  if (!q || !p.udp || own === undefined || q.qtype !== 'A') return;
  // The name the host goes by now (hostname / hostnamectl change it), as avahi publishes it.
  if (q.qname.replace(/\.$/, '').toLowerCase() !== `${host.runtimeName().toLowerCase()}.local`) return;
  const reply = { id: q.id, response: true, authoritative: true, qname: q.qname, qtype: 'A' as const, rcode: 'NOERROR' as const,
    answers: [{ name: q.qname, type: 'A' as const, ttl: ANSWER_TTL, data: formatIp(own) }] };
  host.sendUdp(p.src, MDNS_PORT, p.udp.sport, { dns: reply }, own, iface);
}

function take(host: StackHost, iface: string, p: IpPacket): boolean {
  const u = p.udp;
  if (!u?.dns) return false;
  if (u.dns.response && u.sport === MDNS_PORT) {
    const done = waiting.get(host)?.get(u.dport);
    const ip = parseIp(u.dns.answers?.find((a) => a.type === 'A')?.data ?? '');
    if (!done || ip === null) return false;
    done(ip);
    return true;
  }
  if (u.dport !== MDNS_PORT || p.dst !== MDNS_GROUP || !answers(host)) return false;
  answer(host as Host, iface, p);
  return true;
}

let registered = false;

/** Hosts join 224.0.0.251 and answer from here on (topology.ts calls it, so a loaded network answers at once). */
export function registerMdns(): void {
  if (registered) return;
  registered = true;
  registerLocalSockets({ member: (h, group) => group === MDNS_GROUP && answers(h), take });
}

/** The address of `name` (…​.local) on the host's links, or undefined when nobody answers. */
export function mdnsResolve(host: Host, name: string): number | undefined {
  registerMdns();
  const port = FIRST_PORT + (nextPort++ % PORTS);
  const pending = waiting.get(host) ?? new Map<number, (ip: number) => void>();
  waiting.set(host, pending);
  const ip = runSync<number | undefined>(host.hooks, (done) => {
    pending.set(port, done);
    host.hooks.schedule(QUERY_MS, () => done(undefined));
    for (const iface of host.l3Ifaces().filter((i) => i.up && i.addrs.length)) {
      host.stack.multicast(iface.name, { src: iface.addrs[0]?.ip ?? 0, dst: MDNS_GROUP, ttl: LINK_LOCAL_TTL, protocol: 'udp',
        udp: { sport: port, dport: MDNS_PORT, dns: { id: port & 0xffff, response: false, qname: name, qtype: 'A' } } });
    }
  }, QUERY_MS + 500);
  pending.delete(port);
  return ip;
}
