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
import { failedTable, status } from './systemctl-status.ts';
import type { UnitRow, UnitView } from './systemctl-status.ts';
import { paintMessage, plain } from './systemd-colors.ts';
import type { Paint } from './systemd-colors.ts';
import type { LogPriority } from '../devices/server.ts';

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

/** A journal entry with its time (to merge a Server's units with those of its packages) and its priority. */
interface Entry { readonly time: number; readonly head: string; readonly line: string; readonly priority?: LogPriority }

/** A line of a Server's journal: who wrote it (systemd[1], apachectl[1123]…), else the unit's own process. */
function serverEntry(host: string, unit: UnitInfo | undefined, l: { readonly time: number; readonly line: string; readonly ident?: string; readonly priority?: LogPriority }): Entry {
  const ident = l.ident ?? (unit ? `${unit.process}[${unit.pid}]` : 'systemd[1]');
  return { time: l.time, head: `${stamp(l.time)} ${host} ${ident}: `, line: l.line, ...(l.priority ? { priority: l.priority } : {}) };
}

function serverEntries(server: Server, unit: UnitInfo): Entry[] {
  const host = server.name.toLowerCase();
  return server.journal(unit.id).map((l) => serverEntry(host, unit, l));
}

function pkgEntries(host: Host, u: PkgUnit): Entry[] {
  const name = host.name.toLowerCase();
  return pkgJournal(host, u).map((l) => ({ time: l.time, head: `${stamp(l.time)} ${name} ${l.systemd ? 'systemd[1]' : `${u.process}[${u.pid}]`}: `, line: l.line }));
}

/** The last entries as journalctl prints them: only the message takes its priority's colour. */
const texts = (entries: readonly Entry[], limit: number, p: Paint): string[] =>
  entries.slice(-limit).map((e) => `${e.head}${paintMessage(p, e.line, e.priority)}`);

/** active, failed (a start that failed, until a good start or reset-failed) or inactive. */
function unitState(server: Server, id: UnitId): UnitRow['active'] {
  if (unitActive(server.services, id)) return 'active';
  return server.failed[id] ? 'failed' : 'inactive';
}

function serverView(server: Server, unit: UnitInfo, p: Paint): UnitView {
  const log = texts(serverEntries(server, unit), STATUS_LOG_LINES, p);
  const failed = server.failed[unit.id];
  return { ...unit, oneshot: unit.oneshot ?? false, active: unitActive(server.services, unit.id), enabled: server.autostart[unit.id] ?? false, log, now: server.clock.now(), ...(failed ? { failed } : {}) };
}

function pkgView(host: Host, u: PkgUnit, p: Paint): UnitView {
  return { ...u, linux: u.name, ...pkgUnitState(host, u), log: texts(pkgEntries(host, u), STATUS_LOG_LINES, p), now: host.clock.now() };
}

const SUB: Readonly<Record<UnitRow['active'], string>> = { active: 'running', failed: 'failed ', inactive: 'dead   ' };

/** A row of `systemctl list-units`: a failed unit has a ● and its cells red, except LOAD. */
function unitRow(r: UnitRow, p: Paint): string {
  const sub = r.active === 'active' && r.oneshot ? 'exited ' : SUB[r.active];
  const red = r.active === 'failed' ? (t: string): string => p(t, 'red') : (t: string): string => t;
  return `${r.active === 'failed' ? red('●') : ' '} ${red(`${r.name}.service`.padEnd(26))} loaded ${red(r.active.padEnd(8))} ${red(sub)} ${red(r.description)}`;
}

function unitRows(host: Host): UnitRow[] {
  const server = asServer(host);
  return [
    ...(server ? UNITS.map((u) => ({ name: u.linux, active: unitState(server, u.id), oneshot: u.oneshot ?? false, description: u.description })) : []),
    ...installedUnits(host).map((u) => ({ name: u.name, active: pkgUnitState(host, u).active ? 'active' as const : 'inactive' as const, oneshot: u.oneshot, description: u.description })),
  ];
}

/** `systemctl list-units`, or only the failed ones (`--failed`, `--state=failed`). */
function listUnits(host: Host, args: readonly string[], p: Paint): string[] {
  const rows = unitRows(host);
  if (args.includes('--failed') || args.includes('--state=failed')) return failedTable(rows.filter((r) => r.active === 'failed'), p);
  if (!rows.length) return ['0 loaded units listed.'];
  return [p('  UNIT                       LOAD   ACTIVE   SUB     DESCRIPTION', 'underline'), ...rows.map((r) => unitRow(r, p)), '', `${rows.length} loaded units listed.`];
}

const NEEDS_ROOT = new Set(['start', 'stop', 'restart', 'try-restart', 'reload', 'force-reload', 'reload-or-restart', 'try-reload-or-restart', 'enable', 'disable']);

function notFound(verb: string, name: string): string[] {
  const unit = `${name.replace(/\.service$/, '')}.service`;
  if (verb === 'reset-failed') return [`Failed to reset failed state of unit ${unit}: Unit ${unit} not loaded.`];
  return verb === 'status' ? [`Unit ${unit} could not be found.`] : [`Failed to ${verb} ${unit}: Unit ${unit} not found.`];
}

const AUTH = 'Interactive authentication required.';

/** `systemctl reset-failed [unit]` (root only): the failed units become inactive. */
function resetFailed(host: Host, name: string | undefined, root: boolean): string[] {
  if (name === undefined) {
    if (!root) return [`Failed to reset failed state: ${AUTH}`];
    asServer(host)?.resetFailed();
    return [];
  }
  const server = asServer(host);
  const unit = server ? findUnit(name) : undefined;
  const linux = unit?.linux ?? findPkgUnit(host, name)?.name;
  if (linux === undefined) return notFound('reset-failed', name);
  if (!root) return [`Failed to reset failed state of unit ${linux}.service: ${AUTH}`];
  if (server && unit) server.resetFailed(unit.id);
  return [];
}

/** systemctl; `p` paints its output as systemd does on a terminal. */
export function systemctl(host: Host, args: string[], root: boolean, p: Paint = plain): string[] {
  const server = asServer(host);
  const positional = args.filter((a) => !a.startsWith('-'));
  const verb = positional[0] ?? 'list-units';
  if (verb === 'list-units' || verb === 'list-unit-files') return listUnits(host, args, p);
  const name = positional[1];
  if (verb === 'reset-failed') return resetFailed(host, name, root);
  if (!name) return [`Too few arguments.`];
  const unit = server ? findUnit(name) : undefined;
  const pkg = unit ? undefined : findPkgUnit(host, name);
  const linux = unit?.linux ?? pkg?.name;
  if (linux === undefined) return notFound(verb, name);
  if (NEEDS_ROOT.has(verb) && !root) return [`Failed to ${verb} ${linux}.service: ${AUTH}`, `See system logs and 'systemctl status ${linux}.service' for details. (Prueba con sudo)`];
  const alias = unit?.alias;
  if ((verb === 'enable' || verb === 'disable') && alias !== undefined && name.toLowerCase().replace(/\.service$/, '') === alias) return [`Failed to ${verb} unit: Refusing to operate on alias name or linked unit file: ${alias}.service`];
  const now = args.includes('--now');
  if (verb === 'status') return server && unit ? status(serverView(server, unit, p), p) : status(pkgView(host, pkg as PkgUnit, p), p);
  return server && unit ? runVerb(server, unit, verb, now) : runPkgVerb(host, pkg as PkgUnit, verb, now);
}

function jobFailed(linux: string): string[] {
  return [`Job for ${linux}.service failed because the control process exited with error code.`, `See "systemctl status ${linux}.service" and "journalctl -xeu ${linux}.service" for details.`];
}

const wantsPath = (linux: string): string => `/etc/systemd/system/multi-user.target.wants/${linux}.service`;
const created = (linux: string): string => `Created symlink ${wantsPath(linux)} → /usr/lib/systemd/system/${linux}.service.`;
const removed = (linux: string): string => `Removed "${wantsPath(linux)}".`;

/** A Type=simple unit's start job succeeds once its process runs, even if it then exits (journal and status say why). */
function started(server: Server, unit: UnitInfo): string[] {
  return unit.simple || unitActive(server.services, unit.id) ? [] : jobFailed(unit.linux);
}

function restart(server: Server, unit: UnitInfo): string[] {
  server.setUnit(unit.id, false);
  server.setUnit(unit.id, true);
  return started(server, unit);
}

/** reload: ExecReload of a running unit (a failure keeps what runs); otherwise a restart. */
function reload(server: Server, unit: UnitInfo): string[] {
  const on = unitActive(server.services, unit.id);
  if (on && unit.id === 'http') return server.reloadWeb() ? jobFailed(unit.linux) : [];
  if (on && unit.id === 'firewall') return server.reloadFirewall() ? jobFailed(unit.linux) : [];
  if (on && unit.id === 'ssh') return server.reloadSsh() ? jobFailed(unit.linux) : [];
  if (on && unit.id === 'dns') return server.reloadDns() ? jobFailed(unit.linux) : [];
  return restart(server, unit);
}

/** A unit without ExecReload (Kea): systemd refuses the reload job. */
const notApplicable = (u: UnitInfo): string[] => [`Failed to reload ${u.linux}.service: Job type reload is not applicable for unit ${u.linux}.service.`];

/** reload-or-restart: the unit's reload when it has one, a restart otherwise. */
const reloadOrRestart = (server: Server, unit: UnitInfo): string[] => (unit.noReload ? restart(server, unit) : reload(server, unit));

function runVerb(server: Server, unit: UnitInfo, verb: string, now: boolean): string[] {
  const on = unitActive(server.services, unit.id);
  switch (verb) {
    case 'is-active': case 'is-failed': return [unitState(server, unit.id)];
    case 'is-enabled': return [server.autostart[unit.id] ? 'enabled' : 'disabled'];
    case 'start': server.setUnit(unit.id, true); return started(server, unit);
    case 'stop': server.setUnit(unit.id, false); return [];
    case 'reload': return unit.noReload ? notApplicable(unit) : reload(server, unit);
    case 'reload-or-restart': return reloadOrRestart(server, unit);
    // force-reload is try-reload-or-restart: nothing happens to a unit that is not running.
    case 'force-reload': case 'try-reload-or-restart': return on ? reloadOrRestart(server, unit) : [];
    case 'try-restart': return on ? restart(server, unit) : [];
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
    case 'is-active': case 'is-failed': return [s.active ? 'active' : 'inactive'];
    case 'is-enabled': return [s.enabled ? 'enabled' : 'disabled'];
    case 'start': return startOrFail(host, u);
    case 'stop': stopPkgUnit(host, u); return [];
    case 'restart': stopPkgUnit(host, u); return startOrFail(host, u);
    case 'reload': case 'force-reload': return reloadPkgUnit(host, u);
    case 'reload-or-restart': return s.active ? reloadPkgUnit(host, u) : startOrFail(host, u);
    case 'try-reload-or-restart': return s.active ? reloadPkgUnit(host, u) : [];
    case 'try-restart': if (!s.active) return []; stopPkgUnit(host, u); return startOrFail(host, u);
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
  const name = host.name.toLowerCase();
  const own = server ? server.logs.map((l) => serverEntry(name, UNITS.find((x) => x.id === l.unit), l)) : [];
  return [...own, ...installedUnits(host).flatMap((u) => pkgEntries(host, u))].sort((a, b) => a.time - b.time);
}

/** journalctl; `p` paints each message by its priority, as on a terminal. */
export function journalctl(host: Host, args: string[], p: Paint = plain): string[] {
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
  const lines = texts(entries, limit, p);
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
