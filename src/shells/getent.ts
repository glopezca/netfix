/**
 * getent (glibc): the hosts, ahosts, ahostsv4, ahostsv6, passwd and group databases as any program sees them, the
 * hosts ones through /etc/nsswitch.conf (net-tools.ts resolveHost: files, resolve, mdns, wins, dns…). Exit 0 when
 * every key was found, 2 when one was not, 1 for a database or argument error, 64 for a bad option (argp).
 */
import type { Ctx, CommandFn } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { peekHostFile } from '../devices/host-fs.ts';
import { reverseName } from '../net/dns.ts';
import { formatIp, parseIp } from '../core/ip.ts';
import { t } from '../i18n/t.ts';
import { dnsQuery, hostsEntries, hostsEntry } from './dns-client.ts';
import type { HostsEntry } from './dns-client.ts';
import { resolveHost } from './net-tools.ts';
import { hostsSources } from './nsswitch.ts';
import { shown } from './resolvectl-query.ts';

const TRY = "Try `getent --help' or `getent --usage' for more information.";
const HELP = ['Usage: getent [OPTION...] database [key ...]', 'Get entries from administrative database.', '',
  '  -A, --no-addrconfig        do not filter out unsupported IPv4/IPv6 addresses', '                             (with ahosts*)',
  '  -i, --no-idn               disable IDN encoding', '  -s, --service=CONFIG       Service configuration to be used',
  '  -?, --help                 Give this help list', '      --usage                Give a short usage message', '',
  'Mandatory or optional arguments to long options are also mandatory or optional', 'for any corresponding short options.', '',
  'Supported databases:', 'ahosts ahostsv4 ahostsv6 aliases ethers group gshadow hosts initgroups', 'netgroup networks passwd protocols rpc services shadow'];
const USAGE = 'Usage: getent [-iA?] [-s CONFIG] [--no-idn] [--no-addrconfig] [--service=CONFIG] [--help] [--usage] database [key ...]';
const UNSIMULATED: ReadonlySet<string> = new Set(['aliases', 'ethers', 'gshadow', 'initgroups', 'netgroup', 'networks', 'protocols', 'rpc', 'services', 'shadow']);
const ADDRESS_COLUMN = 15;
const SOCKET_COLUMN = 6;
const NOT_FOUND = 2;
const USAGE_ERROR = 64;
/** Each key may wait for the network: at most this many per run. */
const MAX_KEYS = 64;

/** The lines one key prints, or undefined when the database does not have it. */
type Lookup = (key: string) => readonly string[] | undefined;

interface Database {
  readonly lookup: Lookup;
  /** Without a key: the whole database (only what can be enumerated: the files). */
  readonly all: () => readonly string[];
}

const hostsLine = (e: HostsEntry): string => `${formatIp(e.ip).padEnd(ADDRESS_COLUMN)} ${e.names.join(' ')}`;

/** gethostbyaddr: /etc/hosts, then the PTR record when «hosts:» has a resolver. */
function byAddress(host: Host, ip: number): HostsEntry | undefined {
  const local = hostsEntries(host).find((e) => e.ip === ip);
  if (local) return local;
  if (!hostsSources(host).some((s) => s.source === 'dns' || s.source === 'resolve')) return undefined;
  const r = dnsQuery(host, reverseName(ip), 'PTR');
  const name = r.kind === 'answer' ? r.msg.answers?.find((a) => a.type === 'PTR')?.data.replace(/\.$/, '') : undefined;
  return name ? { ip, names: [name] } : undefined;
}

/** gethostbyname: the /etc/hosts line (with its aliases), then the rest of «hosts:». */
function byName(host: Host, key: string): HostsEntry | undefined {
  const local = hostsEntry(host, key);
  if (local) return local;
  const r = resolveHost(host, key, 'linux');
  return r.kind === 'ip' ? { ip: r.ip, names: [r.name] } : undefined;
}

/** getaddrinfo with AI_CANONNAME: one line per socket type, the canonical name on the first (a literal is itself). */
function addrinfo(host: Host, key: string, v6: boolean): string[] | undefined {
  const literal = parseIp(key);
  const e = literal !== null ? { ip: literal, names: [key] } : byName(host, key);
  if (!e) return undefined;
  const addr = (v6 ? `::ffff:${formatIp(e.ip)}` : formatIp(e.ip)).padEnd(ADDRESS_COLUMN);
  return [['STREAM', e.names[0] ?? key], ['DGRAM', ''], ['RAW', '']].map(([kind = '', name]) => `${addr} ${kind.padEnd(SOCKET_COLUMN)} ${name}`);
}

/** passwd and group: by name, or by number when the key is all digits (getpwuid, getgrgid). */
function fileDatabase(host: Host, path: string): Database {
  const rows = (): string[] => (peekHostFile(host, path) ?? '').split('\n').filter((r) => r !== '');
  return {
    lookup: (key) => {
      const row = rows().find((r) => (/^\d+$/.test(key) ? r.split(':')[2] === key : r.split(':')[0] === key));
      return row === undefined ? undefined : [row];
    },
    all: rows,
  };
}

function database(host: Host, name: string): Database | undefined {
  const all = (): string[] => hostsEntries(host).map(hostsLine);
  const one = (f: (key: string) => readonly string[] | undefined): Database => ({ lookup: f, all });
  switch (name) {
    case 'hosts': return one((key) => {
      const ip = parseIp(key);
      const e = ip !== null ? byAddress(host, ip) : byName(host, key);
      return e ? [hostsLine(e)] : undefined;
    });
    case 'ahosts': case 'ahostsv4': return one((key) => addrinfo(host, key, false));
    case 'ahostsv6': return one((key) => addrinfo(host, key, true));
    case 'passwd': return fileDatabase(host, '/etc/passwd');
    case 'group': return fileDatabase(host, '/etc/group');
    default: return undefined;
  }
}

type Parsed = { readonly words: readonly string[] } | { readonly exit: number };

/** argp: -A, -i, -s CONFIG (Netfix has one NSS configuration), --help, --usage; `--` ends the options. */
function parse(ctx: Ctx, args: readonly string[]): Parsed {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { words.push(...args.slice(i + 1)); break; }
    if (!a.startsWith('-') || a === '-') { words.push(a); continue; }
    if (a === '--help' || a === '-?') { ctx.out(`${HELP.join('\n')}\n`); return { exit: 0 }; }
    if (a === '--usage') { ctx.out(`${USAGE}\n`); return { exit: 0 }; }
    if (a === '-s' || a === '--service') { i++; continue; }
    if (['-A', '-i', '--no-addrconfig', '--no-idn'].includes(a) || a.startsWith('--service=') || /^-s./.test(a)) continue;
    ctx.err(`getent: ${a.startsWith('--') ? `unrecognized option '${shown(a)}'` : `invalid option -- '${shown(a.slice(1, 2))}'`}\n${TRY}\n`);
    return { exit: USAGE_ERROR };
  }
  return { words };
}

const print = (ctx: Ctx, lines: readonly string[]): void => { if (lines.length) ctx.out(`${lines.join('\n')}\n`); };

export function getent(host: Host): CommandFn {
  return (ctx) => {
    const p = parse(ctx, ctx.argv.slice(1));
    if ('exit' in p) return p.exit;
    const [name, ...keys] = p.words;
    if (name === undefined) { ctx.err(`getent: wrong number of arguments\n${TRY}\n`); return 1; }
    if (UNSIMULATED.has(name)) { ctx.err(`getent: ${t('getent.unsimulated', { db: name })}\n`); return 1; }
    const db = database(host, name);
    if (!db) { ctx.err(`Unknown database: ${shown(name)}\n${TRY}\n`); return 1; }
    if (!keys.length) { print(ctx, db.all()); return 0; }
    if (keys.length > MAX_KEYS) ctx.err(`getent: ${t('getent.tooMany', { max: String(MAX_KEYS) })}\n`);
    let status = 0;
    for (const key of keys.slice(0, MAX_KEYS)) {
      const lines = db.lookup(key);
      if (lines) print(ctx, lines);
      else status = NOT_FOUND;
    }
    return keys.length > MAX_KEYS ? NOT_FOUND : status;
  };
}
