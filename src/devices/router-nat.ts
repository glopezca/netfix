/** Applies the router's NAT configuration to transit packets (inside ↔ outside). */
import type { Router } from './router.ts';
import type { IpPacket } from '../net/packets.ts';
import type { DynamicTarget, StaticNat } from '../net/nat.ts';
import { aclFirstMatch } from '../ios/acl.ts';
import type { NatPool } from '../ios/nat-config.ts';
import { effectiveAddress } from '../ios/commands/show-iface.ts';
import { formatIp } from '../core/ip.ts';

export function natRole(r: Router, iface: string): 'inside' | 'outside' | undefined {
  return r.iface(iface)?.nat;
}

function ifaceIp(r: Router, name: string): number | undefined {
  const cfg = r.iface(name);
  return cfg ? effectiveAddress(r, cfg).ip : undefined;
}

/** Static rules with `interface X` resolved to the interface's current address. */
export function resolvedStatics(r: Router): StaticNat[] {
  return r.nat.statics.flatMap((s) => {
    const global = s.globalIface ? ifaceIp(r, s.globalIface) : s.global;
    return global === undefined ? [] : [{ local: s.local, global, proto: s.proto, localPort: s.localPort, globalPort: s.globalPort }];
  });
}

/** Addresses of a pool already bound 1:1. */
export function poolInUse(r: Router, pool: NatPool): number {
  return r.natTable.entries().filter((e) => e.proto === null && e.insideGlobal >= pool.start && e.insideGlobal <= pool.end).length;
}

function permitted(r: Router, acl: string, src: number): boolean {
  const entry = aclFirstMatch(r.acls.get(acl), src);
  if (entry) r.aclHits.set(`${acl}:${entry.seq}`, (r.aclHits.get(`${acl}:${entry.seq}`) ?? 0) + 1);
  return entry?.action === 'permit';
}

function poolTarget(r: Router, poolName: string | undefined, overload: boolean, rule: number): DynamicTarget {
  const pool = r.nat.pools.find((p) => p.name === poolName);
  if (!pool) return 'exhausted';
  if (overload) return { global: pool.start, overload: true, rule };
  for (let ip = pool.start; ip <= pool.end; ip++) if (!r.natTable.globalInUse(ip)) return { global: ip, overload: false, rule };
  return 'exhausted';
}

function dynamicTarget(r: Router, p: IpPacket): DynamicTarget {
  for (const [rule, d] of r.nat.dynamic.entries()) {
    if (!permitted(r, d.acl, p.src)) continue;
    if (d.iface) {
      const ip = ifaceIp(r, d.iface);
      return ip === undefined ? 'exhausted' : { global: ip, overload: true, rule };
    }
    return poolTarget(r, d.pool, d.overload, rule);
  }
  return null;
}

function debug(r: Router, before: IpPacket, after: IpPacket, inbound: boolean): void {
  if (!r.debugNat) return;
  const s = inbound ? `${formatIp(before.src)}` : `${formatIp(before.src)}->${formatIp(after.src)}`;
  const d = inbound ? `${formatIp(before.dst)}->${formatIp(after.dst)}` : formatIp(before.dst);
  r.log(`NAT: s=${s}, d=${d} [${r.natTable.hits + r.natTable.misses}]`);
}

/** Outside → inside, before the routing decision. */
export function natPrerouting(r: Router, iface: string, p: IpPacket): IpPacket {
  if (natRole(r, iface) !== 'outside') return p;
  const out = r.natTable.outside(p, resolvedStatics(r));
  if (!out) return p;
  debug(r, p, out, true);
  return out;
}

/** Inside → outside, once the egress interface is known; null = drop (pool exhausted). */
export function natForward(r: Router, inIface: string, outIface: string, p: IpPacket): IpPacket | null {
  if (natRole(r, inIface) !== 'inside' || natRole(r, outIface) !== 'outside') return p;
  const out = r.natTable.inside(p, resolvedStatics(r), (pk) => dynamicTarget(r, pk));
  if (out === 'drop') {
    if (r.debugNat) r.log(`NAT: translation failed (A), dropping packet s=${formatIp(p.src)} d=${formatIp(p.dst)}`);
    return null;
  }
  if (!out) return p;
  debug(r, p, out, false);
  return out;
}

/** Static and pool global addresses answer ARP on outside interfaces (IOS "alias"). */
export function natAnswersArp(r: Router, iface: string, ip: number): boolean {
  if (natRole(r, iface) !== 'outside') return false;
  return resolvedStatics(r).some((s) => s.global === ip) || r.nat.pools.some((p) => ip >= p.start && ip <= p.end);
}
