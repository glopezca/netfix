/**
 * Writing iproute2 commands: `ip addr add|del|flush … dev ethN`, `ip route add|del|replace NET|default via GW`,
 * `ip link set dev ethN up|down`. They change the running configuration (what `ip a` shows and the GUI
 * fields), not netplan. Netfix keeps one IPv4 address per interface.
 */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { NicInfo, StaticRoute } from '../devices/host-nics.ts';
import { routeTo, MAX_STATIC_ROUTES } from '../devices/host-nics.ts';
import { parseIp, inSubnet, networkOf, formatIp } from '../core/ip.ts';

const EXIT_RTNL = 2;

export type IpWrite = 'address' | 'route' | 'link';

function devOf(args: readonly string[]): string | undefined {
  const i = args.indexOf('dev');
  return i >= 0 ? args[i + 1] : args.find((a) => /^(eth|lo|wg|ens|enp)\w*$/.test(a));
}

/** The NIC named by `dev` (the only NIC when omitted on a one-NIC host); null after printing the error. */
function nicOf(ctx: Ctx, host: Host, dev: string | undefined): NicInfo | null {
  const nics = host.nics();
  const nic = dev === undefined ? (nics.length === 1 ? nics[0] : undefined) : nics.find((n) => n.linux === dev);
  if (nic) return nic;
  ctx.err(dev === undefined ? 'Not enough of information: "dev" argument is required.\n' : `Cannot find device "${dev}"\n`);
  return null;
}

function parseCidr(text: string | undefined): { ip: number; prefix: number } | null {
  const m = /^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?$/.exec(text ?? '');
  const ip = m ? parseIp(m[1] ?? '') : null;
  const prefix = m?.[2] === undefined ? 32 : Number(m[2]);
  return ip === null || prefix > 32 ? null : { ip, prefix };
}

function address(ctx: Ctx, host: Host, verb: string, rest: readonly string[]): number {
  const nic = nicOf(ctx, host, devOf(rest));
  if (!nic) return 1;
  if (verb === 'flush') {
    host.setNicAddress(nic.port, undefined);
    return 0;
  }
  const cidr = parseCidr(rest[0]);
  if (!cidr) { ctx.err(`Error: any valid prefix is expected rather than "${rest[0] ?? ''}".\n`); return 1; }
  if (verb === 'add') {
    if (nic.ip === cidr.ip && nic.prefix === cidr.prefix) { ctx.err('RTNETLINK answers: File exists\n'); return EXIT_RTNL; }
    if (nic.ip !== undefined) { ctx.err(`Netfix: one IPv4 address per interface; remove ${nic.linux}'s current address first (ip addr del … dev ${nic.linux}).\n`); return EXIT_RTNL; }
    host.setNicAddress(nic.port, cidr);
    return 0;
  }
  if (nic.ip !== cidr.ip || (rest[0]?.includes('/') && nic.prefix !== cidr.prefix)) { ctx.err('RTNETLINK answers: Cannot assign requested address\n'); return EXIT_RTNL; }
  // The kernel drops the routes through the removed address, the default route included.
  host.setNicAddress(nic.port, undefined);
  return 0;
}

function reachable(host: Host, gw: number): boolean {
  return host.nics().some((n) => n.ip !== undefined && n.prefix !== undefined && inSubnet(gw, networkOf(n.ip, n.prefix), n.prefix));
}

function defaultRoute(ctx: Ctx, host: Host, verb: string, gw: number | null): number {
  const c = host.config;
  if (verb === 'del') {
    if (c.gateway === undefined) { ctx.err('RTNETLINK answers: No such process\n'); return EXIT_RTNL; }
    host.setStatic({ ip: c.ip, prefix: c.prefix, dns: c.dns });
    return 0;
  }
  if (gw === null) { ctx.err('Error: either "to" is duplicate, or "via" is a garbage.\n'); return 1; }
  if (!reachable(host, gw)) { ctx.err('Error: Nexthop has invalid gateway.\n'); return EXIT_RTNL; }
  if (verb === 'add' && c.gateway !== undefined) { ctx.err('RTNETLINK answers: File exists\n'); return EXIT_RTNL; }
  host.setStatic({ ip: c.ip, prefix: c.prefix, gateway: gw, dns: c.dns });
  return 0;
}

function networkRoute(ctx: Ctx, host: Host, verb: string, dest: { ip: number; prefix: number }, gw: number | null): number {
  const same = (r: StaticRoute): boolean => r.net === networkOf(dest.ip, dest.prefix) && r.prefix === dest.prefix;
  const existing = host.staticRoutes.find(same);
  if (verb === 'del') {
    if (!existing) { ctx.err('RTNETLINK answers: No such process\n'); return EXIT_RTNL; }
    host.setStaticRoutes(host.staticRoutes.filter((r) => !same(r)));
    return 0;
  }
  if (gw === null) { ctx.err('Netfix: routes need a gateway (ip route add NET/N via GW).\n'); return 1; }
  if (!reachable(host, gw)) { ctx.err('Error: Nexthop has invalid gateway.\n'); return EXIT_RTNL; }
  if (verb === 'add' && existing) { ctx.err('RTNETLINK answers: File exists\n'); return EXIT_RTNL; }
  if (!existing && host.staticRoutes.length >= MAX_STATIC_ROUTES) { ctx.err('RTNETLINK answers: No buffer space available\n'); return EXIT_RTNL; }
  host.setStaticRoutes([...host.staticRoutes.filter((r) => !same(r)), routeTo(dest.ip, dest.prefix, gw)]);
  return 0;
}

function route(ctx: Ctx, host: Host, verb: string, rest: readonly string[]): number {
  const destText = rest[0] ?? '';
  const dev = devOf(rest);
  if (dev !== undefined && !nicOf(ctx, host, dev)) return 1;
  const viaIdx = rest.indexOf('via');
  const gw = viaIdx >= 0 ? parseIp(rest[viaIdx + 1] ?? '') : null;
  if (destText === 'default' || destText === '0.0.0.0/0') return defaultRoute(ctx, host, verb, gw);
  const dest = parseCidr(destText);
  if (!dest) { ctx.err(`Error: any valid prefix is expected rather than "${destText}".\n`); return 1; }
  if (dest.ip !== networkOf(dest.ip, dest.prefix)) { ctx.err(`Error: Invalid prefix for given prefix length.\n`); return 1; }
  return networkRoute(ctx, host, verb, dest, gw);
}

function link(ctx: Ctx, host: Host, rest: readonly string[]): number {
  const dev = devOf(rest);
  if (dev === 'lo') return 0;
  if (dev === undefined) { ctx.err('Not enough of information: "dev" argument is required.\n'); return 1; }
  const nic = nicOf(ctx, host, dev);
  if (!nic) return 1;
  if (rest.includes('down')) host.setNicUp(nic.port, false);
  else if (rest.includes('up')) host.setNicUp(nic.port, true);
  return 0;
}

const VERBS: Readonly<Record<IpWrite, readonly string[]>> = {
  address: ['add', 'del', 'delete', 'flush'],
  route: ['add', 'del', 'delete', 'replace', 'change'],
  link: ['set'],
};

/** Runs a writing `ip` command; undefined when `args` is not one (ip shows the object instead). */
export function ipWrite(ctx: Ctx, host: Host, object: IpWrite, args: readonly string[]): number | undefined {
  const verb = args[0] ?? '';
  if (!VERBS[object].includes(verb)) return undefined;
  if (ctx.cred.uid !== 0) { ctx.err('RTNETLINK answers: Operation not permitted\n'); return EXIT_RTNL; }
  const rest = args.slice(1);
  if (object === 'address') return address(ctx, host, verb === 'delete' ? 'del' : verb, rest);
  if (object === 'route') return route(ctx, host, verb === 'replace' || verb === 'change' ? 'replace' : verb === 'delete' ? 'del' : verb, rest);
  return link(ctx, host, rest);
}

/** `ip route` lines: default, connected networks and static routes. */
export function routeLines(host: Host): string[] {
  const nics = host.nics().filter((n) => n.ip !== undefined && n.prefix !== undefined);
  const devFor = (gw: number): string => nics.find((n) => inSubnet(gw, n.ip as number, n.prefix as number))?.linux ?? nics[0]?.linux ?? 'eth0';
  const gw = host.config.gateway;
  const primary = host.nics()[0];
  const out = gw !== undefined ? [`default via ${formatIp(gw)} dev ${devFor(gw)} proto ${primary?.dhcp ? 'dhcp' : 'static'} metric 100`] : [];
  const kernel = nics.map((n) => ({ net: networkOf(n.ip as number, n.prefix as number), line: `${formatIp(networkOf(n.ip as number, n.prefix as number))}/${n.prefix} dev ${n.linux} proto kernel scope link src ${formatIp(n.ip as number)}` }));
  const statics = host.staticRoutes.map((r) => ({ net: r.net, line: `${formatIp(r.net)}/${r.prefix} via ${formatIp(r.via)} dev ${devFor(r.via)}` }));
  return [...out, ...[...kernel, ...statics].sort((a, b) => a.net - b.net).map((x) => x.line)];
}
