/**
 * iproute2 on virtual links (WireGuard wgN, Linux router only): `ip link add|del … type wireguard`,
 * `ip link set wgN up|down`, `ip addr add|del CIDR dev wgN`, `ip route add|del NET dev wgN`, and the lines
 * `ip a` / `ip -br a` / `ip route` print for them.
 */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { WgManager } from '../devices/wg-manager.ts';
import { WG_TABLE } from '../devices/wg-manager.ts';
import { cidrText, networkCidr, parseCidr } from '../net/wg-config.ts';
import { formatIp } from '../core/ip.ts';

const EXIT_RTNL = 2;

function devName(rest: readonly string[]): string | undefined {
  const i = rest.indexOf('dev');
  return i >= 0 ? rest[i + 1] : rest.find((a) => /^wg\d+$/.test(a));
}

function report(ctx: Ctx, err: string | null): number {
  if (!err) return 0;
  ctx.err(`${err}\n`);
  return err.startsWith('RTNETLINK') ? EXIT_RTNL : 1;
}

function link(ctx: Ctx, wgm: WgManager, verb: string, rest: readonly string[]): number | undefined {
  const name = devName(rest);
  if (verb === 'add') {
    const type = rest[rest.indexOf('type') + 1];
    if (!rest.includes('type') || !name) return undefined;
    if (type !== 'wireguard') { ctx.err(`Error: Unknown device type.\n`); return EXIT_RTNL; }
    return report(ctx, wgm.add(name));
  }
  if (!name || !wgm.get(name)) return undefined;
  if (verb === 'del' || verb === 'delete') return report(ctx, wgm.remove(name));
  if (rest.includes('up')) wgm.setUp(name, true);
  if (rest.includes('down')) wgm.setUp(name, false);
  const mtu = rest.indexOf('mtu');
  const link = wgm.get(name);
  if (mtu >= 0 && link) link.mtu = Number(rest[mtu + 1]) || link.mtu;
  return 0;
}

function address(ctx: Ctx, wgm: WgManager, verb: string, rest: readonly string[]): number | undefined {
  const name = devName(rest);
  if (!name || !wgm.get(name)) return undefined;
  if (verb === 'flush') return report(ctx, wgm.delAddress(name, undefined));
  const c = parseCidr(rest[0] ?? '');
  if (!c || !(rest[0] ?? '').includes('.')) { ctx.err(`Error: any valid prefix is expected rather than "${rest[0] ?? ''}".\n`); return 1; }
  return report(ctx, verb === 'add' ? wgm.addAddress(name, c) : wgm.delAddress(name, c));
}

function route(ctx: Ctx, wgm: WgManager, verb: string, rest: readonly string[]): number | undefined {
  const name = devName(rest);
  if (!name || !wgm.get(name) || rest.includes('via')) return undefined;
  const dest = rest[0] === 'default' ? { ip: 0, prefix: 0 } : parseCidr(rest[0] ?? '');
  if (!dest) { ctx.err(`Error: any valid prefix is expected rather than "${rest[0] ?? ''}".\n`); return 1; }
  const net = networkCidr(dest);
  const t = rest.indexOf('table');
  const table = t >= 0 ? Number(rest[t + 1]) : undefined;
  if (verb === 'del') return report(ctx, wgm.delRoute(net.ip, net.prefix, table));
  if (verb === 'replace') wgm.delRoute(net.ip, net.prefix, table);
  return report(ctx, wgm.addRoute({ net: net.ip, prefix: net.prefix, dev: name, table }));
}

/** Handles a writing `ip` command on a virtual link; undefined when it is about a NIC. */
export function virtualWrite(ctx: Ctx, host: Host, object: 'address' | 'route' | 'link', verb: string, rest: readonly string[]): number | undefined {
  const wgm = host.wgLinks();
  if (!wgm) return undefined;
  if (object === 'link') return link(ctx, wgm, verb, rest);
  if (object === 'address') return address(ctx, wgm, verb, rest);
  return route(ctx, wgm, verb, rest);
}

/** `ip a` blocks for wg links, numbered after the NICs. */
export function virtualAddressLines(host: Host, first: number): string[] {
  return (host.wgLinks()?.virtualLinks() ?? []).flatMap((l, i) => [
    `${first + i}: ${l.name}: <POINTOPOINT,NOARP${l.up ? ',UP,LOWER_UP' : ''}> mtu ${l.mtu} qdisc noqueue state ${l.up ? 'UNKNOWN' : 'DOWN'} group default qlen 1000`,
    '    link/none ',
    ...l.addresses.flatMap((a) => [`    inet ${cidrText(a)} scope global ${l.name}`, '       valid_lft forever preferred_lft forever']),
  ]);
}

export function virtualBrief(host: Host, link: boolean): string[] {
  const row = (name: string, state: string, rest: string): string => `${name.padEnd(16)} ${state.padEnd(14)} ${rest}`;
  return (host.wgLinks()?.virtualLinks() ?? []).map((l) => row(l.name, l.up ? 'UNKNOWN' : 'DOWN',
    link ? `<POINTOPOINT,NOARP${l.up ? ',UP,LOWER_UP' : ''}> ` : l.addresses.map((a) => `${cidrText(a)} `).join('')));
}

/** Kernel routes of the wg addresses and device routes (main table). */
export function virtualRoutes(host: Host): { net: number; line: string }[] {
  const wgm = host.wgLinks();
  if (!wgm) return [];
  const kernel = wgm.virtualLinks().filter((l) => l.up).flatMap((l) => l.addresses.map((a) => {
    const n = networkCidr(a);
    return { net: n.ip, line: `${cidrText(n)} dev ${l.name} proto kernel scope link src ${formatIp(a.ip)}` };
  }));
  const dev = wgm.devRoutes.filter((r) => r.table === undefined || r.table !== WG_TABLE).map((r) => ({ net: r.net, line: `${formatIp(r.net)}/${r.prefix} dev ${r.dev} scope link` }));
  return [...kernel, ...dev];
}
