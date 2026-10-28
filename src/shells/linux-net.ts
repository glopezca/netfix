/** iproute2, ping, dig/host and dhclient as programs of the bash core (Ubuntu output). */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { resolveHost, dnsQuery, dnsSearch } from './net-tools.ts';
import { linuxMac } from './linux-files.ts';
import { digOutput, hostOutput } from './dns-format.ts';
import { runPing } from '../net/ping.ts';
import type { PingOutcome } from '../net/ping.ts';
import { reverseName } from '../net/dns.ts';
import type { DnsType, UnreachableCode } from '../net/packets.ts';
import { formatIp, broadcastOf, parseIp } from '../core/ip.ts';
import { ipWrite, routeLines } from './linux-ip.ts';
import { virtualAddressLines, virtualBrief } from './linux-ip-wg.ts';
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
  return [...out, ...virtualAddressLines(host, host.nics().length + 2)];
}

function ipBrief(host: Host, link: boolean): string[] {
  const row = (name: string, state: string, rest: string): string => `${name.padEnd(16)} ${state.padEnd(14)} ${rest}`;
  const nics = host.nics();
  if (link) return [row('lo', 'UNKNOWN', '00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP> '), ...nics.map((n) => row(n.linux, n.up ? 'UP' : 'DOWN', `${linuxMac(n.mac)} <BROADCAST,MULTICAST${n.adminUp ? ',UP' : ''}${n.up ? ',LOWER_UP' : ''}> `)), ...virtualBrief(host, true)];
  return [row('lo', 'UNKNOWN', '127.0.0.1/8 '), ...nics.map((n) => row(n.linux, n.up ? 'UP' : 'DOWN', nicAddress(n) ? `${nicAddress(n)?.inet} ` : '')), ...virtualBrief(host, false)];
}

/** Interface blocks of `ip addr` (a block starts with «N: name:»). */
function addrBlocks(all: readonly string[]): string[][] {
  const blocks: string[][] = [];
  for (const l of all) {
    if (/^\d+: /.test(l) || blocks.length === 0) blocks.push([l]);
    else blocks[blocks.length - 1]?.push(l);
  }
  return blocks;
}

/** Filter words of `ip addr show` that are not a device (with how many values each one takes). */
const ADDR_FILTERS: Readonly<Record<string, number>> = { dev: 0, up: 0, permanent: 0, dynamic: 0, primary: 0, secondary: 0, scope: 1, label: 1, to: 1 };

/** The device names of `ip addr [show|list] …`: abbreviations of show/list and filter keywords left out. */
function addrDevWords(rest: readonly string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i] ?? '';
    if (i === 0 && ('show'.startsWith(w) || 'list'.startsWith(w))) continue;
    const skip = ADDR_FILTERS[w];
    if (skip === undefined) words.push(w);
    else i += skip;
  }
  return words;
}

/**
 * `ip [-4] addr [show] [dev] [NAME]`: only that interface; with -4, only the interfaces with an IPv4 address and
 * without their link/ lines. Null when the device does not exist.
 */
function addrShow(all: readonly string[], rest: readonly string[], v4: boolean): string[] | null {
  const words = addrDevWords(rest);
  const dev = words[0];
  let blocks = addrBlocks(all);
  if (dev !== undefined) {
    blocks = blocks.filter((b) => new RegExp(`^\\d+: ${dev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:@]`).test(b[0] ?? ''));
    if (blocks.length === 0) return null;
  }
  if (v4) blocks = blocks.filter((b) => b.some((l) => /^ {4}inet /.test(l))).map((b) => b.filter((l) => !/^ {4}link\//.test(l)));
  return blocks.flat();
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
    else if (is('address', 'a', 'addr')) {
      const shown = addrShow(ipAddress(host), args.slice(1), ctx.argv.includes('-4'));
      if (!shown) { ctx.err(`Device "${addrDevWords(args.slice(1))[0] ?? ''}" does not exist.\n`); return 1; }
      lines(ctx, shown);
    }
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
        if (!a.startsWith('-')) { target ??= a; continue; }
    // Joined flags (-bc 3, -bc3): the first one that takes a value takes the rest of the word or the next one.
    const at = [...a.slice(1)].findIndex((c) => PING_WITH_VALUE.has(`-${c}`));
    if (at < 0) continue;
    const value = a.length > at + 2 ? a.slice(at + 2) : args[++i];
    if (a[at + 1] === 'c') count = Math.min(MAX_PING_COUNT, Math.max(1, Number(value) || DEFAULT_PING_COUNT));
  }
  return { count, target };
}

const BROADCAST_HINT = 'ping: Do you want to ping broadcast? Then -b. If not, check your local firewall rules\n';

/** -b among the options, alone or joined with others (-bc 3). */
const wantsBroadcast = (args: readonly string[]): boolean => args.some((a) => /^-[A-Za-z]*b[A-Za-z]*$/.test(a) && !PING_WITH_VALUE.has(a.slice(0, 2)));

/** iputils' text for each destination unreachable code. */
const UNREACHABLE_TEXT: Readonly<Record<UnreachableCode, string>> = {
  net: 'Destination Net Unreachable', host: 'Destination Host Unreachable', port: 'Destination Port Unreachable', admin: 'Packet filtered',
};

/** The simulated round trip of the i-th echo, in ms (the simulator has no real delay: a small, growing value). */
const replyTime = (i: number): number => 0.4 + i * 0.037;

/** iputils' last line: min, avg, max and mdev (the standard deviation) of the times printed. */
function rttSummary(times: readonly number[]): string {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const mdev = Math.sqrt(Math.max(0, times.reduce((a, b) => a + b * b, 0) / times.length - avg * avg));
  const f = (n: number): string => n.toFixed(3);
  return `rtt min/avg/max/mdev = ${f(Math.min(...times))}/${f(avg)}/${f(Math.max(...times))}/${f(mdev)} ms`;
}

/** One line per answer: the device that answered (its own address on a broadcast), repeated ones with (DUP!). */
function replyLines(results: readonly PingOutcome[], who: (from: number) => string): string[] {
  return results.flatMap((x, i) => {
    const seq = i + 1;
    if (x.kind === 'reply') {
      const line = (r: { from: number; ttl?: number }, dup: string): string => `64 bytes from ${who(r.from)}: icmp_seq=${seq} ttl=${r.ttl ?? x.ttl} time=${replyTime(i).toFixed(3)} ms${dup}`;
      return [line(x, ''), ...(x.dups ?? []).map((d) => line(d, ' (DUP!)'))];
    }
    if (x.kind === 'unreachable') return [`From ${formatIp(x.from)} icmp_seq=${seq} ${UNREACHABLE_TEXT[x.code]}`];
    if (x.kind === 'ttl') return [`From ${formatIp(x.from)} icmp_seq=${seq} Time to live exceeded`];
    return [];
  });
}

export function ping(host: Host) {
  return (ctx: Ctx): number => {
    const args = ctx.argv.slice(1);
    const { count, target } = pingCount(args);
    if (!target) { ctx.err('ping: usage error: Destination address required\n'); return 1; }
    const r = resolveHost(host, target);
    if (r.kind === 'error') { ctx.err(`ping: ${target}: ${r.reason === 'nxdomain' ? 'Name or service not known' : 'Temporary failure in name resolution'}\n`); return 2; }
    const broadcast = host.stack.isBroadcast(r.ip);
    if (broadcast && !wantsBroadcast(args)) { ctx.err(BROADCAST_HINT); return 2; }
    if (broadcast) ctx.err('WARNING: pinging broadcast address\n');
    const results = runPing(host.stack, host.hooks, r.ip, { count, timeoutMs: PING_TIMEOUT_MS });
    if (results.every((x) => x.kind === 'noroute')) { ctx.err('ping: connect: Network is unreachable\n'); return 2; }
    const addr = formatIp(r.ip);
    // The name as resolved (www → www.empresa.lan with the search domain), as ping shows it.
    const shown = r.viaDns ? r.name : target;
    const byName = parseIp(target) === null;
    const out = [`PING ${shown} (${addr}) 56(84) bytes of data.`, ...replyLines(results, (from) => (byName && from === r.ip ? `${shown} (${addr})` : formatIp(from)))];
    const ok = results.filter((x) => x.kind === 'reply').length;
    const dups = results.reduce((n, x) => n + (x.kind === 'reply' ? x.dups?.length ?? 0 : 0), 0);
    out.push('', `--- ${shown} ping statistics ---`, `${count} packets transmitted, ${ok} received, ${dups ? `+${dups} duplicates, ` : ''}${Math.round(((count - ok) * 100) / count)}% packet loss, time ${(count - 1) * 1001}ms`);
    if (ok) out.push(rttSummary(results.flatMap((x, i) => (x.kind === 'reply' ? [replyTime(i)] : []))));
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
    // dig does not use the search list unless +search (its default is +nosearch).
    const search = args.includes('+search') && qtype !== 'PTR' ? dnsSearch(host, name, qtype, srv) : { result: dnsQuery(host, name, qtype, srv), name };
    const res = search.result;
    lines(ctx, digOutput(search.name, qtype, res, args.includes('+short'), host.clock.now()));
    return res.kind === 'timeout' ? 9 : 0;
  };
}

function serverArg(text: string | undefined): number | undefined {
  return text ? parseIp(text) ?? undefined : undefined;
}

export function hostCmd(host: Host) {
  return (ctx: Ctx): number => {
    const args = ctx.argv.slice(1);
    const tIdx = args.indexOf('-t');
    const type = tIdx >= 0 ? (args[tIdx + 1] ?? 'A').toUpperCase() : 'A';
    const [name, srv] = args.filter((a, i) => !a.startsWith('-') && !(tIdx >= 0 && i === tIdx + 1));
    if (!name) { ctx.err('Usage: host [-t type] name [server]\n'); return 1; }
    const qtype = (DNS_TYPES as readonly string[]).includes(type) ? type as DnsType : 'A';
    const { result: res } = dnsSearch(host, name, qtype, serverArg(srv));
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
