/**
 * resolvectl (systemd-resolved) in the Linux terminals: status, query, dns, domain, revert, flush-caches,
 * reset-server-features and statistics, as systemd 257 prints them. Changes are runtime state (shells/resolved.ts).
 */
import type { Ctx, CommandFn } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { DnsType } from '../net/packets.ts';
import { searchDomains } from './net-tools.ts';
import { resolvedDns, resolvedDomains, revertResolved, setResolvedDns, setResolvedDomains, transactionCount } from './resolved.ts';
import { EMPTY_TYPES, QUERY_TYPES, query, shown } from './resolvectl-query.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { t } from '../i18n/t.ts';

interface Link {
  readonly index: number;
  readonly name: string;
  readonly primary: boolean;
}

const PROTOCOLS = '-LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported';
/** Linux numbers lo 1, then the NICs. */
const FIRST_NIC_INDEX = 2;
const DOMAIN = /^~?(?:\.|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i;
const MAX_DOMAINS = 8;
const MAX_DOMAIN = 253;

const links = (host: Host): Link[] => host.nics().map((n, i) => ({ index: i + FIRST_NIC_INDEX, name: n.linux, primary: n.port === host.primaryPort() }));
const linkDns = (host: Host, l: Link): number | undefined => (l.primary ? resolvedDns(host) : undefined);
const linkDomains = (host: Host, l: Link): readonly string[] => (l.primary ? resolvedDomains(host) ?? searchDomains(host) : []);
const key = (k: string): string => k.padStart(18);

function linkBlock(host: Host, l: Link): string[] {
  const dns = linkDns(host, l);
  const domains = linkDomains(host, l);
  const route = l.primary && host.config.gateway !== undefined ? '+DefaultRoute' : '-DefaultRoute';
  return [
    `Link ${l.index} (${l.name})`,
    `${key('Current Scopes')}: ${dns === undefined ? 'none' : 'DNS'}`,
    `${key('Protocols')}: ${route} ${PROTOCOLS}`,
    ...(dns === undefined ? [] : [`${key('Current DNS Server')}: ${formatIp(dns)}`, `${key('DNS Servers')}: ${formatIp(dns)}`]),
    ...(domains.length ? [`${key('DNS Domain')}: ${domains.join(' ')}`] : []),
  ];
}

function status(host: Host, only?: Link): string[] {
  if (only) return linkBlock(host, only);
  const global = ['Global', `${key('Protocols')}: ${PROTOCOLS}`, `${key('resolv.conf mode')}: foreign`];
  return [...global, ...links(host).flatMap((l) => ['', ...linkBlock(host, l)])];
}

const out = (ctx: Ctx, list: readonly string[]): void => { if (list.length) ctx.out(`${list.join('\n')}\n`); };

function findLink(ctx: Ctx, host: Host, name: string | undefined): Link | undefined | null {
  if (name === undefined) return undefined;
  const l = links(host).find((x) => x.name === name);
  if (!l) ctx.err(`Failed to resolve interface "${shown(name)}": No such device\n`);
  return l ?? null;
}

/** dns / domain: list them, or (root) set them on the link. */
function perLink(ctx: Ctx, host: Host, what: 'dns' | 'domain', args: readonly string[]): number {
  const link = findLink(ctx, host, args[0]);
  if (link === null) return 1;
  const show = (l: Link): string => `Link ${l.index} (${l.name}):${(what === 'dns' ? [linkDns(host, l)].filter((x): x is number => x !== undefined).map(formatIp) : [...linkDomains(host, l)]).map((x) => ` ${x}`).join('')}`;
  if (!link) { out(ctx, ['Global:', ...links(host).map(show)]); return 0; }
  const values = args.slice(1);
  if (!values.length) { out(ctx, [show(link)]); return 0; }
  if (!privileged(ctx, `set ${what === 'dns' ? 'DNS' : 'domain'} configuration`)) return 1;
  if (!link.primary) { ctx.err(`resolvectl: ${t('resolvectl.primaryOnly', { link: links(host).find((l) => l.primary)?.name ?? 'eth0' })}\n`); return 1; }
  return what === 'dns' ? setDns(ctx, host, values) : setDomains(ctx, host, values);
}

function setDns(ctx: Ctx, host: Host, values: readonly string[]): number {
  // resolvectl dns eth0 "": no server on the link.
  if (values.length === 1 && values[0] === '') { setResolvedDns(host, null); return 0; }
  const bad = values.find((v) => parseIp(v) === null);
  if (bad !== undefined) { ctx.err(`Failed to parse DNS server address: ${shown(bad)}\n`); return 1; }
  const first = parseIp(values[0] ?? '') ?? 0;
  if (values.length > 1) ctx.err(`resolvectl: ${t('resolvectl.oneServer', { ip: formatIp(first) })}\n`);
  setResolvedDns(host, first);
  return 0;
}

function setDomains(ctx: Ctx, host: Host, values: readonly string[]): number {
  if (values.length === 1 && values[0] === '') { setResolvedDomains(host, []); return 0; }
  const bad = values.find((v) => v.replace(/^~/, '').length > MAX_DOMAIN || !DOMAIN.test(v));
  if (bad !== undefined) { ctx.err(`Failed to parse domain name: ${shown(bad)}\n`); return 1; }
  setResolvedDomains(host, values.slice(0, MAX_DOMAINS).map((d) => d.toLowerCase()));
  return 0;
}

const HELP = ['resolvectl [OPTIONS...] COMMAND ...', '', 'Send control commands to the network name resolution manager, or', 'resolve domain names, IPv4 and IPv6 addresses, DNS records, and services.', '',
  'Commands:', '  query HOSTNAME|ADDRESS...    Resolve domain names, IPv4 and IPv6 addresses', '  status [LINK...]             Show link and server status', '  statistics                   Show resolver statistics',
  '  reset-server-features        Forget learnt DNS server feature levels', '  flush-caches                 Flush all local DNS caches', '  dns [LINK [SERVER...]]       Get/set per-interface DNS server address',
  '  domain [LINK [DOMAIN...]]    Get/set per-interface search domain', '  revert LINK                  Revert per-interface configuration', '', 'Options:', '  -h --help                    Show this help', '  -t --type=TYPE               Query RR with DNS type', '     --legend=BOOL             Print headers and additional info (default: yes)'];

function statistics(host: Host): string[] {
  const n = String(transactionCount(host));
  return ['Transactions', `${key('Current Transactions').slice(-20)}: 0`, `${'Total Transactions'.padStart(20)}: ${n}`, '', 'Cache', `${'Current Cache Size'.padStart(20)}: 0`, `${'Cache Hits'.padStart(20)}: 0`, `${'Cache Misses'.padStart(20)}: ${n}`,
    '', 'DNSSEC Verdicts', `${'Secure'.padStart(20)}: 0`, `${'Insecure'.padStart(20)}: 0`, `${'Bogus'.padStart(20)}: 0`, `${'Indeterminate'.padStart(20)}: 0`];
}

interface Parsed {
  readonly words: readonly string[];
  readonly type?: string;
  readonly legend: boolean;
  readonly error?: string;
}

/** Options that take a value (as getopt: -t MX, -tMX, --type MX, --type=MX), anywhere before or after the verb. */
const WITH_VALUE: Readonly<Record<string, string>> = { '-t': 'type', '--type': 'type', '-i': 'interface', '--interface': 'interface', '-p': 'protocol', '--protocol': 'protocol', '-c': 'class', '--class': 'class', '--legend': 'legend' };
const FLAGS: ReadonlySet<string> = new Set(['-4', '-6', '-h', '--help', '--no-pager', '--raw']);

function parse(args: readonly string[]): Parsed {
  const words: string[] = [];
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '' || !a.startsWith('-') || a === '-') { words.push(a); continue; }
    const [flag = '', inline] = a.startsWith('--') ? a.split(/=(.*)/s) : [a.slice(0, 2), a.length > 2 ? a.slice(2) : undefined];
    const name = WITH_VALUE[flag];
    if (name === undefined) {
      if (FLAGS.has(a)) continue;
      return { words, legend: true, error: a.startsWith('--') ? `unrecognized option '${shown(a)}'` : `invalid option -- '${shown(a.slice(1, 2))}'` };
    }
    const value = inline ?? args[++i];
    if (value === undefined) return { words, legend: true, error: flag.startsWith('--') ? `option '${flag}' requires an argument` : `option requires an argument -- '${flag.slice(1)}'` };
    values[name] = value;
  }
  return { words, type: values.type, legend: !/^(no|false|0)$/i.test(values.legend ?? 'yes') };
}

/** The RR type of -t: one Netfix answers, a real one it has no records of, or a parse error. */
function queryType(text: string | undefined): DnsType | 'empty' | undefined | { error: string } {
  if (text === undefined) return undefined;
  const upper = text.toUpperCase();
  const known = QUERY_TYPES.find((q) => q === upper);
  if (known) return known;
  return EMPTY_TYPES.includes(upper) ? 'empty' : { error: `Failed to parse RR type ${shown(text)}` };
}

function privileged(ctx: Ctx, what: string): boolean {
  if (ctx.cred.uid === 0) return true;
  ctx.err(`Failed to ${what}: Interactive authentication required.\n`);
  return false;
}

/** At most this many names per query (each may try the whole search list). */
const MAX_QUERY_NAMES = 64;

function queryVerb(ctx: Ctx, host: Host, p: Parsed, names: readonly string[]): number {
  const type = queryType(p.type);
  if (typeof type === 'object') { ctx.err(`${type.error}\n`); return 1; }
  if (!names.length) { ctx.err('Too few arguments.\n'); return 1; }
  if (names.length > MAX_QUERY_NAMES) { ctx.err('Too many arguments.\n'); return 1; }
  return query(ctx, host, names, { type, legend: p.legend });
}

function revertVerb(ctx: Ctx, host: Host, name: string | undefined): number {
  if (name === undefined) { ctx.err('Too few arguments.\n'); return 1; }
  const link = findLink(ctx, host, name);
  if (!link || !privileged(ctx, 'revert interface configuration')) return 1;
  revertResolved(host);
  return 0;
}

export function resolvectl(host: Host): CommandFn {
  return (ctx) => {
    const args = ctx.argv.slice(1);
    if (args.includes('-h') || args.includes('--help')) { out(ctx, HELP); return 0; }
    const p = parse(args);
    if (p.error) { ctx.err(`resolvectl: ${p.error}\n`); return 1; }
    const [verb = 'status', ...rest] = p.words;
    switch (verb) {
      case 'status': {
        const link = findLink(ctx, host, rest[0]);
        if (link === null) return 1;
        out(ctx, status(host, link));
        return 0;
      }
      case 'query': return queryVerb(ctx, host, p, rest);
      case 'dns': case 'domain': return perLink(ctx, host, verb, rest);
      case 'revert': return revertVerb(ctx, host, rest[0]);
      case 'flush-caches': return privileged(ctx, 'flush caches') ? 0 : 1;
      case 'reset-server-features': return privileged(ctx, 'reset server features') ? 0 : 1;
      case 'statistics': out(ctx, statistics(host)); return 0;
      default: ctx.err(`Unknown command verb '${shown(verb)}'.\n`); return 1;
    }
  };
}
