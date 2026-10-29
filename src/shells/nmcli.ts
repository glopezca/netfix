/**
 * nmcli (NetworkManager 1.54) once `network-manager` is installed: what the host's interfaces and network settings are,
 * read from the simulated device (NetworkManager as netplan's renderer: profiles netplan-eth0… and lo). Read-only: the
 * configuration is still changed with netplan, ip or the IP tab. Connectivity is checked for real. -t, -f and -g shape
 * the output for scripts, as in nmcli.
 */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { NicInfo } from '../devices/host-nics.ts';
import { hasPackage } from '../net/host-packages.ts';
import { formatIp } from '../core/ip.ts';
import { configuredSearchDomains } from './net-tools.ts';
import { reachMirror } from './apt-net.ts';
import { conName, nmcliOverview, nmMac, routesOf, stateOf } from './nmcli-model.ts';
import type { NicState } from './nmcli-model.ts';

const VERSION = '1.54.0';
const LABEL_WIDTH = 40;
const CONNECTIVITY_URI = 'http://connectivity-check.ubuntu.com';

type Field = readonly [label: string, value: string];
/** What a command prints: a table (header first) or blocks of fields. */
type Output = { readonly table: readonly (readonly string[])[] } | { readonly blocks: readonly (readonly Field[])[] };

const STATE_CODE: Readonly<Record<NicState, string>> = { connected: '100 (connected)', unavailable: '20 (unavailable)', disconnected: '30 (disconnected)' };

/** A stable UUID for a profile of a device (NetworkManager makes one per profile). */
function uuid(seed: string): string {
  let h = 0x811c9dc5;
  const hex = Array.from({ length: 32 }, (_, i) => {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 0x01000193) >>> 0;
    return ((h >>> 4) & 0xf).toString(16);
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function ip4(host: Host, n: NicInfo): Field[] {
  if (n.ip === undefined || stateOf(n) !== 'connected') return [];
  const routes = routesOf(host, n.linux);
  const primary = host.nics()[0]?.linux === n.linux;
  const dns: Field[] = primary && host.config.dns !== undefined ? [['IP4.DNS[1]', formatIp(host.config.dns)]] : [];
  const domains = primary ? configuredSearchDomains(host).map((d, i): Field => [`IP4.DOMAIN[${i + 1}]`, d]) : [];
  return [['IP4.ADDRESS[1]', `${formatIp(n.ip)}/${n.prefix ?? 32}`], ['IP4.GATEWAY', routes.find(([d]) => d === '0.0.0.0/0')?.[1] ?? '--'],
    ...routes.map(([d, via], i): Field => [`IP4.ROUTE[${i + 1}]`, `dst = ${d}, nh = ${via}, mt = 100`]), ...dns, ...domains];
}

function deviceFields(host: Host, n: NicInfo, index: number): Field[] {
  const s = stateOf(n);
  return [['GENERAL.DEVICE', n.linux], ['GENERAL.TYPE', 'ethernet'], ['GENERAL.HWADDR', nmMac(n.mac)], ['GENERAL.MTU', '1500'], ['GENERAL.STATE', STATE_CODE[s]],
    ['GENERAL.CONNECTION', s === 'connected' ? conName(n) : '--'], ['GENERAL.CON-PATH', s === 'connected' ? `/org/freedesktop/NetworkManager/ActiveConnection/${index + 2}` : '--'],
    ['WIRED-PROPERTIES.CARRIER', n.up ? 'on' : 'off'], ...ip4(host, n), ['IP6.GATEWAY', '--']];
}

const LO: readonly Field[] = [['GENERAL.DEVICE', 'lo'], ['GENERAL.TYPE', 'loopback'], ['GENERAL.HWADDR', '00:00:00:00:00:00'], ['GENERAL.MTU', '65536'],
  ['GENERAL.STATE', '100 (connected (externally))'], ['GENERAL.CONNECTION', 'lo'], ['GENERAL.CON-PATH', '/org/freedesktop/NetworkManager/ActiveConnection/1'],
  ['IP4.ADDRESS[1]', '127.0.0.1/8'], ['IP4.GATEWAY', '--'], ['IP6.ADDRESS[1]', '::1/128'], ['IP6.GATEWAY', '--']];

function profileFields(host: Host, n: NicInfo): Field[] {
  const stat = !n.dhcp && n.ip !== undefined;
  const opt = (v: number | undefined): string => (stat && v !== undefined ? formatIp(v) : '--');
  return [['connection.id', conName(n)], ['connection.uuid', uuid(`${host.id}${n.linux}`)], ['connection.type', '802-3-ethernet'], ['connection.interface-name', n.linux],
    ['connection.autoconnect', 'yes'], ['ipv4.method', n.dhcp ? 'auto' : 'manual'], ['ipv4.dns', opt(host.config.dns)],
    ['ipv4.addresses', stat ? `${formatIp(n.ip ?? 0)}/${n.prefix ?? 32}` : '--'], ['ipv4.gateway', opt(host.config.gateway)], ['ipv6.method', 'link-local'],
    ['GENERAL.NAME', conName(n)], ['GENERAL.DEVICES', n.linux], ['GENERAL.STATE', stateOf(n) === 'connected' ? 'activated' : '--'], ...ip4(host, n)];
}

/** `connection show [NAME]`: every profile (with its device when active), or one; null when there is no such profile. */
function connection(host: Host, name: string | undefined): Output | null {
  const nics = host.nics();
  if (name === undefined) {
    const rows = nics.map((n) => [conName(n), uuid(`${host.id}${n.linux}`), 'ethernet', stateOf(n) === 'connected' ? n.linux : '--']);
    return { table: [['NAME', 'UUID', 'TYPE', 'DEVICE'], ...rows, ['lo', uuid(`${host.id}lo`), 'loopback', 'lo']] };
  }
  const n = nics.find((x) => conName(x) === name);
  if (n) return { blocks: [profileFields(host, n)] };
  return name === 'lo' ? { blocks: [[['connection.id', 'lo'], ['connection.type', 'loopback'], ['ipv4.method', 'manual'], ['ipv4.addresses', '127.0.0.1/8'], ...LO]] } : null;
}

function connectivity(host: Host): string {
  const hasIp = host.nics().some((n) => n.ip !== undefined && stateOf(n) === 'connected');
  return !hasIp ? 'none' : reachMirror(host, CONNECTIVITY_URI, '') === undefined ? 'full' : 'limited';
}

function general(host: Host): Output {
  const c = connectivity(host);
  const state = c === 'full' ? 'connected' : c === 'limited' ? 'connected (site only)' : 'disconnected';
  return { table: [['STATE', 'CONNECTIVITY', 'WIFI-HW', 'WIFI', 'WWAN-HW', 'WWAN', 'METERED'], [state, c, 'missing', 'enabled', 'missing', 'enabled', 'no (guessed)']] };
}

interface Shape {
  readonly terse: boolean;
  readonly values: boolean;
  readonly fields?: readonly string[];
}

/** -f NAME,TYPE / -f IP4 keeps those columns or fields; -t drops the header and joins with «:»; -g prints just values. */
function render(out: Output, shape: Shape): string {
  const wanted = (label: string): boolean => {
    const l = label.toUpperCase();
    return !shape.fields || shape.fields.some((f) => l === f || l.startsWith(`${f}.`) || l.startsWith(`${f}[`));
  };
  if ('table' in out) {
    const head = out.table[0] ?? [];
    const cols = head.map((_, i) => i).filter((i) => wanted(head[i] ?? ''));
    const rows = out.table.map((r) => cols.map((i) => r[i] ?? ''));
    if (shape.terse || shape.values) return rows.slice(1).map((r) => r.map((c) => (c === 'ethernet' && head.includes('UUID') ? '802-3-ethernet' : c).replace(/:/g, '\\:')).join(':')).join('\n');
    const widths = cols.map((_, j) => Math.max(...rows.map((r) => (r[j] ?? '').length)) + 2);
    return rows.map((r) => r.map((c, j) => c.padEnd(widths[j] ?? 0)).join('')).join('\n');
  }
  const line = ([label, value]: Field): string => (shape.values ? value : shape.terse ? `${label}:${value}` : `${label}:`.padEnd(LABEL_WIDTH) + value);
  return out.blocks.map((b) => b.filter(([l]) => wanted(l)).map(line).join('\n')).join('\n\n');
}

function shapeOf(args: readonly string[]): Shape {
  const at = args.findIndex((a) => a === '-f' || a === '--fields' || a === '-g' || a === '--get-values');
  const fields = at >= 0 ? (args[at + 1] ?? '').split(',').map((f) => f.trim().toUpperCase()).filter(Boolean) : undefined;
  return { terse: args.includes('-t') || args.includes('--terse'), values: args.includes('-g') || args.includes('--get-values'), ...(fields ? { fields } : {}) };
}

/** Words that are not options, skipping the values of -f/-g. */
function words(args: readonly string[]): string[] {
  const valued = new Set(['-f', '--fields', '-g', '--get-values']);
  return args.filter((a, i) => !a.startsWith('-') && !valued.has(args[i - 1] ?? ''));
}

const OBJECTS = ['general', 'networking', 'radio', 'connection', 'device', 'agent', 'monitor', 'help'] as const;
const pick = (word: string, list: readonly string[]): string | undefined => list.find((o) => o.startsWith(word));

function device(host: Host, sub: string | undefined, name: string | undefined): Output | string {
  const verb = sub === undefined ? 'status' : pick(sub, ['status', 'show']);
  const nics = host.nics();
  if (verb === 'status') return { table: [['DEVICE', 'TYPE', 'STATE', 'CONNECTION'], ...nics.map((n) => [n.linux, 'ethernet', stateOf(n), stateOf(n) === 'connected' ? conName(n) : '--']), ['lo', 'loopback', 'connected (externally)', 'lo']] };
  if (verb !== 'show') return `Error: argument '${sub}' not understood. Try passing --help instead.`;
  const shown = name === undefined ? nics : nics.filter((n) => n.linux === name);
  if (name !== undefined && name !== 'lo' && !shown.length) return `Error: Device '${name}' not found.`;
  return { blocks: [...shown.map((n, i) => deviceFields(host, n, i)), ...(name === undefined || name === 'lo' ? [LO] : [])] };
}

/** The output of a command line, or an error with its exit status. */
function dispatch(host: Host, word: string, sub: string | undefined, name: string | undefined): Output | string | { readonly text: string } {
  const obj = pick(word, OBJECTS);
  if (obj === 'device') return device(host, sub, name);
  if (obj === 'general') return sub === undefined || pick(sub, ['status']) ? general(host) : pick(sub, ['hostname']) ? { text: host.runtimeName() } : `Error: argument '${sub}' not understood. Try passing --help instead.`;
  if (obj === 'networking') return { text: sub !== undefined && pick(sub, ['connectivity']) ? connectivity(host) : 'enabled' };
  if (obj === 'connection' && (sub === undefined || pick(sub, ['show']))) return connection(host, name) ?? `Error: ${name} - no such connection profile.`;
  if (obj === undefined) return `Error: Object '${word}' is unknown, try 'nmcli help'.`;
  return `Error: argument '${sub ?? word}' not understood. Try passing --help instead.`;
}

function run(ctx: Ctx, host: Host): number {
  const args = ctx.argv.slice(1);
  if (args.some((a) => a === '-v' || a === '--version')) return ctx.out(`nmcli tool, version ${VERSION}\n`), 0;
  const [word, sub, name] = words(args);
  if (word === undefined) return ctx.out(`${nmcliOverview(host)}\n`), 0;
  const out = dispatch(host, word, sub, name);
  if (typeof out === 'string') return ctx.err(`${out}\n`), /not found|no such/.test(out) ? 10 : 2;
  const text = 'text' in out ? out.text : render(out, shapeOf(args));
  ctx.out(text ? `${text}\n` : '');
  return 0;
}

/** Without network-manager installed, bash's command-not-found answers instead. */
export function nmcli(host: Host): CommandFn {
  return (ctx) => {
    if (hasPackage(host, 'network-manager')) return run(ctx, host);
    ctx.err("Command 'nmcli' not found, but can be installed with:\nsudo apt install network-manager\n");
    return 127;
  };
}
