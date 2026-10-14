/** iproute2, ping, dig/nslookup/host and dhclient as programs of the bash core (Ubuntu output). */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { resolveHost, dnsQuery } from './net-tools.ts';
import { linuxMac } from './linux-files.ts';
import { digOutput, nslookupOutput, hostOutput } from './dns-format.ts';
import { runPing } from '../net/ping.ts';
import { reverseName } from '../net/dns.ts';
import type { DnsType } from '../net/packets.ts';
import { formatIp, broadcastOf, parseIp } from '../core/ip.ts';
import { ipWrite, routeLines } from './linux-ip.ts';
import type { NicInfo } from '../devices/host-nics.ts';
import type { IpWrite } from './linux-ip.ts';

const PING_TIMEOUT_MS = 1000;
const DEFAULT_PING_COUNT = 4;
const MAX_PING_COUNT = 100;
const DHCP_WAIT_MS = 20_000;
const DNS_TYPES: readonly DnsType[] = ['A', 'CNAME', 'MX', 'NS', 'TXT', 'PTR', 'SOA'];

const lines = (ctx: Ctx, list: readonly string[]): void => {
  if (list.length) ctx.out(`${list.join('\n')}\n`);
};

function nicAddress(n: NicInfo): { inet: string; brd: string; scope: string } | undefined {
  if (n.ip === undefined || n.prefix === undefined) return undefined;
  return { inet: `${formatIp(n.ip)}/${n.prefix}`, brd: formatIp(broadcastOf(n.ip, n.prefix)), scope: n.dhcp ? 'global dynamic' : 'global' };
}

function ipAddress(host: Host): string[] {
  const out = [
    '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
    '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
    '    inet 127.0.0.1/8 scope host lo',
    '       valid_lft forever preferred_lft forever',
  ];
  host.nics().forEach((n, i) => {
    const addr = nicAddress(n);
    out.push(
      `${i + 2}: ${n.linux}: <BROADCAST,MULTICAST${n.adminUp ? ',UP' : ''}${n.up ? ',LOWER_UP' : ''}> mtu 1500 qdisc fq_codel state ${n.up ? 'UP' : 'DOWN'} group default qlen 1000`,
      `    link/ether ${linuxMac(n.mac)} brd ff:ff:ff:ff:ff:ff`,
    );
    if (addr) out.push(`    inet ${addr.inet} brd ${addr.brd} scope ${addr.scope} ${n.linux}`, '       valid_lft forever preferred_lft forever');
  });
  return out;
}

function ipBrief(host: Host, link: boolean): string[] {
  const row = (name: string, state: string, rest: string): string => `${name.padEnd(16)} ${state.padEnd(14)} ${rest}`;
  const nics = host.nics();
  if (link) return [row('lo', 'UNKNOWN', '00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP> '), ...nics.map((n) => row(n.linux, n.up ? 'UP' : 'DOWN', `${linuxMac(n.mac)} <BROADCAST,MULTICAST${n.adminUp ? ',UP' : ''}${n.up ? ',LOWER_UP' : ''}> `))];
  return [row('lo', 'UNKNOWN', '127.0.0.1/8 '), ...nics.map((n) => row(n.linux, n.up ? 'UP' : 'DOWN', nicAddress(n) ? `${nicAddress(n)?.inet} ` : ''))];
}

const IP_USAGE = 'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | route | neigh | link }\n       OPTIONS := { -4 | -br[ief] | -c[olor] }\n';

export function ip(host: Host) {
  return (ctx: Ctx): number => {
    const brief = ctx.argv.some((a) => /^-br(ief)?$/.test(a));
    const args = ctx.argv.slice(1).filter((a) => !/^-(4|c|color|br|brief)$/.test(a));
    const obj = args[0] ?? '';
    const is = (full: string, ...short: string[]): boolean => obj !== '' && (full.startsWith(obj) || short.includes(obj));
    const kind: IpWrite | undefined = is('address', 'a', 'addr') ? 'address' : is('route', 'r') ? 'route' : is('link', 'l') ? 'link' : undefined;
    const written = kind ? ipWrite(ctx, host, kind, args.slice(1)) : undefined;
    if (written !== undefined) return written;
    if (brief && (is('address', 'a', 'addr') || is('link', 'l'))) lines(ctx, ipBrief(host, is('link', 'l')));
    else if (is('address', 'a', 'addr')) lines(ctx, ipAddress(host));
    else if (is('route', 'r')) lines(ctx, routeLines(host));
    else if (is('neighbour', 'n', 'neigh')) lines(ctx, [...host.stack.arp.entries()].map(([a, e]) => `${formatIp(a)} dev ${host.linuxIfName(e.iface)} lladdr ${linuxMac(e.mac)} REACHABLE`));
    else if (is('link', 'l')) lines(ctx, ipAddress(host).filter((l) => !/^\s+inet|valid_lft/.test(l)));
    else if (obj === '' || obj === 'help') { ctx.err(IP_USAGE); return obj === '' ? 255 : 0; }
    else { ctx.err(`Object "${obj}" is unknown, try "ip help".\n`); return 1; }
    return 0;
  };
}

/** ping options that take a value (`-c 3`, `-W1`…); only -c changes what Netfix does. */
const PING_WITH_VALUE = new Set(['-c', '-W', '-w', '-i', '-t', '-s', '-I', '-l', '-p', '-Q']);

function pingCount(args: readonly string[]): { count: number; target?: string } {
  let count = DEFAULT_PING_COUNT;
  let target: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const flag = a.slice(0, 2);
    if (!a.startsWith('-')) { target ??= a; continue; }
    if (!PING_WITH_VALUE.has(flag)) continue;
    const value = a.length > 2 ? a.slice(2) : args[++i];
    if (flag === '-c') count = Math.min(MAX_PING_COUNT, Math.max(1, Number(value) || DEFAULT_PING_COUNT));
  }
  return { count, target };
}

export function ping(host: Host) {
  return (ctx: Ctx): number => {
    const { count, target } = pingCount(ctx.argv.slice(1));
    if (!target) { ctx.err('ping: usage error: Destination address required\n'); return 1; }
    const r = resolveHost(host, target);
    if (r.kind === 'error') { ctx.err(`ping: ${target}: ${r.reason === 'nxdomain' ? 'Name or service not known' : 'Temporary failure in name resolution'}\n`); return 2; }
    const results = runPing(host.stack, host.hooks, r.ip, { count, timeoutMs: PING_TIMEOUT_MS });
    if (results.every((x) => x.kind === 'noroute')) { ctx.err('ping: connect: Network is unreachable\n'); return 2; }
    const addr = formatIp(r.ip);
    const out = [`PING ${target} (${addr}) 56(84) bytes of data.`];
    results.forEach((x, i) => {
      if (x.kind === 'reply') out.push(`64 bytes from ${r.viaDns ? `${target} (${addr})` : addr}: icmp_seq=${i + 1} ttl=${x.ttl} time=0.${400 + i * 37} ms`);
      else if (x.kind === 'unreachable') out.push(`From ${formatIp(x.from)} icmp_seq=${i + 1} Destination Host Unreachable`);
      else if (x.kind === 'ttl') out.push(`From ${formatIp(x.from)} icmp_seq=${i + 1} Time to live exceeded`);
    });
    const ok = results.filter((x) => x.kind === 'reply').length;
    out.push('', `--- ${target} ping statistics ---`, `${count} packets transmitted, ${ok} received, ${Math.round(((count - ok) * 100) / count)}% packet loss, time ${(count - 1) * 1001}ms`);
    if (ok) out.push('rtt min/avg/max/mdev = 0.400/0.455/0.511/0.040 ms');
    lines(ctx, out);
    return ok ? 0 : 1;
  };
}

function digTarget(rest: readonly string[], type: DnsType | undefined): string | undefined {
  const rev = rest.indexOf('-x');
  if (rev < 0) return rest.find((a) => a.toUpperCase() !== type && a !== '-t');
  const addr = parseIp(rest[rev + 1] ?? '');
  return addr === null ? undefined : reverseName(addr);
}

export function dig(host: Host) {
  return (ctx: Ctx): number => {
    const args = ctx.argv.slice(1);
    const server = args.find((a) => a.startsWith('@'));
    const rest = args.filter((a) => !a.startsWith('@') && !a.startsWith('+'));
    const type = rest.map((a) => a.toUpperCase()).find((a): a is DnsType => (DNS_TYPES as readonly string[]).includes(a));
    const name = digTarget(rest, type);
    if (!name) { ctx.err('Usage:  dig [@global-server] [domain] [q-type] [q-class] {q-opt}\n        dig -x addr   |   dig +short name\n'); return 1; }
    const qtype: DnsType = rest.includes('-x') ? 'PTR' : type ?? 'A';
    const srv = server ? parseIp(server.slice(1)) ?? undefined : undefined;
    const res = dnsQuery(host, name, qtype, srv);
    lines(ctx, digOutput(name, qtype, res, args.includes('+short'), host.clock.now()));
    return res.kind === 'timeout' ? 9 : 0;
  };
}

function serverArg(text: string | undefined): number | undefined {
  return text ? parseIp(text) ?? undefined : undefined;
}

export function nslookup(host: Host) {
  return (ctx: Ctx): number => {
    const [name, srv] = ctx.argv.slice(1).filter((a) => !a.startsWith('-'));
    if (!name) { ctx.err('Usage: nslookup <name> [server]\n'); return 1; }
    const res = dnsQuery(host, name, 'A', serverArg(srv));
    lines(ctx, nslookupOutput(name, res, false));
    return res.kind === 'answer' && res.msg.rcode === 'NOERROR' && (res.msg.answers?.length ?? 0) > 0 ? 0 : 1;
  };
}

export function hostCmd(host: Host) {
  return (ctx: Ctx): number => {
    const args = ctx.argv.slice(1);
    const tIdx = args.indexOf('-t');
    const type = tIdx >= 0 ? (args[tIdx + 1] ?? 'A').toUpperCase() : 'A';
    const [name, srv] = args.filter((a, i) => !a.startsWith('-') && !(tIdx >= 0 && i === tIdx + 1));
    if (!name) { ctx.err('Usage: host [-t type] name [server]\n'); return 1; }
    const qtype = (DNS_TYPES as readonly string[]).includes(type) ? type as DnsType : 'A';
    const res = dnsQuery(host, name, qtype, serverArg(srv));
    lines(ctx, hostOutput(name, res));
    return res.kind === 'answer' && res.msg.rcode === 'NOERROR' && (res.msg.answers?.length ?? 0) > 0 ? 0 : 1;
  };
}

export function dhclient(host: Host) {
  return (ctx: Ctx): number => {
    if (ctx.cred.uid !== 0) { ctx.err('dhclient: Permission denied (are you root?)\n'); return 1; }
    if (ctx.argv.includes('-r')) {
      host.releaseDhcp();
      return 0;
    }
    host.useDhcp();
    host.hooks.runUntil(() => host.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    if (host.dhcpStatus === 'ok') return 0;
    ctx.err('No DHCPOFFERS received.\nNo working leases in persistent database - sleeping.\n');
    return 2;
  };
}
