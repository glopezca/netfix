/** systemctl, journalctl and ss for the Linux shell. */
import { dnsListenAddresses, listenChoices } from '../services/listen.ts';
import { runsServices } from '../devices/kinds.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { findUnit, unitActive, openPorts, UNITS } from '../services/units.ts';
import type { UnitId, UnitInfo } from '../services/units.ts';
import { formatIp } from '../core/ip.ts';
import { findPkgUnit, installedUnits, pkgJournal, pkgUnitState, setPkgUnitState } from '../net/pkg-units.ts';
import type { PkgUnit } from '../net/pkg-units.ts';
import { reloadPkgUnit, startPkgUnit, stopPkgUnit } from './pkg-service.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_LOG_LINES = 5;
const DEFAULT_JOURNAL_LINES = 50;

function asServer(host: Host): Server | undefined {
  return runsServices(host.kind) ? (host as Server) : undefined;
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** A journal entry with its time (to merge a Server's units with those of its packages). */
interface Entry { readonly time: number; readonly text: string }

function serverEntries(server: Server, unit: UnitInfo): Entry[] {
  const host = server.name.toLowerCase();
  return server.journal(unit.id).map((l) => ({ time: l.time, text: `${stamp(l.time)} ${host} ${unit.process}[${unit.pid}]: ${l.line}` }));
}

function pkgEntries(host: Host, u: PkgUnit): Entry[] {
  const name = host.name.toLowerCase();
  return pkgJournal(host, u).map((l) => ({ time: l.time, text: `${stamp(l.time)} ${name} ${l.systemd ? 'systemd[1]' : `${u.process}[${u.pid}]`}: ${l.line}` }));
}

const texts = (entries: readonly Entry[], limit: number): string[] => entries.slice(-limit).map((e) => e.text);

/** What `systemctl status` shows of a unit, a Server's own or a package's. */
interface UnitView {
  readonly linux: string;
  readonly description: string;
  readonly process: string;
  readonly pid: number;
  readonly path?: string;
  readonly oneshot: boolean;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly log: readonly string[];
}

const COMM_LEN = 15;

function status(v: UnitView): string[] {
  const lines = [
    `${v.active ? '●' : '○'} ${v.linux}.service - ${v.description}`,
    `     Loaded: loaded (/usr/lib/systemd/system/${v.linux}.service; ${v.enabled ? 'enabled' : 'disabled'}; preset: enabled)`,
    v.active ? `     Active: active (${v.oneshot ? 'exited' : 'running'})` : '     Active: inactive (dead)',
  ];
  if (v.active && v.oneshot) lines.push(`    Process: ${v.pid} ExecStart=/usr/sbin/nft -f /etc/nftables.conf (code=exited, status=0/SUCCESS)`, `   Main PID: ${v.pid} (code=exited, status=0/SUCCESS)`);
  // The kernel keeps 15 characters of a process name (TASK_COMM_LEN): systemd-resolved is «systemd-resolve».
  else if (v.active) lines.push(`   Main PID: ${v.pid} (${v.process.slice(0, COMM_LEN)})`, `     CGroup: /system.slice/${v.linux}.service`, `             └─${v.pid} ${v.path ?? `/usr/sbin/${v.process}`}`);
  return v.log.length ? [...lines, '', ...v.log] : lines;
}

function serverView(server: Server, unit: UnitInfo): UnitView {
  const log = texts(serverEntries(server, unit), STATUS_LOG_LINES);
  return { ...unit, oneshot: unit.oneshot ?? false, active: unitActive(server.services, unit.id), enabled: server.autostart[unit.id] ?? false, log };
}

function pkgView(host: Host, u: PkgUnit): UnitView {
  return { ...u, linux: u.name, ...pkgUnitState(host, u), log: texts(pkgEntries(host, u), STATUS_LOG_LINES) };
}

function unitRow(name: string, on: boolean, oneshot: boolean, description: string): string {
  return `  ${`${name}.service`.padEnd(26)} loaded ${on ? `active   ${oneshot ? 'exited ' : 'running'}` : 'inactive dead   '} ${description}`;
}

function listUnits(host: Host): string[] {
  const server = asServer(host);
  const rows = [
    ...(server ? UNITS.map((u) => unitRow(u.linux, unitActive(server.services, u.id), u.oneshot ?? false, u.description)) : []),
    ...installedUnits(host).map((u) => unitRow(u.name, pkgUnitState(host, u).active, u.oneshot, u.description)),
  ];
  if (!rows.length) return ['0 loaded units listed.'];
  return ['  UNIT                       LOAD   ACTIVE   SUB     DESCRIPTION', ...rows, '', `${rows.length} loaded units listed.`];
}

const NEEDS_ROOT = new Set(['start', 'stop', 'restart', 'reload', 'force-reload', 'enable', 'disable']);

function notFound(verb: string, name: string): string[] {
  const unit = `${name.replace(/\.service$/, '')}.service`;
  return verb === 'status' ? [`Unit ${unit} could not be found.`] : [`Failed to ${verb} ${unit}: Unit ${unit} not found.`];
}

export function systemctl(host: Host, args: string[], root: boolean): string[] {
  const server = asServer(host);
  const verb = args[0] ?? 'list-units';
  if (verb === 'list-units' || verb === 'list-unit-files') return listUnits(host);
  const name = args.filter((a) => !a.startsWith('-'))[1];
  if (!name) return [`Too few arguments.`];
  const unit = server ? findUnit(name) : undefined;
  const pkg = unit ? undefined : findPkgUnit(host, name);
  const linux = unit?.linux ?? pkg?.name;
  if (linux === undefined) return notFound(verb, name);
  if (NEEDS_ROOT.has(verb) && !root) return [`Failed to ${verb} ${linux}.service: Interactive authentication required.`, `See system logs and 'systemctl status ${linux}.service' for details. (Prueba con sudo)`];
  const now = args.includes('--now');
  return server && unit ? runVerb(server, unit, verb, now) : runPkgVerb(host, pkg as PkgUnit, verb, now);
}

function jobFailed(linux: string): string[] {
  return [`Job for ${linux}.service failed because the control process exited with error code.`, `See "systemctl status ${linux}.service" and "journalctl -xeu ${linux}.service" for details.`];
}

const wantsPath = (linux: string): string => `/etc/systemd/system/multi-user.target.wants/${linux}.service`;
const created = (linux: string): string => `Created symlink ${wantsPath(linux)} → /usr/lib/systemd/system/${linux}.service.`;
const removed = (linux: string): string => `Removed "${wantsPath(linux)}".`;

function started(server: Server, unit: UnitInfo): string[] {
  return unitActive(server.services, unit.id) ? [] : jobFailed(unit.linux);
}

function restart(server: Server, unit: UnitInfo): string[] {
  server.setUnit(unit.id, false);
  server.setUnit(unit.id, true);
  return started(server, unit);
}

function runVerb(server: Server, unit: UnitInfo, verb: string, now: boolean): string[] {
  switch (verb) {
    case 'status': return status(serverView(server, unit));
    case 'is-active': return [unitActive(server.services, unit.id) ? 'active' : 'inactive'];
    case 'is-enabled': return [server.autostart[unit.id] ? 'enabled' : 'disabled'];
    case 'start': server.setUnit(unit.id, true); return started(server, unit);
    case 'stop': server.setUnit(unit.id, false); return [];
    case 'reload': case 'force-reload':
      if (unit.id === 'http' && unitActive(server.services, 'http')) return server.reloadWeb() ? jobFailed(unit.linux) : [];
      if (unit.id === 'firewall' && unitActive(server.services, 'firewall')) return server.reloadFirewall() ? jobFailed(unit.linux) : [];
      if (unit.id === 'ssh' && unitActive(server.services, 'ssh')) return server.reloadSsh() ? jobFailed(unit.linux) : [];
      return restart(server, unit);
    case 'restart': return restart(server, unit);
    case 'enable':
      server.autostart = { ...server.autostart, [unit.id]: true };
      if (now) server.setUnit(unit.id, true);
      return [created(unit.linux)];
    case 'disable':
      server.autostart = { ...server.autostart, [unit.id]: false };
      if (now) server.setUnit(unit.id, false);
      return [removed(unit.linux)];
    default: return [`Unknown command verb '${verb}'.`];
  }
}

const startOrFail = (host: Host, u: PkgUnit): string[] => (startPkgUnit(host, u) ? [] : jobFailed(u.name));

/** The verbs on a unit a package brought (samba's smbd and nmbd, nftables on a PC). */
function runPkgVerb(host: Host, u: PkgUnit, verb: string, now: boolean): string[] {
  const s = pkgUnitState(host, u);
  switch (verb) {
    case 'status': return status(pkgView(host, u));
    case 'is-active': return [s.active ? 'active' : 'inactive'];
    case 'is-enabled': return [s.enabled ? 'enabled' : 'disabled'];
    case 'start': return startOrFail(host, u);
    case 'stop': stopPkgUnit(host, u); return [];
    case 'restart': stopPkgUnit(host, u); return startOrFail(host, u);
    case 'reload': case 'force-reload': return reloadPkgUnit(host, u);
    case 'enable': {
      setPkgUnitState(host, u, { enabled: true });
      const link = s.enabled ? [] : [created(u.name)];
      return now ? [...link, ...startOrFail(host, u)] : link;
    }
    case 'disable':
      setPkgUnitState(host, u, { enabled: false });
      if (now) stopPkgUnit(host, u);
      return s.enabled ? [removed(u.name)] : [];
    default: return [`Unknown command verb '${verb}'.`];
  }
}

/** Every journal entry of the host: its own units (a Server) and those of its packages, in time order. */
function allEntries(host: Host): Entry[] {
  const server = asServer(host);
  const own: Entry[] = server ? server.logs.map((l) => {
    const u = UNITS.find((x) => x.id === l.unit);
    return { time: l.time, text: `${stamp(l.time)} ${server.name.toLowerCase()} ${u?.process ?? 'systemd'}[${u?.pid ?? 1}]: ${l.line}` };
  }) : [];
  return [...own, ...installedUnits(host).flatMap((u) => pkgEntries(host, u))].sort((a, b) => a.time - b.time);
}

export function journalctl(host: Host, args: string[]): string[] {
  const server = asServer(host);
  const uIdx = args.findIndex((a) => a === '-u' || a === '--unit');
  const nIdx = args.indexOf('-n');
  const limit = nIdx >= 0 ? Math.max(1, Number(args[nIdx + 1]) || DEFAULT_JOURNAL_LINES) : DEFAULT_JOURNAL_LINES;
  const name = uIdx < 0 ? undefined : args[uIdx + 1] ?? '';
  const unit = name !== undefined && server ? findUnit(name) : undefined;
  const pkg = name !== undefined && !unit ? findPkgUnit(host, name) : undefined;
  let entries: Entry[] = [];
  if (name === undefined) entries = allEntries(host);
  else if (server && unit) entries = serverEntries(server, unit);
  else if (pkg) entries = pkgEntries(host, pkg);
  const lines = texts(entries, limit);
  return lines.length ? lines : ['-- No entries --'];
}

/** Local addresses a UDP service binds: named per listen-on address, Kea per interface; undefined = wildcard. */
function boundAddresses(server: Server, unit: UnitId): string[] | undefined {
  const s = server.services;
  if (unit === 'dns') return dnsListenAddresses(s.dns, listenChoices(server, true))?.map(formatIp);
  if (unit !== 'dhcp' || s.dhcp.interfaces === undefined) return undefined;
  const chosen = listenChoices(server, false).filter((c) => s.dhcp.interfaces?.includes(c.name));
  return chosen.map((c) => (c.ip !== undefined ? formatIp(c.ip) : `0.0.0.0%${c.name}`));
}

export interface SsOptions {
  readonly tcp: boolean;
  readonly udp: boolean;
  readonly listening: boolean;
  readonly all: boolean;
  readonly processes: boolean;
}

/** `ss -tulpn` and friends: the letters of every short option (ss -t -l and ss -tl are the same). */
export function ssOptions(argv: readonly string[]): SsOptions {
  const long: Readonly<Record<string, string>> = { '--tcp': 't', '--udp': 'u', '--listening': 'l', '--all': 'a', '--processes': 'p', '--numeric': 'n' };
  const letters = argv.map((a) => long[a] ?? (/^-[a-zA-Z0-9]+$/.test(a) ? a.slice(1) : '')).join('');
  const has = (c: string): boolean => letters.includes(c);
  return { tcp: has('t'), udp: has('u'), listening: has('l'), all: has('a'), processes: has('p') };
}

/**
 * Sockets as iproute2's ss shows them. Netfix only knows the listening ones (no established connections are
 * listed): without -l or -a only the header is left. The Netid column appears when more than one socket type is
 * shown; the process only with -p.
 */
export function ss(host: Host, o: SsOptions = { tcp: true, udp: true, listening: true, all: false, processes: true }): string[] {
  const types = o.tcp || o.udp ? { tcp: o.tcp, udp: o.udp } : { tcp: true, udp: true };
  const netid = types.tcp && types.udp;
  const header = `${netid ? 'Netid ' : ''}State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process`;
  const server = asServer(host);
  if (!server || !(o.listening || o.all)) return [header];
  const v4 = host.config.ip !== undefined ? '0.0.0.0' : '*';
  const ports = openPorts(server.services, { http: server.web.httpPorts(), admin: server.web.adminPorts() }).filter((p) => types[p.proto]);
  return [header, ...ports.flatMap((p) => {
    // Apache and the web GUI bind the IPv6 wildcard (dual stack): Ubuntu's ss shows them as *:port, *:*.
    const dual = p.unit.id === 'http';
    const locals = (p.proto === 'udp' ? boundAddresses(server, p.unit.id) : undefined) ?? [dual ? '*' : v4];
    const peer = dual ? '*:*' : '0.0.0.0:*';
    const proc = o.processes ? `   users:(("${p.unit.process}",pid=${p.unit.pid},fd=4))` : '';
    return locals.map((local) => `${netid ? `${p.proto.padEnd(5)} ` : ''}${(p.proto === 'udp' ? 'UNCONN' : 'LISTEN').padEnd(6)} 0      ${p.proto === 'udp' ? '0  ' : '511'}    ${`${local}:${p.port}`.padStart(18)}  ${peer.padStart(15)}${proc}`);
  })];
}

export function serverAddress(host: Host): string {
  return host.config.ip !== undefined ? formatIp(host.config.ip) : '0.0.0.0';
}
