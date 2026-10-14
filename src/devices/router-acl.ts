/** `ip access-group` on IOS interfaces: inbound before NAT and routing, outbound on transit packets. */
import type { Router } from './router.ts';
import type { IpPacket } from '../net/packets.ts';
import { aclPacketMatch } from '../ios/acl.ts';
import { formatIp } from '../core/ip.ts';

/** Does `acl` let `p` through? A missing list permits everything, like IOS; the hit is counted and logged. */
export function aclAllows(r: Router, acl: string | undefined, p: IpPacket): boolean {
  if (acl === undefined) return true;
  const entries = r.acls.get(acl);
  if (!entries) return true;
  const hit = aclPacketMatch(entries, p);
  if (!hit) return false;
  const key = `${acl}:${hit.seq}`;
  r.aclHits.set(key, (r.aclHits.get(key) ?? 0) + 1);
  if (hit.ext?.log) {
    const l4 = p.tcp ?? p.udp;
    const ports = (ip: number, port: number | undefined): string => (port === undefined ? formatIp(ip) : `${formatIp(ip)}(${port})`);
    r.log(`%SEC-6-IPACCESSLOGP: list ${acl} ${hit.action === 'permit' ? 'permitted' : 'denied'} ${p.protocol} ${ports(p.src, l4?.sport)} -> ${ports(p.dst, l4?.dport)}, 1 packet`);
  }
  return hit.action === 'permit';
}

export function inboundAllowed(r: Router, iface: string, p: IpPacket): boolean {
  return aclAllows(r, r.iface(iface)?.accessIn, p);
}

export function outboundAllowed(r: Router, iface: string, p: IpPacket): boolean {
  return aclAllows(r, r.iface(iface)?.accessOut, p);
}
