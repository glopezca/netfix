/** Exec commands that use the network: ping, ARP, DHCP client control. */
import type { CommandDef } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import type { IpStack } from '../../net/ipstack.ts';
import type { DeviceHooks } from '../../devices/hooks.ts';
import { parseIp, formatIp, formatMask } from '../../core/ip.ts';
import { formatMacCisco } from '../../core/mac.ts';
import { pingSteps } from '../../net/ping.ts';
import { runLive, runSteps, waitsLive } from '../../net/live-wait.ts';
import type { PingOutcome } from '../../net/ping.ts';
import { traceSteps, iosTraceLines, DEFAULT_MAX_HOPS } from '../../net/trace.ts';

const TRACE_TIMEOUT_MS = 3000;
import { parseIfaceName } from '../interfaces.ts';

const PING_TIMEOUT_MS = 2000;
const DEFAULT_COUNT = 5;
const MS_PER_MIN = 60_000;

export interface PingCapable {
  readonly stack: IpStack;
  readonly hooks: DeviceHooks;
  sourceFor(text: string): number | undefined;
}

export function iosPing(cli: Cli, host: PingCapable, target: string, count: number, source?: string): void {
  const dst = parseIp(target);
  if (dst === null) {
    cli.out('% Unrecognized host or address, or protocol not running.', '');
    return;
  }
  const src = source ? host.sourceFor(source) : undefined;
  if (source && src === undefined) {
    cli.out(`% Invalid source address- IP address not on any of our up interfaces`);
    return;
  }
  const steps = pingSteps(host.stack, dst, { count, timeoutMs: PING_TIMEOUT_MS, src });
  const report = (results: readonly PingOutcome[]): string[] => pingLines(host.stack.isBroadcast(dst), results, count, target, src);
  // A network reaching out of the page (0.92.0): the console prints the report when the replies have come.
  if (cli.session.canWaitLive && waitsLive(host.hooks)) cli.session.waitFor(runLive(steps).then(report));
  else cli.out(...report(runSteps(host.hooks, steps)));
}

function pingLines(broadcast: boolean, results: readonly PingOutcome[], count: number, target: string, src: number | undefined): string[] {
  if (broadcast && results.some((r) => r.kind === 'reply')) return broadcastReplies(results, count, target);
  const marks = results.map((r) => (r.kind === 'reply' ? '!' : r.kind === 'unreachable' ? 'U' : r.kind === 'ttl' ? '&' : '.')).join('');
  const ok = results.filter((r) => r.kind === 'reply').length;
  const pct = Math.round((ok * 100) / count);
  return ['Type escape sequence to abort.', `Sending ${count}, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`,
    ...(src !== undefined ? [`Packet sent with a source address of ${formatIp(src)} `] : []),
    marks, `Success rate is ${pct} percent (${ok}/${count})${ok > 0 ? ', round-trip min/avg/max = 0/0/1 ms' : ''}`];
}

/** A broadcast is answered by several devices: IOS lists each answer instead of !!!!! and the success rate. */
function broadcastReplies(results: readonly PingOutcome[], count: number, target: string): string[] {
  const lines = ['Type escape sequence to abort.', `Sending ${count}, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`, ''];
  results.forEach((r, i) => {
    if (r.kind !== 'reply') { lines.push('.'); return; }
    for (const x of [r, ...(r.dups ?? [])]) lines.push(`Reply to request ${i} from ${formatIp(x.from)}, 1 ms`);
  });
  return lines;
}

export function showArp(stack: IpStack, own: readonly { ip: number; mac: string; iface: string }[], now: number): string[] {
  const rows = [
    ...own.map((o) => ({ ip: o.ip, age: '-', mac: o.mac, iface: o.iface })),
    ...[...stack.arp.entries()].map(([ip, e]) => ({ ip, age: String(Math.floor((now - e.learnedAt) / MS_PER_MIN)), mac: e.mac, iface: e.iface })),
  ].sort((a, b) => a.ip - b.ip);
  return [
    'Protocol  Address          Age (min)  Hardware Addr   Type   Interface',
    ...rows.map((r) => `Internet  ${formatIp(r.ip).padEnd(17)}${r.age.padStart(8)}   ${formatMacCisco(r.mac).padEnd(16)}ARPA   ${r.iface}`),
  ];
}

type Def = CommandDef<Cli<Router>>;

function routerPingHost(r: Router): PingCapable {
  return {
    stack: r.plane.stack,
    hooks: r.hooks,
    sourceFor: (text) => {
      const ip = parseIp(text);
      if (ip !== null) return r.plane.allIps().includes(ip) ? ip : undefined;
      const name = parseIfaceName(text);
      return name ? r.plane.l3Iface(name.full)?.addrs[0]?.ip : undefined;
    },
  };
}

function ownArp(r: Router): { ip: number; mac: string; iface: string }[] {
  return r.plane.l3Ifaces().filter((i) => i.up).flatMap((i) => i.addrs.map((a) => ({ ip: a.ip, mac: i.mac, iface: i.name })));
}

function dhcpIface(cli: Cli<Router>, text: string): string | undefined {
  const name = parseIfaceName(text)?.full;
  const cfg = name ? cli.device.iface(name) : undefined;
  if (!name || !cfg) {
    cli.out('%Invalid interface type and number');
    return undefined;
  }
  if (!cfg.dhcpClient) {
    cli.out(`% Interface ${name} is not configured for DHCP`);
    return undefined;
  }
  return name;
}

function showDhcpLease(r: Router): string[] {
  const lines: string[] = [];
  for (const [iface, lease] of r.plane.leases) {
    lines.push(
      `Temp IP addr: ${formatIp(lease.ip)}  for peer on Interface: ${iface}`,
      `Temp  sub net mask: ${formatMask(lease.prefix)}`,
      `   DHCP Lease server: ${formatIp(lease.serverId)}, state: 5 Bound`,
      `   Lease: ${lease.leaseSeconds} secs,  Renewal: ${Math.floor(lease.leaseSeconds / 2)} secs,  Rebind: ${Math.floor((lease.leaseSeconds * 7) / 8)} secs`,
    );
    if (lease.routers[0] !== undefined) lines.push(`Temp default-gateway addr: ${formatIp(lease.routers[0])}`);
    lines.push(`   Client-ID: ${r.plane.clientIdText(iface)}`, `   Hostname: ${r.iface(iface)?.dhcpClient?.hostname ?? r.hostname}`);
  }
  return lines;
}

export const ROUTER_NET_EXEC: readonly Def[] = [
  {
    syntax: 'ping <WORD:target> [repeat <1-2147483647:n>] [source <WORD:src>]',
    help: { target: 'Ping destination address or hostname', n: 'specify repeat count', src: 'specify source address or name' },
    run: (cli, m) => iosPing(cli, routerPingHost(cli.device), m.get('target') ?? '', Number(m.get('n') ?? DEFAULT_COUNT), m.get('src')),
  },
  {
    syntax: 'traceroute <WORD:target>',
    help: { target: 'Trace route to destination address or hostname' },
    run: (cli, m) => {
      const target = m.get('target') ?? '';
      const dst = parseIp(target);
      if (dst === null) return cli.out('% Unrecognized host or address, or protocol not running.', '');
      const r = cli.device;
      const steps = traceSteps(r.plane.stack, dst, { maxHops: DEFAULT_MAX_HOPS, probes: 3, timeoutMs: TRACE_TIMEOUT_MS, now: () => r.clock.elapsed() });
      // As ping: a network reaching out of the page prints the hops when the probes have been answered (0.94.0).
      if (cli.session.canWaitLive && waitsLive(r.hooks)) cli.session.waitFor(runLive(steps).then((res) => iosTraceLines(target, res)));
      else cli.out(...iosTraceLines(target, runSteps(r.hooks, steps)));
    },
  },
  { syntax: 'show {arp | ip arp}', run: (cli) => cli.out(...showArp(cli.device.plane.stack, ownArp(cli.device), cli.device.clock.now())) },
  { syntax: 'show dhcp lease', run: (cli) => cli.out(...showDhcpLease(cli.device)) },
];

export const ROUTER_NET_PRIV: readonly Def[] = [
  ...ROUTER_NET_EXEC,
  { syntax: 'clear arp-cache', run: (cli) => cli.device.plane.stack.flushArp() },
  {
    syntax: 'release dhcp <IFACE:iface>',
    run: (cli, m) => {
      const name = dhcpIface(cli, m.get('iface') ?? '');
      const client = name ? cli.device.plane.client(name) : undefined;
      if (!name || !client) return;
      client.release();
      cli.device.plane.leases.delete(name);
    },
  },
  {
    syntax: 'renew dhcp <IFACE:iface>',
    run: (cli, m) => {
      const name = dhcpIface(cli, m.get('iface') ?? '');
      if (!name) return;
      const client = cli.device.plane.client(name);
      if (client) client.renew();
      else cli.device.plane.syncClient(name);
    },
  },
];
