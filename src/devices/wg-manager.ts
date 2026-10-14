/**
 * Virtual links of the Linux router (WireGuard wgN): creation and removal (`ip link add … type
 * wireguard`), addresses, device routes (`ip route add NET dev wg0`, wg-quick's AllowedIPs) and the
 * routing decision that puts them next to the NICs, the static routes and the default gateway.
 */
import type { Egress, L3Iface } from '../net/ipstack.ts';
import type { IpPacket } from '../net/packets.ts';
import type { Cidr } from '../net/wg-config.ts';
import { inCidr, networkCidr } from '../net/wg-config.ts';
import type { NicInfo, StaticRoute } from './host-nics.ts';
import { lookupRoute } from './host-nics.ts';
import { WgInterface } from './wireguard.ts';
import type { WgHost } from './wireguard.ts';
import { inSubnet } from '../core/ip.ts';

/** A route through a device without a gateway; table 51820 = wg-quick's full-tunnel default. */
export interface DevRoute {
  readonly net: number;
  readonly prefix: number;
  readonly dev: string;
  readonly table?: number;
}

export interface VirtualLink {
  readonly name: string;
  readonly up: boolean;
  readonly mtu: number;
  readonly addresses: readonly Cidr[];
}

export const WG_TABLE = 51820;
const MAX_LINKS = 8;
const MAX_DEV_ROUTES = 64;
const EXISTS = 'RTNETLINK answers: File exists';

export interface RouteInputs {
  readonly nics: readonly NicInfo[];
  readonly statics: readonly StaticRoute[];
  readonly gateway: number | undefined;
}

export class WgManager {
  readonly links = new Map<string, WgInterface>();
  devRoutes: readonly DevRoute[] = [];
  private readonly host: WgHost;
  private readonly changed: () => void;

  constructor(host: WgHost, changed: () => void) {
    this.host = host;
    this.changed = changed;
  }

  get(name: string): WgInterface | undefined {
    return this.links.get(name);
  }

  add(name: string): string | null {
    if (this.links.has(name)) return EXISTS;
    if (!/^wg\d{1,2}$/.test(name)) return `Netfix: only WireGuard links named wgN can be created ("${name}").`;
    if (this.links.size >= MAX_LINKS) return 'RTNETLINK answers: No buffer space available';
    this.links.set(name, new WgInterface(name, this.host));
    this.changed();
    return null;
  }

  remove(name: string): string | null {
    const link = this.links.get(name);
    if (!link) return `Cannot find device "${name}"`;
    link.shutdown();
    this.links.delete(name);
    this.devRoutes = this.devRoutes.filter((r) => r.dev !== name);
    this.changed();
    return null;
  }

  setUp(name: string, up: boolean): void {
    const link = this.links.get(name);
    if (!link || link.up === up) return;
    link.up = up;
    this.changed();
  }

  addAddress(name: string, c: Cidr): string | null {
    const link = this.links.get(name);
    if (!link) return `Cannot find device "${name}"`;
    if (link.addresses.some((a) => a.ip === c.ip && a.prefix === c.prefix)) return EXISTS;
    link.addresses = [...link.addresses, c];
    this.changed();
    return null;
  }

  delAddress(name: string, c: Cidr | undefined): string | null {
    const link = this.links.get(name);
    if (!link) return `Cannot find device "${name}"`;
    const keep = c ? link.addresses.filter((a) => a.ip !== c.ip) : [];
    if (c && keep.length === link.addresses.length) return 'RTNETLINK answers: Cannot assign requested address';
    link.addresses = keep;
    this.changed();
    return null;
  }

  addRoute(r: DevRoute): string | null {
    if (!this.links.has(r.dev)) return `Cannot find device "${r.dev}"`;
    const net = networkCidr({ ip: r.net, prefix: r.prefix });
    if (this.devRoutes.some((x) => x.net === net.ip && x.prefix === r.prefix && (x.table ?? 0) === (r.table ?? 0))) return EXISTS;
    if (this.devRoutes.length >= MAX_DEV_ROUTES) return 'RTNETLINK answers: No buffer space available';
    this.devRoutes = [...this.devRoutes, { ...r, net: net.ip }];
    this.changed();
    return null;
  }

  delRoute(net: number, prefix: number, table?: number): string | null {
    const before = this.devRoutes.length;
    this.devRoutes = this.devRoutes.filter((x) => !(x.net === net && x.prefix === prefix && (table === undefined || (x.table ?? 0) === table)));
    if (this.devRoutes.length === before) return 'RTNETLINK answers: No such process';
    this.changed();
    return null;
  }

  virtualLinks(): VirtualLink[] {
    return [...this.links.values()].map((l) => ({ name: l.name, up: l.up, mtu: l.mtu, addresses: l.addresses }));
  }

  l3Ifaces(): L3Iface[] {
    return [...this.links.values()].map((l) => ({ name: l.name, mac: '', addrs: l.addresses, up: l.up, pointToPoint: true }));
  }

  /** A packet routed into a wg link: false when no peer's AllowedIPs covers it. */
  transmit(name: string, packet: IpPacket): boolean {
    const link = this.links.get(name);
    return link?.up ? link.send(packet) : false;
  }

  private liveRoutes(table: 'main' | 'all'): DevRoute[] {
    return this.devRoutes.filter((r) => this.links.get(r.dev)?.up && (table === 'all' || r.table === undefined));
  }

  /**
   * Longest prefix over connected NICs, wg addresses, device routes and static routes; then wg-quick's
   * full-tunnel table (unless `table` is 'main', as for WireGuard's own datagrams) and the gateway.
   */
  route(dst: number, inputs: RouteInputs, table: 'main' | 'all'): Egress | null {
    const connected = lookupRoute(inputs.nics, [], undefined, dst);
    if (connected) return connected;
    const wgNet = [...this.links.values()].find((l) => l.up && l.addresses.some((a) => inCidr(a, dst)));
    if (wgNet) return { iface: wgNet.name, nextHop: dst };
    const dev = this.liveRoutes('main').filter((r) => r.prefix > 0 && inCidr({ ip: r.net, prefix: r.prefix }, dst)).sort((a, b) => b.prefix - a.prefix)[0];
    const st = [...inputs.statics].filter((r) => inSubnet(dst, r.net, r.prefix)).sort((a, b) => b.prefix - a.prefix)[0];
    if (dev && (!st || dev.prefix >= st.prefix)) return { iface: dev.dev, nextHop: dst };
    if (st) return lookupRoute(inputs.nics, [st], undefined, dst);
    const full = table === 'all' ? this.liveRoutes('all').find((r) => r.prefix === 0) : undefined;
    if (full) return { iface: full.dev, nextHop: dst };
    return lookupRoute(inputs.nics, [], inputs.gateway, dst);
  }
}
