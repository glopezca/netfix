/** Windows Command Prompt: ipconfig, ping, nslookup, netstat, arp, curl, ssh, sc / net (servers). */
import { BaseShell } from './base.ts';
import { resolveHost, dnsQuery, httpGet } from './net-tools.ts';
import { nslookupOutput } from './dns-format.ts';
import type { Host } from '../devices/host.ts';
import { HOST_PORT } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { findUnit, unitActive, openPorts, UNITS } from '../services/units.ts';
import { runPing } from '../net/ping.ts';
import { tracert } from './trace-cmds.ts';
import { formatIp, formatMask, parseIp } from '../core/ip.ts';
import { formatMacCisco } from '../core/mac.ts';
import { formatLeaseTime } from '../core/clock.ts';

const PING_TIMEOUT_MS = 1000;
const DEFAULT_PING_COUNT = 4;
const MAX_PING_COUNT = 100;
const DHCP_WAIT_MS = 20_000;
const MS = 1000;

const HELP = [
  'Available commands:',
  '  arp -a | arp -d          Show / delete the ARP cache',
  '  curl [-I] <url>          HTTP client',
  '  help | ?                 This help',
  '  hostname | whoami | ver  System information',
  '  ipconfig [/all]          Show IP configuration',
  '  ipconfig /release|/renew Release / renew the DHCP lease',
  '  netstat -an              Listening ports and connections',
  '  nslookup <name> [srv]    DNS lookup',
  '  ping [-n N] <host>       Send ICMP echo requests',
  '  tracert [-h N] <host>    Trace the route to a host',
  '  ssh user@host            SSH client',
  '  sc query [svc] | sc start|stop <svc> | net start [svc] | net stop <svc>   (Server)',
];

function linkLocal(mac: string): string {
  const b = (mac.match(/../g) ?? []).map((x) => parseInt(x, 16));
  const first = ((b[0] ?? 0) ^ 0x02).toString(16).padStart(2, '0');
  const h = (x: number): string => x.toString(16).toUpperCase().padStart(2, '0');
  const groups = [`${first}${h(b[1] ?? 0)}`, `${h(b[2] ?? 0)}FF`, `FE${h(b[3] ?? 0)}`, `${h(b[4] ?? 0)}${h(b[5] ?? 0)}`];
  return `FE80::${groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}`.toUpperCase();
}

export function ipconfig(host: Host, all: boolean): string[] {
  const c = host.config;
  const lease = host.dhcpClient.lease;
  const lines = ['', `${HOST_PORT} Connection:(default port)`, ''];
  lines.push(`   Connection-specific DNS Suffix..: ${lease?.domainName ?? ''}`);
  if (all) lines.push(`   Physical Address................: ${formatMacCisco(host.mac).toUpperCase()}`);
  lines.push(
    `   Link-local IPv6 Address.........: ${linkLocal(host.mac)}`,
    '   IPv6 Address....................: ::',
    `   IPv4 Address....................: ${c.ip !== undefined ? formatIp(c.ip) : '0.0.0.0'}`,
    `   Subnet Mask.....................: ${c.prefix !== undefined ? formatMask(c.prefix) : '0.0.0.0'}`,
    '   Default Gateway.................: ::',
    `                                     ${c.gateway !== undefined ? formatIp(c.gateway) : '0.0.0.0'}`,
  );
  if (all) {
    lines.push(`   DHCP Servers....................: ${lease ? formatIp(lease.serverId) : '0.0.0.0'}`, `   DNS Servers.....................: ${c.dns !== undefined ? formatIp(c.dns) : '0.0.0.0'}`);
    if (lease) {
      const exp = lease.leaseSeconds >= 0xffffffff ? 'Infinite' : formatLeaseTime(lease.obtainedAt + lease.leaseSeconds * MS);
      lines.push(`   Lease Obtained..................: ${formatLeaseTime(lease.obtainedAt)}`, `   Lease Expires...................: ${exp}`);
    }
  }
  lines.push('');
  return lines;
}

const NOT_PERMITTED = ['', 'The operation failed as no adapter is in the state permissible for', 'this operation.', ''];

export class WindowsShell extends BaseShell {
  protected readonly osName = 'Windows';
  private readonly remote: boolean;

  constructor(host: Host, user: string, remote = false) {
    super(host, user);
    this.remote = remote;
  }

  protected localPrompt(): string {
    return this.remote ? `${this.user.toLowerCase()}@${this.host.name.toUpperCase()} C:\\Users\\${this.user}>` : 'C:\\>';
  }

  protected notFound(cmd: string): string[] {
    return this.host.kind === 'pc' && !this.remote ? ['Invalid Command.'] : [`'${cmd}' is not recognized as an internal or external command,`, 'operable program or batch file.'];
  }

  protected runLocal(cmd: string, args: string[]): string[] {
    const arg = (args[0] ?? '').toLowerCase();
    switch (cmd.toLowerCase()) {
      case 'ipconfig': return this.ipconfig(arg);
      case 'ping': return this.ping(args);
      case 'tracert': return tracert(this.host, args);
      case 'arp': return this.arp(arg);
      case 'nslookup': return args[0] ? nslookupOutput(args[0], dnsQuery(this.host, args[0], 'A', args[1] ? parseIp(args[1]) ?? undefined : undefined), true) : ['Usage: nslookup <name> [server]'];
      case 'netstat': return this.netstat();
      case 'curl': return this.curl(args);
      case 'hostname': return [this.host.name];
      case 'whoami': return [`${this.host.name.toLowerCase()}\\${this.user.toLowerCase()}`];
      case 'ver': return ['', 'Microsoft Windows [Version 10.0.20348.2700]', ''];
      case 'sc': return this.sc(args);
      case 'net': return this.net(args);
      case 'help': case '?': return HELP;
      case 'cls': return [];
      case 'exit':
        if (this.remote) this.closed = true;
        return [];
      default: return this.notFound(cmd);
    }
  }

  private ipconfig(arg: string): string[] {
    if (arg === '' || arg === '/all') return ipconfig(this.host, arg === '/all');
    if (arg === '/renew') return this.renew();
    if (arg === '/release') return this.release();
    return this.notFound('ipconfig');
  }

  private renew(): string[] {
    const h = this.host;
    if (h.config.mode !== 'dhcp') return NOT_PERMITTED;
    h.dhcpStatus = 'requesting';
    h.dhcpClient.renew();
    h.hooks.runUntil(() => h.dhcpClient.state === 'BOUND' || h.dhcpStatus === 'failed', DHCP_WAIT_MS);
    if (h.dhcpClient.state !== 'BOUND') return ['', `An error occurred while renewing interface ${HOST_PORT} : unable to contact your DHCP server. Request has timed out.`, ''];
    return ipconfig(h, false);
  }

  private release(): string[] {
    const h = this.host;
    if (h.config.mode !== 'dhcp') return NOT_PERMITTED;
    h.dhcpClient.release();
    h.hooks.runUntil(() => false, 10);
    h.config = { mode: 'dhcp' };
    h.dhcpStatus = 'idle';
    return ipconfig(h, false);
  }

  private ping(args: string[]): string[] {
    const nIdx = args.findIndex((w) => w.toLowerCase() === '-n');
    const count = nIdx >= 0 ? Math.min(MAX_PING_COUNT, Math.max(1, Number(args[nIdx + 1]) || DEFAULT_PING_COUNT)) : DEFAULT_PING_COUNT;
    const target = args.filter((_, i) => nIdx < 0 || (i !== nIdx && i !== nIdx + 1)).pop();
    if (!target) return this.notFound('ping');
    const r = resolveHost(this.host, target);
    if (r.kind === 'error') return [`Ping request could not find host ${target}. Please check the name and try again.`];
    const ip = formatIp(r.ip);
    const lines = ['', `Pinging ${r.viaDns ? `${target} [${ip}]` : ip} with 32 bytes of data:`, ''];
    const results = runPing(this.host.stack, this.host.hooks, r.ip, { count, timeoutMs: PING_TIMEOUT_MS });
    for (const x of results) {
      if (x.kind === 'reply') lines.push(`Reply from ${formatIp(x.from)}: bytes=32 time<1ms TTL=${x.ttl}`);
      else if (x.kind === 'unreachable') lines.push(`Reply from ${formatIp(x.from)}: Destination host unreachable.`);
      else if (x.kind === 'ttl') lines.push(`Reply from ${formatIp(x.from)}: TTL expired in transit.`);
      else lines.push('Request timed out.');
    }
    const received = results.filter((x) => x.kind === 'reply').length;
    const lost = count - received;
    lines.push('', `Ping statistics for ${ip}:`, `    Packets: Sent = ${count}, Received = ${received}, Lost = ${lost} (${Math.round((lost * 100) / count)}% loss),`);
    if (received > 0) lines.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms');
    lines.push('');
    return lines;
  }

  private arp(arg: string): string[] {
    if (arg === '-d') {
      this.host.stack.flushArp();
      return [];
    }
    if (arg !== '-a') return this.notFound('arp');
    if (this.host.stack.arp.size === 0) return ['No ARP Entries Found'];
    return ['  Internet Address      Physical Address      Type',
      ...[...this.host.stack.arp].map(([ip, e]) => `  ${formatIp(ip).padEnd(22)}${formatMacCisco(e.mac).padEnd(22)}dynamic`)];
  }

  private netstat(): string[] {
    const local = this.host.config.ip !== undefined ? formatIp(this.host.config.ip) : '0.0.0.0';
    const ports = this.host.kind === 'server' ? openPorts((this.host as Server).services, { http: (this.host as Server).web.httpPorts(), admin: (this.host as Server).web.adminPorts() }) : [];
    return ['', 'Active Connections', '', '  Proto  Local Address          Foreign Address        State',
      ...ports.map((p) => `  ${p.proto.toUpperCase().padEnd(7)}${`${p.proto === 'udp' ? '0.0.0.0' : local}:${p.port}`.padEnd(23)}${(p.proto === 'udp' ? '*:*' : '0.0.0.0:0').padEnd(23)}${p.proto === 'tcp' ? 'LISTENING' : ''}`)];
  }

  private curl(args: string[]): string[] {
    const head = args.includes('-I');
    const url = args.find((a) => !a.startsWith('-'));
    if (!url) return ["curl: try 'curl --help' for more information"];
    const r = httpGet(this.host, url, head ? 'HEAD' : 'GET');
    if (r.kind === 'error') return [`curl: (${r.code}) ${r.message}`];
    return head ? [`HTTP/1.1 ${r.response.status} ${r.response.reason}`, `Server: ${r.response.server}`, `Content-Type: ${r.response.contentType}`, ''] : r.response.body.split('\n');
  }

  // ------------------------------------------------------------ services (Server)

  private server(): Server | undefined {
    return this.host.kind === 'server' ? (this.host as Server) : undefined;
  }

  private sc(args: string[]): string[] {
    const verb = (args[0] ?? '').toLowerCase();
    const s = this.server();
    const unit = args[1] ? findUnit(args[1]) : undefined;
    if (verb === 'query' && !args[1]) return s ? UNITS.flatMap((u) => this.scBlock(s, u.windows)) : [];
    if (!s || !unit) return [`[SC] OpenService FAILED 1060:`, '', 'The specified service does not exist as an installed service.', ''];
    if (verb === 'query') return this.scBlock(s, unit.windows);
    if (verb !== 'start' && verb !== 'stop') return ['DESCRIPTION:', '        SC is a command line program used for communicating with the Service Control Manager.'];
    const running = unitActive(s.services, unit.id);
    if (verb === 'start' && running) return ['[SC] StartService FAILED 1056:', '', 'An instance of the service is already running.', ''];
    if (verb === 'stop' && !running) return ['[SC] ControlService FAILED 1062:', '', 'The service has not been started.', ''];
    s.setUnit(unit.id, verb === 'start');
    return this.scBlock(s, unit.windows);
  }

  private scBlock(s: Server, name: string): string[] {
    const unit = findUnit(name);
    if (!unit) return [];
    const on = unitActive(s.services, unit.id);
    return ['', `SERVICE_NAME: ${unit.windows}`, '        TYPE               : 10  WIN32_OWN_PROCESS', `        STATE              : ${on ? '4  RUNNING' : '1  STOPPED'}`, '        WIN32_EXIT_CODE    : 0  (0x0)'];
  }

  private net(args: string[]): string[] {
    const verb = (args[0] ?? '').toLowerCase();
    const s = this.server();
    if (verb !== 'start' && verb !== 'stop') return ['The syntax of this command is:', '', 'NET [ START | STOP ] [service]'];
    if (verb === 'start' && !args[1]) return ['These Windows services are started:', '', ...(s ? UNITS.filter((u) => unitActive(s.services, u.id)).map((u) => `   ${u.windowsDisplay}`) : []), '', 'The command completed successfully.'];
    const unit = args[1] ? findUnit(args.slice(1).join(' ')) : undefined;
    if (!s || !unit) return ['The service name is invalid.', '', 'More help is available by typing NET HELPMSG 2185.'];
    const running = unitActive(s.services, unit.id);
    if ((verb === 'start') === running) return [verb === 'start' ? 'The requested service has already been started.' : `The ${unit.windowsDisplay} service is not started.`];
    s.setUnit(unit.id, verb === 'start');
    return [`The ${unit.windowsDisplay} service was ${verb === 'start' ? 'started' : 'stopped'} successfully.`, ''];
  }
}
