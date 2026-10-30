/**
 * LLMNR (RFC 4795), built into Windows: a single-label name is asked in DNS format by multicast to 224.0.0.252,
 * UDP 5355, with TTL 1 (so never past a router), from a port of the asker's own; the Windows host whose name it is
 * answers unicast from 5355. Names are compared without case. Netfix's GNU/Linux hosts do not speak it.
 */
import type { Host } from '../devices/host.ts';
import type { IpPacket } from './packets.ts';
import type { StackHost } from './ipstack.ts';
import { registerLocalSockets } from './ipstack.ts';
import { formatIp, parseIp } from '../core/ip.ts';

export const LLMNR_GROUP = parseIp('224.0.0.252') ?? 0;
export const LLMNR_PORT = 5355;
/** Windows waits about a second for an answer (it asks twice, RETRY_MS apart, then gives up). */
export const LLMNR_WAIT_MS = 1000;
/** Without an answer, Windows asks once more. */
const RETRY_MS = 410;
const LINK_TTL = 1;
const ANSWER_TTL = 30;
/** Query ports, clear of the stub resolver's 50000-50999 and mDNS's 52000-59999. */
const FIRST_PORT = 60000;
const PORTS = 5000;

const windows = (h: object): boolean => (h as { readonly os?: string }).os === 'windows';

const waiting = new WeakMap<object, Map<number, { readonly name: string; readonly done: (ip: number) => void }>>();
let nextPort = 0;

function answer(host: Host, iface: string, p: IpPacket): void {
  const q = p.udp?.dns;
  const own = host.l3Iface(iface)?.addrs[0]?.ip;
  if (!q || !p.udp || own === undefined || q.qtype !== 'A') return;
  if (q.qname.replace(/\.$/, '').toLowerCase() !== host.runtimeName().toLowerCase()) return;
  host.sendUdp(p.src, LLMNR_PORT, p.udp.sport, { dns: { id: q.id, response: true, qname: q.qname, qtype: 'A', rcode: 'NOERROR',
    answers: [{ name: q.qname, type: 'A', ttl: ANSWER_TTL, data: formatIp(own) }] } }, own, iface);
}

function take(host: StackHost, iface: string, p: IpPacket): boolean {
  const u = p.udp;
  if (!u?.dns) return false;
  if (u.dns.response && u.sport === LLMNR_PORT) {
    const q = waiting.get(host)?.get(u.dport);
    const a = u.dns.answers?.find((x) => x.type === 'A' && x.name.toLowerCase() === q?.name);
    const ip = parseIp(a?.data ?? '');
    if (!q || ip === null) return false;
    q.done(ip);
    return true;
  }
  if (u.dns.response || u.dport !== LLMNR_PORT || p.dst !== LLMNR_GROUP || !windows(host)) return false;
  answer(host as Host, iface, p);
  return true;
}

let registered = false;

/** Windows hosts join 224.0.0.252 and answer from here on (topology.ts calls it). */
export function registerLlmnr(): void {
  if (registered) return;
  registered = true;
  registerLocalSockets({ member: (h, group) => group === LLMNR_GROUP && windows(h), take });
}

/** Asks for `name` on every link of the host; `done` gets its address, or undefined after LLMNR_WAIT_MS. */
export function llmnrLookup(host: Host, name: string, done: (ip: number | undefined) => void): void {
  registerLlmnr();
  const port = FIRST_PORT + (nextPort++ % PORTS);
  const pending = waiting.get(host) ?? new Map<number, { readonly name: string; readonly done: (ip: number) => void }>();
  waiting.set(host, pending);
  let over = false;
  const finish = (ip: number | undefined): void => {
    if (over) return;
    over = true;
    pending.delete(port);
    done(ip);
  };
  pending.set(port, { name: name.toLowerCase(), done: finish });
  host.hooks.schedule(LLMNR_WAIT_MS, () => finish(undefined));
  const ask = (): void => {
    if (over) return;
    for (const iface of host.l3Ifaces().filter((i) => i.up && i.addrs.length)) {
      host.stack.multicast(iface.name, { src: iface.addrs[0]?.ip ?? 0, dst: LLMNR_GROUP, ttl: LINK_TTL, protocol: 'udp',
        udp: { sport: port, dport: LLMNR_PORT, dns: { id: port & 0xffff, response: false, qname: name, qtype: 'A' } } });
    }
  };
  ask();
  host.hooks.schedule(RETRY_MS, ask);
}
