/** bash on Ubuntu: iproute2, ping, dig/nslookup/host, curl/wget, ssh, systemctl, journalctl, ss. */
import { BaseShell } from './base.ts';
import { resolveHost, dnsQuery, httpGet, splitArgs } from './net-tools.ts';
import { linuxFiles, listDir, describeAddress, linuxMac, IFACE } from './linux-files.ts';
import { systemctl, journalctl, ss } from './linux-services.ts';
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

const HELP = [
  'Comandos disponibles (bash simulado de Ubuntu):',
  '  ip a | ip r | ip neigh        direcciones, rutas y vecinos (ARP)',
  '  ping [-c N] <host>            conectividad ICMP',
  '  dig [@srv] <nombre> [tipo]    consulta DNS (+short)    nslookup / host',
  '  curl [-I] <url> | wget <url>  cliente HTTP',
  '  ssh usuario@host              cliente SSH',
  '  sudo dhclient [-r] eth0       renovar / liberar la concesión DHCP',
  '  systemctl status|start|stop|restart|enable|disable <servicio>',
  '  journalctl -u <servicio> [-n N]   ss -tulpn',
  '  cat <fichero> | ls <dir>      p. ej. /etc/resolv.conf, /etc/kea/kea-dhcp4.conf',
  '  hostname [-I] | whoami | uname -a | exit',
];

export class LinuxShell extends BaseShell {
  protected readonly osName = 'Linux';
  private readonly remote: boolean;

  constructor(host: ConstructorParameters<typeof BaseShell>[0], user: string, remote = false) {
    super(host, user);
    this.remote = remote;
  }

  protected localPrompt(): string {
    return `${this.user}@${this.host.name.toLowerCase()}:~${this.user === 'root' ? '#' : '$'} `;
  }

  protected notFound(cmd: string): string[] {
    return [`${cmd}: command not found`];
  }

  protected runLocal(cmd: string, args: string[], line: string): string[] {
    if (cmd === 'sudo') return args.length ? this.exec(args[0] ?? '', args.slice(1), line, true) : ['usage: sudo command'];
    return this.exec(cmd, args, line, this.user === 'root');
  }

  private exec(cmd: string, args: string[], line: string, root: boolean): string[] {
    switch (cmd) {
      case 'help': return HELP;
      case 'exit': case 'logout':
        if (this.remote) this.closed = true;
        return this.remote ? ['logout'] : ['(consola local: cierra la ventana para salir)'];
      case 'clear': return [];
      case 'whoami': return [this.user];
      case 'hostname': return args.includes('-I') ? [`${this.host.config.ip !== undefined ? formatIp(this.host.config.ip) : ''} `] : [this.host.name.toLowerCase()];
      case 'uname': return [args.includes('-a') ? `Linux ${this.host.name.toLowerCase()} 6.17.0-generic #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux` : 'Linux'];
      case 'ip': return this.ip(args);
      case 'ifconfig': case 'netstat': case 'route':
        return [`Command '${cmd}' not found, but can be installed with:`, 'sudo apt install net-tools', `(en Ubuntu moderno usa: ${cmd === 'netstat' ? 'ss -tulpn' : cmd === 'route' ? 'ip r' : 'ip a'})`];
      case 'ping': return this.ping(args);
      case 'dig': return this.dig(args);
      case 'nslookup': return nslookupOutput(args[0] ?? '', dnsQuery(this.host, args[0] ?? '', 'A', args[1] ? parseIp(args[1]) ?? undefined : undefined), false);
      case 'host': return args[0] ? hostOutput(args[0], dnsQuery(this.host, args[0], 'A', args[1] ? parseIp(args[1]) ?? undefined : undefined)) : ['Usage: host [-t type] name [server]'];
      case 'curl': return this.curl(args);
      case 'wget': return this.wget(args);
      case 'systemctl': return systemctl(this.host, args, root);
      case 'service': return args.length >= 2 ? systemctl(this.host, [args[1] ?? '', args[0] ?? ''], root) : ['Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]'];
      case 'journalctl': return journalctl(this.host, args);
      case 'ss': return ss(this.host);
      case 'cat': return this.cat(args);
      case 'ls': return this.ls(args);
      case 'dhclient': return this.dhclient(args, root);
      default: return line.includes('=') ? [] : this.notFound(cmd);
    }
  }

  // ------------------------------------------------------------ iproute2

  private ip(args: string[]): string[] {
    const obj = args[0] ?? '';
    const c = this.host.config;
    if ('address'.startsWith(obj) || obj === 'a') {
      const addr = describeAddress(this.host);
      const up = this.host.linkUp() ? 'UP' : 'DOWN';
      const lines = [
        '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
        '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
        '    inet 127.0.0.1/8 scope host lo',
        `2: ${IFACE}: <BROADCAST,MULTICAST${up === 'UP' ? ',UP,LOWER_UP' : ''}> mtu 1500 qdisc fq_codel state ${up} group default qlen 1000`,
        `    link/ether ${linuxMac(this.host.mac)} brd ff:ff:ff:ff:ff:ff`,
      ];
      if (addr) lines.push(`    inet ${addr.inet} brd ${addr.brd} scope ${addr.scope} ${IFACE}`);
      return lines;
    }
    if ('route'.startsWith(obj) || obj === 'r') {
      if (c.ip === undefined || c.prefix === undefined) return [];
      const proto = c.mode === 'dhcp' ? 'dhcp' : 'static';
      const out = [`${formatIp(networkOf(c.ip, c.prefix))}/${c.prefix} dev ${IFACE} proto kernel scope link src ${formatIp(c.ip)}`];
      if (c.gateway !== undefined) out.unshift(`default via ${formatIp(c.gateway)} dev ${IFACE} proto ${proto} metric 100`);
      return out;
    }
    if ('neighbour'.startsWith(obj) || obj === 'n' || obj === 'neigh') {
      return [...this.host.stack.arp.entries()].map(([ip, e]) => `${formatIp(ip)} dev ${IFACE} lladdr ${linuxMac(e.mac)} REACHABLE`);
    }
    if ('link'.startsWith(obj)) return [`2: ${IFACE}: <BROADCAST,MULTICAST,UP> mtu 1500 state ${this.host.linkUp() ? 'UP' : 'DOWN'}`, `    link/ether ${linuxMac(this.host.mac)} brd ff:ff:ff:ff:ff:ff`];
    return ['Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }', '       OBJECT := { address | route | neigh | link }'];
  }

  // ------------------------------------------------------------ ping / dns / http

  private ping(args: string[]): string[] {
    const cIdx = args.indexOf('-c');
    const count = cIdx >= 0 ? Math.min(MAX_PING_COUNT, Math.max(1, Number(args[cIdx + 1]) || DEFAULT_PING_COUNT)) : DEFAULT_PING_COUNT;
    const target = args.filter((_, i) => cIdx < 0 || (i !== cIdx && i !== cIdx + 1)).find((a) => !a.startsWith('-'));
    if (!target) return ['ping: usage error: Destination address required'];
    const r = resolveHost(this.host, target);
    if (r.kind === 'error') return [`ping: ${target}: ${r.reason === 'nxdomain' ? 'Name or service not known' : 'Temporary failure in name resolution'}`];
    const results = runPing(this.host.stack, this.host.hooks, r.ip, { count, timeoutMs: PING_TIMEOUT_MS });
    if (results.every((x) => x.kind === 'noroute')) return ['ping: connect: Network is unreachable'];
    const ip = formatIp(r.ip);
    const lines = [`PING ${target} (${ip}) 56(84) bytes of data.`];
    results.forEach((x, i) => {
      if (x.kind === 'reply') lines.push(`64 bytes from ${r.viaDns ? `${target} (${ip})` : ip}: icmp_seq=${i + 1} ttl=${x.ttl} time=0.${400 + i * 37} ms`);
      else if (x.kind === 'unreachable') lines.push(`From ${formatIp(x.from)} icmp_seq=${i + 1} Destination Host Unreachable`);
      else if (x.kind === 'ttl') lines.push(`From ${formatIp(x.from)} icmp_seq=${i + 1} Time to live exceeded`);
    });
    const ok = results.filter((x) => x.kind === 'reply').length;
    lines.push('', `--- ${target} ping statistics ---`, `${count} packets transmitted, ${ok} received, ${Math.round(((count - ok) * 100) / count)}% packet loss, time ${(count - 1) * 1001}ms`);
    if (ok) lines.push('rtt min/avg/max/mdev = 0.400/0.455/0.511/0.040 ms');
    return lines;
  }

  private dig(args: string[]): string[] {
    const server = args.find((a) => a.startsWith('@'));
    const short = args.includes('+short');
    const rest = args.filter((a) => !a.startsWith('@') && !a.startsWith('+'));
    const rev = rest.indexOf('-x');
    const type = rest.map((a) => a.toUpperCase()).find((a): a is DnsType => (DNS_TYPES as readonly string[]).includes(a));
    const name = rev >= 0 ? (() => { const ip = parseIp(rest[rev + 1] ?? ''); return ip === null ? '' : reverseName(ip); })() : rest.find((a) => a.toUpperCase() !== type);
    if (!name) return ['Usage: dig [@server] name [type] [+short]  |  dig -x <ip>'];
    const qtype: DnsType = rev >= 0 ? 'PTR' : type ?? 'A';
    const srv = server ? parseIp(server.slice(1)) ?? undefined : undefined;
    return digOutput(name, qtype, dnsQuery(this.host, name, qtype, srv), short, this.host.clock.now());
  }

  private curl(args: string[]): string[] {
    const head = args.includes('-I') || args.includes('--head');
    const url = args.find((a) => !a.startsWith('-'));
    if (!url) return ['curl: try \'curl --help\' for more information'];
    const r = httpGet(this.host, url, head ? 'HEAD' : 'GET');
    if (r.kind === 'error') return [`curl: (${r.code}) ${r.message}`];
    const res = r.response;
    if (!head) return res.body.split('\n');
    return [`HTTP/1.1 ${res.status} ${res.reason}`, `Server: ${res.server}`, `Content-Type: ${res.contentType}`, `Content-Length: ${res.body.length || '—'}`, ''];
  }

  private wget(args: string[]): string[] {
    const url = args.find((a) => !a.startsWith('-'));
    if (!url) return ['wget: missing URL'];
    const r = httpGet(this.host, url);
    if (r.kind === 'error') return [`wget: ${r.message}`];
    const name = url.split('/').filter(Boolean).slice(url.includes('://') ? 2 : 1).pop() ?? 'index.html';
    const res = r.response;
    return [`Connecting to ${url}... connected.`, `HTTP request sent, awaiting response... ${res.status} ${res.reason}`,
      ...(res.status === 200 ? [`Length: ${res.body.length} [${res.contentType.split(';')[0]}]`, `‘${name || 'index.html'}’ saved [${res.body.length}/${res.body.length}]`] : [`ERROR ${res.status}: ${res.reason}.`])];
  }

  // ------------------------------------------------------------ files & dhcp

  private cat(args: string[]): string[] {
    if (!args.length) return [];
    const files = linuxFiles(this.host);
    return args.flatMap((p) => {
      const content = files.get(p);
      if (content !== undefined) return content.replace(/\n$/, '').split('\n');
      return [listDir(files, p) ? `cat: ${p}: Is a directory` : `cat: ${p}: No such file or directory`];
    });
  }

  private ls(args: string[]): string[] {
    const dir = args.find((a) => !a.startsWith('-')) ?? '/etc';
    const entries = listDir(linuxFiles(this.host), dir);
    return entries ? [entries.join('  ')] : [`ls: cannot access '${dir}': No such file or directory`];
  }

  private dhclient(args: string[], root: boolean): string[] {
    if (!root) return ['dhclient: Permission denied (usa sudo)'];
    if (args.includes('-r')) {
      this.host.dhcpClient.release();
      this.host.hooks.runUntil(() => false, 10);
      this.host.config = { mode: 'dhcp' };
      this.host.dhcpStatus = 'idle';
      return [];
    }
    this.host.useDhcp();
    this.host.hooks.runUntil(() => this.host.dhcpStatus !== 'requesting', DHCP_WAIT_MS);
    return this.host.dhcpStatus === 'ok' ? [] : ['dhclient: No DHCPOFFERS received.'];
  }
}

export { splitArgs };
