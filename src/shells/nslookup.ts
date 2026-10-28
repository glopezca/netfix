/**
 * nslookup for the Linux (BIND 9) and Windows terminals: one-shot lookups with -type=, and the interactive mode
 * (`>` prompt) with NAME [SERVER], server/lserver, set type|querytype|q, set [no]debug, set all, help and exit.
 */
import type { Host } from '../devices/host.ts';
import type { Ctx, Gen } from '../bash/types.ts';
import type { DnsType } from '../net/packets.ts';
import type { DnsResult } from '../net/dns.ts';
import { reverseName } from '../net/dns.ts';
import { dnsQuery, dnsSearch, searchDomains } from './net-tools.ts';
import { resolvedDns } from './resolved.ts';
import { nslookupOutput, serverHead } from './nslookup-format.ts';
import { formatIp, parseIp } from '../core/ip.ts';

const TYPES: readonly DnsType[] = ['A', 'CNAME', 'MX', 'NS', 'TXT', 'PTR', 'SOA'];

/** Real options Netfix accepts without changing anything (timers, port, class, recursion, TCP, search list). */
const IGNORED_OPTIONS = new Set(['timeout', 'retry', 'port', 'class', 'cl', 'recurse', 'norecurse', 'vc', 'novc', 'search', 'nosearch', 'domain', 'd2', 'nod2', 'defname', 'nodefname', 'ndots']);

const WINDOWS_HELP = [
  'Commands:   (identifiers are shown in uppercase, [] means optional)',
  'NAME            - print info about the host/domain NAME using default server',
  'NAME1 NAME2     - as above, but use NAME2 as server',
  'help or ?       - print info on common commands',
  'set OPTION      - set an option',
  '    all                 - print options, current server and host',
  '    [no]debug           - print debugging information',
  '    type=X              - set query type (ex. A,CNAME,MX,NS,PTR,SOA,TXT)',
  '    querytype=X         - same as type',
  'server NAME     - set default server to NAME, using current default server',
  'lserver NAME    - set default server to NAME, using initial server',
  'exit            - exit the program',
];

interface Server {
  readonly ip: number;
  /** As the user named it (Linux) or as Windows shows it (PTR name, [ip] or UnKnown). */
  readonly label: string;
}

export interface NsReply {
  readonly out: string[];
  readonly exit: boolean;
}

/** -type=MX, -query=mx, -q=mx: the record type; undefined when it is not one Netfix answers. */
export function parseType(value: string): DnsType | undefined {
  const t = value.toUpperCase();
  return (TYPES as readonly string[]).includes(t) ? t as DnsType : undefined;
}

/** One nslookup run: its options and default server, shared by the one-shot form and the interactive mode. */
export class Nslookup {
  private readonly host: Host;
  private readonly windows: boolean;
  private type: DnsType = 'A';
  /** The type as typed, which BIND shows in `set all`. */
  private typeName = 'A';
  private debug = false;
  /** The last lookup found records of the asked type (the exit status of a one-shot run). */
  ok = false;
  private server: Server | undefined;
  private readonly initial: Server | undefined;

  constructor(host: Host, windows: boolean, server?: number) {
    this.host = host;
    this.windows = windows;
    const ip = server ?? resolvedDns(host);
    this.initial = ip === undefined ? undefined : this.named(ip);
    this.server = this.initial;
  }

  /** Options before the name (-type=, -query=, -q=, -debug); an error line when one is not valid. */
  option(arg: string): string | null {
    const opt = arg.replace(/^-/, '');
    return this.set(opt)[0] ?? null;
  }

  /** What Windows prints on entering the interactive mode. */
  banner(): string[] {
    if (!this.windows) return [];
    if (!this.server) return ['*** Default servers are not available', 'Default Server:  UnKnown', 'Address:  127.0.0.1', ''];
    return serverHead(this.server.label, this.server.ip, true, 'default');
  }

  lookup(name: string, serverArg?: string): string[] {
    const other = serverArg === undefined ? this.server : this.resolveServer(serverArg, this.server);
    if (typeof other === 'string') return [other];
    const ip = parseIp(name);
    const reverse = ip !== null && this.type === 'A';
    const result: DnsResult = reverse ? dnsQuery(this.host, reverseName(ip), 'PTR', other?.ip) : dnsSearch(this.host, name, this.type, other?.ip).result;
    const asked = reverse ? 'PTR' : this.type;
    this.ok = result.kind === 'answer' && (result.msg.answers ?? []).some((a) => a.type === asked);
    return nslookupOutput(name, result, this.windows, { serverLabel: other?.label, debug: this.debug });
  }

  /** One line typed at the `>` prompt. */
  line(text: string): NsReply {
    const [cmd = '', ...args] = text.trim().split(/\s+/).filter(Boolean);
    const lower = cmd.toLowerCase();
    if (!cmd) return { out: [], exit: false };
    if (lower === 'exit') return { out: [], exit: true };
    if (lower === 'set') return { out: args[0] ? this.set(args[0]) : [], exit: false };
    if (lower === 'server' || lower === 'lserver') return { out: this.changeServer(args[0], lower === 'lserver'), exit: false };
    if (lower === 'help' || lower === '?') return { out: this.windows ? WINDOWS_HELP : [`The '${cmd}' command is not yet implemented.`], exit: false };
    return { out: this.lookup(cmd, args[0]), exit: false };
  }

  private set(option: string): string[] {
    const [key = '', value] = option.split('=');
    const k = key.toLowerCase();
    if (k === 'all') return this.all();
    if (k === 'debug' || k === 'nodebug') { this.debug = k === 'debug'; return []; }
    if ((k === 'type' || k === 'querytype' || k === 'q' || k === 'query') && value !== undefined) {
      const t = parseType(value);
      if (!t) return [this.windows ? `*** Invalid option: ${option}` : `unknown query type: ${value}`];
      this.type = t;
      this.typeName = value;
      return [];
    }
    return IGNORED_OPTIONS.has(k) ? [] : [`*** Invalid option: ${option}`];
  }

  private all(): string[] {
    const head = this.server ? serverHead(this.server.label, this.server.ip, this.windows, 'default') : [];
    const domains = searchDomains(this.host).join(' ');
    if (this.windows) {
      return [...head, 'Set options:', `  ${this.debug ? '' : 'no'}debug`, '  defname', '  search', '  recurse', '  nod2', '  novc', '  noignoretc', '  port=53', `  type=${this.typeName}`, '  class=IN', '  timeout=2', '  retry=1', `  srchlist=${domains}`, ''];
    }
    return [...head, '', 'Set options:', `  novc\t\t\t${this.debug ? '' : 'no'}debug\t\tnod2`, '  search\t\trecurse', '  timeout = 0\t\tretry = 3\tport = 53\tndots = 1', `  querytype = ${this.typeName.padEnd(8)}\tclass = IN`, `  srchlist = ${domains}`];
  }

  /** `nslookup - SERVER` with a name: the server for the session, an error line when it does not resolve. */
  useServer(name: string): string[] {
    const found = this.resolveServer(name, this.server);
    if (typeof found === 'string') return [found];
    this.server = found;
    return [];
  }

  private changeServer(name: string | undefined, fromInitial: boolean): string[] {
    if (!name) return [];
    const found = this.resolveServer(name, fromInitial ? this.initial : this.server);
    if (typeof found === 'string') return [found];
    this.server = found;
    return serverHead(found.label, found.ip, this.windows, 'default');
  }

  /** An address as it is; a name, looked up with the given server. */
  private resolveServer(name: string, via: Server | undefined): Server | string {
    const ip = parseIp(name);
    if (ip !== null) return this.named(ip, this.windows ? `[${name}]` : name);
    const r = dnsSearch(this.host, name, 'A', via?.ip).result;
    const a = r.kind === 'answer' ? r.msg.answers?.find((x) => x.type === 'A') : undefined;
    const addr = a ? parseIp(a.data) : null;
    if (addr !== null && addr !== undefined) return { ip: addr, label: this.windows ? a?.name ?? name : name };
    const why = r.kind === 'answer' ? r.msg.rcode ?? 'NOERROR' : 'timed out';
    if (this.windows) return `*** Can't find address for server ${name}: ${why === 'NXDOMAIN' ? 'Non-existent domain' : 'No response from server'}`;
    return `*** Can't find address for server ${name}: ${why}`;
  }

  /** Windows names a server by its PTR record (asked to that server), falling back to `fallback` or UnKnown. */
  private named(ip: number, fallback?: string): Server {
    if (!this.windows) return { ip, label: fallback ?? formatIp(ip) };
    const r = dnsQuery(this.host, reverseName(ip), 'PTR', ip);
    const ptr = r.kind === 'answer' ? r.msg.answers?.find((a) => a.type === 'PTR')?.data : undefined;
    return { ip, label: ptr ?? fallback ?? 'UnKnown' };
  }
}

/** The arguments of nslookup: options, NAME (or - for interactive) and SERVER. */
export function parseNslookupArgs(args: readonly string[]): { opts: string[]; name?: string; server?: string } {
  const opts = args.filter((a) => a.startsWith('-') && a !== '-');
  const [name, server] = args.filter((a) => !a.startsWith('-') || a === '-');
  return { opts, name, server };
}

/** The NAME of a one-shot lookup (with its options), or an interactive session; an error line when an option is wrong. */
export function startNslookup(host: Host, windows: boolean, args: readonly string[]): { ns: Nslookup; interactive: boolean; out: string[] } {
  const { opts, name, server } = parseNslookupArgs(args);
  const serverIp = server === undefined ? undefined : parseIp(server) ?? undefined;
  const ns = new Nslookup(host, windows, serverIp);
  const errors = opts.map((o) => ns.option(o)).filter((e): e is string => e !== null);
  if (errors.length) return { ns, interactive: false, out: errors };
  if (name === undefined || name === '-') {
    const failed = server !== undefined && serverIp === undefined ? ns.useServer(server) : [];
    return { ns, interactive: true, out: [...failed, ...ns.banner()] };
  }
  return { ns, interactive: false, out: ns.lookup(name, serverIp === undefined ? server : undefined) };
}

/** The Ubuntu program: one lookup, or the `>` prompt until exit or Ctrl+D. */
export function nslookupProgram(host: Host) {
  return function* run(ctx: Ctx): Gen<number> {
    const start = startNslookup(host, false, ctx.argv.slice(1));
    const print = (lines: readonly string[]): void => { if (lines.length) ctx.out(`${lines.join('\n')}\n`); };
    print(start.out);
    if (!start.interactive) return start.ns.ok ? 0 : 1;
    for (;;) {
      const line = yield* ctx.readLine('> ');
      if (line === null) return 0;
      const reply = start.ns.line(line.text);
      print(reply.out);
      if (reply.exit) return 0;
    }
  };
}
