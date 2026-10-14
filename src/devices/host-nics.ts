/** NICs and routing table of a host: connected networks, static routes (ip route add) and the default route. */
import type { Egress } from '../net/ipstack.ts';
import { inSubnet, networkOf, BROADCAST_IP } from '../core/ip.ts';

export interface NicInfo {
  /** Device port (FastEthernet0, GigabitEthernet0/1…) and its Linux name (eth0…). */
  readonly port: string;
  readonly linux: string;
  readonly mac: string;
  /** Administratively up (ip link set … up) and with the cable connected. */
  readonly up: boolean;
  readonly adminUp: boolean;
  readonly ip?: number;
  readonly prefix?: number;
  readonly dhcp: boolean;
}

export interface StaticRoute {
  readonly net: number;
  readonly prefix: number;
  readonly via: number;
}

export const MAX_STATIC_ROUTES = 64;

/** Connected networks first, then the most specific static route, then the default gateway. */
export function lookupRoute(nics: readonly NicInfo[], routes: readonly StaticRoute[], gateway: number | undefined, dst: number): Egress | null {
  const live = nics.filter((n) => n.up && n.ip !== undefined && n.prefix !== undefined);
  const connected = live.filter((n) => inSubnet(dst, n.ip as number, n.prefix as number)).sort((a, b) => (b.prefix ?? 0) - (a.prefix ?? 0))[0];
  if (connected) return { iface: connected.port, nextHop: dst };
  if (dst === BROADCAST_IP && live[0]) return { iface: live[0].port, nextHop: dst };
  const via = (gw: number): Egress | null => {
    const nic = live.find((n) => inSubnet(gw, n.ip as number, n.prefix as number));
    return nic ? { iface: nic.port, nextHop: gw } : null;
  };
  const best = [...routes].filter((r) => inSubnet(dst, r.net, r.prefix)).sort((a, b) => b.prefix - a.prefix)[0];
  if (best) return via(best.via);
  return gateway !== undefined ? via(gateway) : null;
}

/** Normalises a route destination to its network address. */
export function routeTo(net: number, prefix: number, via: number): StaticRoute {
  return { net: networkOf(net, prefix), prefix, via };
}
