/**
 * Port checking for firewall labs: nc (netcat-openbsd, `-z` mode) and an nmap subset (connect scan,
 * ping sweep). Probes run in parallel on the simulated network, so a filtered port costs one timeout.
 */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { ProbeResult } from '../net/tcp.ts';
import { resolveHost } from './net-tools.ts';
import { formatIp, parseIp } from '../core/ip.ts';

const SERVICES: Readonly<Record<number, string>> = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 80: 'http', 110: 'pop3', 111: 'rpcbind', 135: 'msrpc', 139: 'netbios-ssn',
  143: 'imap', 443: 'https', 445: 'microsoft-ds', 587: 'submission', 993: 'imaps', 995: 'pop3s', 1723: 'pptp', 2222: 'EtherNetIP-1',
  3000: 'ppp', 3306: 'mysql', 3389: 'ms-wbt-server', 5000: 'upnp', 5432: 'postgresql', 5900: 'vnc', 8000: 'http-alt', 8008: 'http',
  8080: 'http-proxy', 8081: 'blackice-icecap', 8443: 'https-alt', 8888: 'sun-answerbook', 9000: 'cslistener', 10000: 'snet-sensor-mgmt',
};
/** Ports scanned without -p (Netfix stands in for nmap's top 1000 with the ones a lab can open). */
const TOP_PORTS = Object.keys(SERVICES).map(Number);
const TOP_TOTAL = 1000;
const MAX_PORTS = 1024;
const MAX_HOSTS = 256;
const PROBE_MS = 1500;
const COLLAPSE = 25;
const NMAP_VERSION = 'Nmap 7.94SVN';

/** Runs every probe in parallel and waits (simulated time) until all have answered or timed out. */
function probeAll(host: Host, targets: readonly { ip: number; port: number }[], timeoutMs: number): ProbeResult[] {
  const results: (ProbeResult | undefined)[] = targets.map(() => undefined);
  targets.forEach((t, i) => host.tcp.probe(t.ip, t.port, (r) => { results[i] = r; }, timeoutMs));
  host.hooks.runUntil(() => results.every((r) => r !== undefined), timeoutMs + 500);
  return results.map((r) => r ?? 'filtered');
}

function parsePorts(spec: string): number[] | null {
  if (spec === '-') return null;
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const a = Number(m?.[1]);
    const b = Number(m?.[2] ?? m?.[1]);
    if (!m || a < 1 || b > 65535 || a > b) return [];
    for (let p = a; p <= b && out.size <= MAX_PORTS; p++) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

// ------------------------------------------------------------ nc

export function nc(host: Host): CommandFn {
  return (ctx) => {
    const args = ctx.argv.slice(1);
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const wIdx = args.indexOf('-w');
    const timeout = wIdx >= 0 ? Math.max(1, Number(args[wIdx + 1]) || 1) * 1000 : 5000;
    const rest = args.filter((a, i) => !a.startsWith('-') && i !== wIdx + 1);
    const [target, ...portSpecs] = rest;
    if (!target || !portSpecs.length) { ctx.err('usage: nc [-46CDdFhklNnrStUuvZz] [-I length] [-i interval] [-M ttl]\n\t  [-m minttl] [-O length] [-P proxy_username] [-p source_port]\n\t  [-q seconds] [-s sourceaddr] [-T keyword] [-V rtable] [-W recvlimit]\n\t  [-w timeout] [-X proxy_protocol] [-x proxy_address[:port]]\n\t  [destination] [port]\n'); return 1; }
    if (!flags.includes('z')) { ctx.err('nc: solo está disponible el modo de comprobación de puertos (-z) en Netfix\n'); return 1; }
    const r = resolveHost(host, target);
    if (r.kind === 'error') { ctx.err(`nc: getaddrinfo for host "${target}" port ${portSpecs[0]}: Name or service not known\n`); return 1; }
    const ports = portSpecs.flatMap((p) => parsePorts(p) ?? []);
    const verbose = flags.includes('v');
    const udp = flags.includes('u');
    const results = udp ? ports.map((): ProbeResult => 'open') : probeAll(host, ports.map((port) => ({ ip: r.ip, port })), timeout);
    let ok = false;
    ports.forEach((port, i) => {
      const proto = udp ? 'udp' : 'tcp';
      const res = results[i];
      if (res === 'open') {
        ok = true;
        if (verbose) ctx.err(`Connection to ${target} ${port} port [${proto}/${SERVICES[port] ?? '*'}] succeeded!\n`);
      } else if (verbose || ports.length === 1) {
        ctx.err(res === 'closed' ? `nc: connect to ${target} port ${port} (${proto}) failed: Connection refused\n` : res === 'noroute' ? `nc: connect to ${target} port ${port} (${proto}) failed: Network is unreachable\n` : `nc: connect to ${target} port ${port} (${proto}) timed out: Operation now in progress\n`);
      }
    });
    return ok ? 0 : 1;
  };
}

// ------------------------------------------------------------ nmap

function targets(host: Host, spec: string): { ip: number; name?: string }[] | string {
  const cidr = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(spec);
  if (cidr) {
    const base = parseIp(cidr[1] ?? '');
    const prefix = Number(cidr[2]);
    if (base === null || prefix < 24 || prefix > 32) return `Netfix: rango demasiado grande (máximo /24, ${MAX_HOSTS} direcciones)`;
    const size = 2 ** (32 - prefix);
    const net = (base & ~(size - 1)) >>> 0;
    return Array.from({ length: size }, (_, i) => ({ ip: (net + i) >>> 0 }));
  }
  const range = /^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/.exec(spec);
  if (range) {
    const from = Number(range[2]);
    const to = Math.min(255, Number(range[3]));
    return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({ ip: parseIp(`${range[1]}.${from + i}`) ?? 0 }));
  }
  const r = resolveHost(host, spec);
  return r.kind === 'error' ? `Failed to resolve "${spec}".` : [{ ip: r.ip, name: r.viaDns ? spec : undefined }];
}

/** Host discovery: ICMP echo, or any answer on TCP 80/443 (a host that drops pings can still be up). */
function hostsUp(host: Host, list: readonly { ip: number }[]): boolean[] {
  const echo: boolean[] = list.map(() => false);
  // Only an answer from the address itself: a router answering for a broadcast address is not a host there.
  list.forEach((t, i) => host.stack.echo(t.ip, 0x4e4d, i, undefined, (r) => { if (r.kind === 'reply' && r.from === t.ip) echo[i] = true; }));
  const tcp = probeAll(host, list.flatMap((t) => [{ ip: t.ip, port: 80 }, { ip: t.ip, port: 443 }]), PROBE_MS);
  return list.map((_, i) => echo[i] === true || tcp[i * 2] === 'open' || tcp[i * 2] === 'closed' || tcp[i * 2 + 1] === 'open' || tcp[i * 2 + 1] === 'closed');
}

type PortState = 'open' | 'closed' | 'filtered';

const stateOf = (r: ProbeResult | undefined): PortState => (r === 'open' ? 'open' : r === 'closed' ? 'closed' : 'filtered');

/**
 * The PORT/STATE/SERVICE table. Like nmap, the non-open state with most ports is collapsed into
 * "Not shown" when it has more than 25; ports of the default list that Netfix does not probe count there.
 */
function portTable(name: string, ports: readonly number[], results: readonly ProbeResult[], total: number): string[] {
  const states = results.map(stateOf);
  const count = (s: PortState): number => states.filter((x) => x === s).length;
  const majority: PortState = count('closed') >= count('filtered') ? 'closed' : 'filtered';
  const hiddenCount = count(majority) + Math.max(0, total - ports.length);
  const hidden = hiddenCount > COLLAPSE ? majority : null;
  const reason = majority === 'closed' ? 'closed tcp ports (conn-refused)' : 'filtered tcp ports (no-response)';
  const notShown = hidden ? [`Not shown: ${hiddenCount} ${reason}`] : [];
  const shown = ports.map((p, i) => ({ p, s: states[i] ?? 'filtered' })).filter((x) => x.s !== hidden);
  if (!shown.length) return [`All ${total} scanned ports on ${name} are in ignored states.`, ...notShown];
  const pw = Math.max(4, ...shown.map((x) => `${x.p}/tcp`.length));
  const sw = Math.max(5, ...shown.map((x) => x.s.length));
  return [...notShown, `${'PORT'.padEnd(pw)} ${'STATE'.padEnd(sw)} SERVICE`, ...shown.map((x) => `${`${x.p}/tcp`.padEnd(pw)} ${x.s.padEnd(sw)} ${SERVICES[x.p] ?? 'unknown'}`)];
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export function nmap(host: Host): CommandFn {
  return (ctx: Ctx) => {
    const args = ctx.argv.slice(1);
    const pIdx = args.findIndex((a) => a === '-p' || (a.startsWith('-p') && a.length > 2 && a !== '-Pn'));
    const pSpec = pIdx < 0 ? undefined : args[pIdx] === '-p' ? args[pIdx + 1] : args[pIdx]?.slice(2);
    const spec = args.filter((a, i) => !a.startsWith('-') && !(pIdx >= 0 && args[pIdx] === '-p' && i === pIdx + 1))[0];
    if (!spec) { ctx.out(`${NMAP_VERSION} ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}\n`); return 0; }
    const ports = pSpec === undefined ? TOP_PORTS : parsePorts(pSpec) ?? parsePorts(`1-${MAX_PORTS}`) ?? [];
    if (!ports.length) { ctx.err(`Your port specifications are illegal.  Example of proper form: "-100,200-1024,T:3000-4000,U:60000-"\nQUITTING!\n`); return 1; }
    const list = targets(host, spec);
    if (typeof list === 'string') { ctx.err(`${list}\nWARNING: No targets were specified, so 0 hosts scanned.\n`); return 1; }
    const started = host.clock.now();
    const out = [`Starting ${NMAP_VERSION} ( https://nmap.org ) at ${stamp(started)} UTC`];
    const up = args.includes('-Pn') ? list.map(() => true) : hostsUp(host, list);
    const pingOnly = args.includes('-sn') || args.includes('-sP');
    list.forEach((t, i) => {
      if (!up[i]) return;
      const name = t.name ? `${t.name} (${formatIp(t.ip)})` : formatIp(t.ip);
      out.push(`Nmap scan report for ${name}`, 'Host is up (0.00042s latency).');
      if (pingOnly) return;
      const states = probeAll(host, ports.map((port) => ({ ip: t.ip, port })), PROBE_MS);
      out.push(...portTable(name, ports, states, pSpec === undefined ? TOP_TOTAL : ports.length), '');
    });
    const count = up.filter(Boolean).length;
    if (list.length === 1 && !count) out.push('Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn');
    const secs = ((host.clock.now() - started) / 1000 + 0.05).toFixed(2);
    out.push(`Nmap done: ${list.length} IP address${list.length === 1 ? '' : 'es'} (${count} host${count === 1 ? '' : 's'} up) scanned in ${secs} seconds`);
    ctx.out(`${out.join('\n')}\n`);
    return 0;
  };
}
