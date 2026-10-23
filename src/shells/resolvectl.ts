/**
 * resolvectl (systemd-resolved) in the Linux terminals: status, query, dns, domain, revert, flush-caches,
 * reset-server-features and statistics, as systemd 257 prints them. Changes are runtime state (shells/resolved.ts).
 */
import type { Ctx, CommandFn } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { DnsType } from '../net/packets.ts';
import { searchDomains } from './net-tools.ts';
import { resolvedDns, resolvedDomains, revertResolved, setResolvedDns, setResolvedDomains, transactionCount } from './resolved.ts';
import { QUERY_TYPES, query } from './resolvectl-query.ts';
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
  if (!l) ctx.err(`Failed to resolve interface "${name}": No such device\n`);
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
  if (ctx.cred.uid !== 0) { ctx.err(`Failed to set ${what === 'dns' ? 'DNS' : 'domain'} configuration: Access denied\n`); return 1; }
  if (!link.primary) { ctx.err(`resolvectl: ${t('resolvectl.primaryOnly', { link: links(host).find((l) => l.primary)?.name ?? 'eth0' })}\n`); return 1; }
  return what === 'dns' ? setDns(ctx, host, values) : setDomains(ctx, host, values);
}

function setDns(ctx: Ctx, host: Host, values: readonly string[]): number {
  const bad = values.find((v) => parseIp(v) === null);
  if (bad !== undefined) { ctx.err(`Failed to parse DNS server address: ${bad.slice(0, 64)}\n`); return 1; }
  const first = parseIp(values[0] ?? '') ?? 0;
  if (values.length > 1) ctx.err(`resolvectl: ${t('resolvectl.oneServer', { ip: formatIp(first) })}\n`);
  setResolvedDns(host, first);
  return 0;
}

function setDomains(ctx: Ctx, host: Host, values: readonly string[]): number {
  const bad = values.find((v) => !DOMAIN.test(v));
  if (bad !== undefined) { ctx.err(`Failed to parse domain name: ${bad.slice(0, 64)}\n`); return 1; }
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

/** -t TYPE / --type=TYPE and --legend=no out of the arguments. */
function queryOptions(args: readonly string[]): { type?: DnsType; legend: boolean; names: string[]; bad?: string } {
  let type: string | undefined;
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-t' || a === '--type') type = args[++i];
    else if (a.startsWith('--type=')) type = a.slice(7);
    else if (!a.startsWith('-')) names.push(a);
  }
  const upper = type?.toUpperCase();
  const known = QUERY_TYPES.find((q) => q === upper);
  return { type: known, legend: !args.some((a) => /^--legend=(no|false|0)$/.test(a)), names, bad: type !== undefined && !known ? type : undefined };
}

function privileged(ctx: Ctx, what: string): boolean {
  if (ctx.cred.uid === 0) return true;
  ctx.err(`Failed to ${what}: Access denied\n`);
  return false;
}

export function resolvectl(host: Host): CommandFn {
  return (ctx) => {
    const args = ctx.argv.slice(1);
    if (args.includes('-h') || args.includes('--help')) { out(ctx, HELP); return 0; }
    const verbAt = args.findIndex((a) => !a.startsWith('-'));
    const verb = verbAt < 0 ? 'status' : args[verbAt] ?? 'status';
    const rest = verbAt < 0 ? [] : [...args.slice(0, verbAt), ...args.slice(verbAt + 1)];
    switch (verb) {
      case 'status': {
        const link = findLink(ctx, host, rest.find((a) => !a.startsWith('-')));
        if (link === null) return 1;
        out(ctx, status(host, link));
        return 0;
      }
      case 'query': {
        const o = queryOptions(rest);
        if (o.bad !== undefined) { ctx.err(`Failed to parse RR type ${o.bad.slice(0, 32)}\n`); return 1; }
        if (!o.names.length) { ctx.err('resolvectl query: too few arguments.\n'); return 1; }
        return query(ctx, host, o.names, o);
      }
      case 'dns': case 'domain': return perLink(ctx, host, verb, rest.filter((a) => !a.startsWith('-')));
      case 'revert': {
        const link = findLink(ctx, host, rest[0]);
        if (!link) { if (link === undefined) ctx.err('resolvectl revert: too few arguments.\n'); return 1; }
        if (!privileged(ctx, 'revert interface configuration')) return 1;
        revertResolved(host);
        return 0;
      }
      case 'flush-caches': return privileged(ctx, 'flush caches') ? 0 : 1;
      case 'reset-server-features': return privileged(ctx, 'reset server features') ? 0 : 1;
      case 'statistics': out(ctx, statistics(host)); return 0;
      default: ctx.err(`Unknown command verb '${verb.slice(0, 32)}'.\n`); return 1;
    }
  };
}
