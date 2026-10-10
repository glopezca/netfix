/** IPv4 routing table built from connected interfaces and static routes. */
import { networkOf, formatIp, inSubnet, classfulPrefix } from '../core/ip.ts';
import type { IosDevice } from '../ios/device.ts';
import { effectiveAddress } from '../ios/commands/show-iface.ts';

export type RouteCode = 'C' | 'L' | 'S';

export interface Route {
  readonly code: RouteCode;
  readonly network: number;
  readonly prefix: number;
  readonly iface?: string;
  readonly nextHop?: number;
  readonly distance: number;
}

export interface StaticRouteInput {
  readonly network: number;
  readonly prefix: number;
  readonly nextHop?: number;
  readonly iface?: string;
  readonly distance: number;
}

const HOST_PREFIX = 32;

export function connectedRoutes(device: IosDevice): Route[] {
  const routes: Route[] = [];
  for (const name of device.sortedIfaceNames()) {
    const cfg = device.iface(name);
    if (!cfg || cfg.switchport || !device.ifaceRuntime(name).protocolUp) continue;
    const primary = effectiveAddress(device, cfg);
    const addrs = [
      ...(primary.ip !== undefined && primary.prefix !== undefined ? [{ ip: primary.ip, prefix: primary.prefix }] : []),
      ...cfg.secondaries,
    ];
    for (const a of addrs) {
      routes.push({ code: 'C', network: networkOf(a.ip, a.prefix), prefix: a.prefix, iface: name, distance: 0 });
      routes.push({ code: 'L', network: a.ip, prefix: HOST_PREFIX, iface: name, distance: 0 });
    }
  }
  return routes;
}

/** Static routes are installed only when their next hop is reachable or their interface is up. */
export function buildRoutingTable(device: IosDevice, statics: readonly StaticRouteInput[]): Route[] {
  const connected = connectedRoutes(device);
  const installed = statics.filter((s) => {
    if (s.iface) return device.ifaceRuntime(s.iface).protocolUp;
    return s.nextHop !== undefined && connected.some((c) => c.code === 'C' && inSubnet(s.nextHop!, c.network, c.prefix));
  });
  const best = new Map<string, Route>();
  for (const s of installed) {
    const key = `${s.network}/${s.prefix}`;
    const prev = best.get(key);
    if (!prev || s.distance < prev.distance) best.set(key, { code: 'S', ...s });
  }
  return [...connected, ...best.values()];
}

export function lookupRoute(table: readonly Route[], dst: number): Route | undefined {
  let match: Route | undefined;
  for (const r of table) {
    if (!inSubnet(dst, r.network, r.prefix)) continue;
    if (!match || r.prefix > match.prefix || (r.prefix === match.prefix && r.distance < match.distance)) match = r;
  }
  return match;
}

/** Resolves recursive static routes to an egress interface and next hop. */
export function resolveEgress(table: readonly Route[], dst: number): { iface: string; nextHop: number } | null {
  let target = dst;
  for (let depth = 0; depth < 4; depth++) {
    const r = lookupRoute(table, target);
    if (!r) return null;
    if (r.iface && r.nextHop === undefined) return { iface: r.iface, nextHop: r.code === 'S' ? dst : target };
    if (r.nextHop === undefined) return null;
    const via = lookupRoute(table, r.nextHop);
    if (via?.iface && via.code !== 'S') return { iface: via.iface, nextHop: r.nextHop };
    target = r.nextHop;
  }
  return null;
}

const CODES_HEADER = [
  'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
  '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
  '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
  '       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP',
  '       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area',
  '       * - candidate default, U - per-user static route, o - ODR',
  '       P - periodic downloaded static route',
  '',
];

function routeText(r: Route, indent: string): string {
  const isDefault = r.prefix === 0;
  const code = `${r.code}${isDefault ? '*' : ' '}`;
  const dest = `${formatIp(r.network)}/${r.prefix}`;
  if (r.code === 'S') {
    const via = r.nextHop !== undefined ? `via ${formatIp(r.nextHop)}` : `is directly connected, ${r.iface}`;
    return `${code}${indent}${dest} [${r.distance}/0] ${via}`;
  }
  return `${code}${indent}${dest} is directly connected, ${r.iface}`;
}

export function showIpRoute(table: readonly Route[]): string[] {
  const def = table.find((r) => r.prefix === 0);
  const gateway = def?.nextHop !== undefined
    ? `Gateway of last resort is ${formatIp(def.nextHop)} to network 0.0.0.0`
    : 'Gateway of last resort is not set';
  const groups = new Map<number, Route[]>();
  for (const r of [...table].sort((a, b) => a.network - b.network || a.prefix - b.prefix)) {
    const major = r.prefix === 0 ? 0 : networkOf(r.network, classfulPrefix(r.network));
    groups.set(major, [...(groups.get(major) ?? []), r]);
  }
  const lines = [...CODES_HEADER, gateway, ''];
  for (const [major, routes] of groups) {
    const masks = new Set(routes.map((r) => r.prefix));
    if (major !== 0 && (routes.length > 1 || masks.size > 1)) {
      const kind = masks.size > 1 ? `is variably subnetted, ${routes.length} subnets, ${masks.size} masks` : `is subnetted, ${routes.length} subnets`;
      const head = masks.size > 1 ? `${formatIp(major)}/${classfulPrefix(major)}` : `${formatIp(major)}/${[...masks][0]}`;
      lines.push(`     ${head} ${kind}`);
      routes.forEach((r) => lines.push(routeText(r, '       ')));
    } else {
      routes.forEach((r) => lines.push(routeText(r, '   ')));
    }
  }
  return lines;
}
