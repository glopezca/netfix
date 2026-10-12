/** iproute2, ping, dig/nslookup/host and dhclient as programs of the bash core (Ubuntu output). */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { resolveHost, dnsQuery } from './net-tools.ts';
import { describeAddress, linuxMac, IFACE } from './linux-files.ts';
import { digOutput, nslookupOutput, hostOutput } from './dns-format.ts';
import { runPing } from '../net/ping.ts';
import { reverseName } from '../net/dns.ts';
import type { DnsType } from '../net/packets.ts';
import { formatIp, networkOf, parseIp } from '../core/ip.ts';

const PING_TIMEOUT_MS = 1000;
const DEFAULT_PING_COUNT = 4;
const MAX_PING_COUNT = 100;
const DHCP_WAIT_MS = 20_000;
const DNS_TYPES: readonly DnsType[] = ['A', 'CNAME', 'MX', 'NS', 'TXT', 'PTR', 'SOA'];

const lines = (ctx: Ctx, list: readonly string[]): void => {
  if (list.length) ctx.out(`${list.join('\n')}\n`);
};

function ipAddress(host: Host): string[] {
  const addr = describeAddress(host);
  const up = host.linkUp();
  const out = [
    '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
    '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
    '    inet 127.0.0.1/8 scope host lo',
    '       valid_lft forever preferred_lft forever',
    `2: ${IFACE}: <BROADCAST,MULTICAST${up ? ',UP,LOWER_UP' : ''}> mtu 1500 qdisc fq_codel state ${up ? 'UP' : 'DOWN'} group default qlen 1000`,
    `    link/ether ${linuxMac(host.mac)} brd ff:ff:ff:ff:ff:ff`,
  ];
  if (addr) out.push(`    inet ${addr.inet} brd ${addr.brd} scope ${addr.scope} ${IFACE}`, '       valid_lft forever preferred_lft forever');
  return out;
}

function ipRoute(host: Host): string[] {
  const c = host.config;
  if (c.ip === undefined || c.prefix === undefined) return [];
  const proto = c.mode === 'dhcp' ? 'dhcp' : 'static';
  const out = [`${formatIp(networkOf(c.ip, c.prefix))}/${c.prefix} dev ${IFACE} proto kernel scope link src ${formatIp(c.ip)}`];
  if (c.gateway !== undefined) out.unshift(`default via ${formatIp(c.gateway)} dev ${IFACE} proto ${proto} metric 100`);
  return out;
}

function ipBrief(host: Host, link: boolean): string[] {
  const addr = describeAddress(host);
  const up = host.linkUp() ? 'UP' : 'DOWN';
  const row = (name: string, state: string, rest: string): string => `${name.padEnd(16)} ${state.padEnd(14)} ${rest}`;
  if (link) return [row('lo', 'UNKNOWN', '00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP> '), row(IFACE, up, `${linuxMac(host.mac)} <BROADCAST,MULTICAST${up === 'UP' ? ',UP,LOWER_UP' : ''}> `)];
  return [row('lo', 'UNKNOWN', '127.0.0.1/8 '), row(IFACE, up, addr ? `${addr.inet} ` : '')];
}

const IP_USAGE = 'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | route | neigh | link }\n       OPTIONS := { -4 | -br[ief] | -c[olor] }\n';

export function ip(host: Host) {
  return (ctx: Ctx): number => {
    const brief = ctx.argv.some((a) => /^-br(ief)?$/.test(a));
    const args = ctx.argv.slice(1).filter((a) => !/^-(4|c|color|br|brief)$/.test(a));
    const obj = args[0] ?? '';
    const is = (full: string, ...short: string[]): boolean => obj !== '' && (full.startsWith(obj) || short.includes(obj));
    if (brief && (is('address', 'a', 'addr') || is('link', 'l'))) lines(ctx, ipBrief(host, is('link', 'l')));
    else if (is('address', 'a', 'addr')) lines(ctx, ipAddress(host));
    else if (is('route', 'r')) lines(ctx, ipRoute(host));
    else if (is('neighbour', 'n', 'neigh')) lines(ctx, [...host.stack.arp.entries()].map(([a, e]) => `${formatIp(a)} dev ${IFACE} lladdr ${linuxMac(e.mac)} REACHABLE`));
    else if (is('link', 'l')) lines(ctx, ipAddress(host).filter((l) => !/^\s+inet|valid_lft/.test(l)));
    else if (obj === '' || obj === 'help') { ctx.err(IP_USAGE); return obj === '' ? 255 : 0; }
    else { ctx.err(`Object "${obj}" is unknown, try "ip help".\n`); return 1; }
    return 0;
  };
}

function pingCount(args: readonly string[]): { count: number; target?: string } {
  const cIdx = args.indexOf('-c');
  const count = cIdx >= 0 ? Math.min(MAX_PING_COUNT, Math.max(1, Number(args[cIdx + 1]) || DEFAULT_PING_COUNT)) : DEFAULT_PING_COUNT;
  const target = args.filter((_, i) => cIdx < 0 || (i !== cIdx && i !== cIdx + 1)).find((a) => !a.startsWith('-'));
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
      host.dhcpClient.release();
      host.hooks.runUntil(() => false, 10);
      host.config = { mode: 'dhcp' };
      host.dhcpStatus = 'idle';
      return 0;
    }
    host.useDhcp();
    host.hooks.runUntil(() => host.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    if (host.dhcpStatus === 'ok') return 0;
    ctx.err('No DHCPOFFERS received.\nNo working leases in persistent database - sleeping.\n');
    return 2;
  };
}
