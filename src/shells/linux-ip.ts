/**
 * Writing iproute2 commands on a host NIC (eth0): `ip addr add|del|flush`, `ip route add|del|replace default`,
 * `ip link set dev eth0 up|down`. They change the running configuration (what `ip a` shows and the GUI
 * fields), not netplan. Netfix keeps one IPv4 address per interface and only the default route on hosts.
 */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { IFACE } from './linux-files.ts';
import { parseIp, inSubnet, networkOf } from '../core/ip.ts';

const EXIT_RTNL = 2;

export type IpWrite = 'address' | 'route' | 'link';

function devOf(args: readonly string[]): string | undefined {
  const i = args.indexOf('dev');
  return i >= 0 ? args[i + 1] : args.find((a) => /^(eth|lo|wg|ens|enp)\w*$/.test(a));
}

function badDevice(ctx: Ctx, dev: string | undefined): boolean {
  if (dev === undefined || dev === IFACE) return false;
  ctx.err(`Cannot find device "${dev}"\n`);
  return true;
}

function parseCidr(text: string | undefined): { ip: number; prefix: number } | null {
  const m = /^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?$/.exec(text ?? '');
  const ip = m ? parseIp(m[1] ?? '') : null;
  const prefix = m?.[2] === undefined ? 32 : Number(m[2]);
  return ip === null || prefix > 32 ? null : { ip, prefix };
}

function address(ctx: Ctx, host: Host, verb: string, rest: readonly string[]): number {
  const dev = devOf(rest);
  if (badDevice(ctx, dev)) return 1;
  const c = host.config;
  if (verb === 'flush') {
    host.setStatic({ dns: c.dns });
    return 0;
  }
  const cidr = parseCidr(rest[0]);
  if (!cidr) { ctx.err(`Error: any valid prefix is expected rather than "${rest[0] ?? ''}".\n`); return 1; }
  if (verb === 'add') {
    if (c.ip === cidr.ip && c.prefix === cidr.prefix) { ctx.err('RTNETLINK answers: File exists\n'); return EXIT_RTNL; }
    if (c.ip !== undefined) { ctx.err(`Netfix: one IPv4 address per interface; remove ${IFACE}'s current address first (ip addr del … dev ${IFACE}).\n`); return EXIT_RTNL; }
    host.setStatic({ ip: cidr.ip, prefix: cidr.prefix, dns: c.dns });
    return 0;
  }
  if (c.ip !== cidr.ip || (rest[0]?.includes('/') && c.prefix !== cidr.prefix)) { ctx.err('RTNETLINK answers: Cannot assign requested address\n'); return EXIT_RTNL; }
  // The kernel drops the routes through the removed address, the default route included.
  host.setStatic({ dns: c.dns });
  return 0;
}

function route(ctx: Ctx, host: Host, verb: string, rest: readonly string[]): number {
  const dest = rest[0] ?? '';
  if (dest !== 'default' && dest !== '0.0.0.0/0') {
    ctx.err(`Netfix: hosts only keep the default route (ip route ${verb} default via …).\n`);
    return EXIT_RTNL;
  }
  if (badDevice(ctx, devOf(rest))) return 1;
  const c = host.config;
  if (verb === 'del' || verb === 'delete') {
    if (c.gateway === undefined) { ctx.err('RTNETLINK answers: No such process\n'); return EXIT_RTNL; }
    host.setStatic({ ip: c.ip, prefix: c.prefix, dns: c.dns });
    return 0;
  }
  const viaIdx = rest.indexOf('via');
  const gw = viaIdx >= 0 ? parseIp(rest[viaIdx + 1] ?? '') : null;
  if (gw === null) { ctx.err('Error: either "to" is duplicate, or "via" is a garbage.\n'); return 1; }
  if (verb === 'add' && c.gateway !== undefined) { ctx.err('RTNETLINK answers: File exists\n'); return EXIT_RTNL; }
  if (c.ip === undefined || c.prefix === undefined || !inSubnet(gw, networkOf(c.ip, c.prefix), c.prefix)) { ctx.err('Error: Nexthop has invalid gateway.\n'); return EXIT_RTNL; }
  host.setStatic({ ip: c.ip, prefix: c.prefix, gateway: gw, dns: c.dns });
  return 0;
}

function link(ctx: Ctx, host: Host, rest: readonly string[]): number {
  const dev = devOf(rest);
  if (dev === 'lo') return 0;
  if (badDevice(ctx, dev) || dev === undefined) { if (dev === undefined) ctx.err('Not enough of information: "dev" argument is required.\n'); return 1; }
  if (rest.includes('down')) host.setPortUp(false);
  else if (rest.includes('up')) host.setPortUp(true);
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
  if (object === 'route') return route(ctx, host, verb === 'replace' || verb === 'change' ? 'replace' : verb, rest);
  return link(ctx, host, rest);
}
