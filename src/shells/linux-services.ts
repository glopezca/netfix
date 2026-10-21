/** systemctl, journalctl and ss for the Linux shell. */
import { runsServices } from '../devices/kinds.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { findUnit, unitActive, openPorts, UNITS } from '../services/units.ts';
import type { UnitInfo } from '../services/units.ts';
import { formatIp } from '../core/ip.ts';

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

function journalLines(server: Server, unit: UnitInfo, limit: number): string[] {
  const host = server.name.toLowerCase();
  return server.journal(unit.id).slice(-limit).map((l) => `${stamp(l.time)} ${host} ${unit.process}[${unit.pid}]: ${l.line}`);
}

function status(server: Server, unit: UnitInfo): string[] {
  const active = unitActive(server.services, unit.id);
  const enabled = server.autostart[unit.id] ? 'enabled' : 'disabled';
  const lines = [
    `${active ? '●' : '○'} ${unit.linux}.service - ${unit.description}`,
    `     Loaded: loaded (/usr/lib/systemd/system/${unit.linux}.service; ${enabled}; preset: enabled)`,
    active ? `     Active: active (${unit.oneshot ? 'exited' : 'running'})` : '     Active: inactive (dead)',
  ];
  if (active && unit.oneshot) lines.push(`    Process: ${unit.pid} ExecStart=/usr/sbin/nft -f /etc/nftables.conf (code=exited, status=0/SUCCESS)`, `   Main PID: ${unit.pid} (code=exited, status=0/SUCCESS)`);
  else if (active) lines.push(`   Main PID: ${unit.pid} (${unit.process})`, `     CGroup: /system.slice/${unit.linux}.service`, `             └─${unit.pid} /usr/sbin/${unit.process}`);
  const log = journalLines(server, unit, STATUS_LOG_LINES);
  return log.length ? [...lines, '', ...log] : lines;
}

function listUnits(server: Server): string[] {
  const rows = UNITS.map((u) => {
    const on = unitActive(server.services, u.id);
    return `  ${`${u.linux}.service`.padEnd(26)} loaded ${on ? `active   ${u.oneshot ? 'exited ' : 'running'}` : 'inactive dead   '} ${u.description}`;
  });
  return ['  UNIT                       LOAD   ACTIVE   SUB     DESCRIPTION', ...rows, '', `${UNITS.length} loaded units listed.`];
}

const NEEDS_ROOT = new Set(['start', 'stop', 'restart', 'reload', 'force-reload', 'enable', 'disable']);

export function systemctl(host: Host, args: string[], root: boolean): string[] {
  const server = asServer(host);
  const verb = args[0] ?? 'list-units';
  if (verb === 'list-units' || verb === 'list-unit-files') return server ? listUnits(server) : ['0 loaded units listed.'];
  const name = args.filter((a) => !a.startsWith('-'))[1];
  if (!name) return [`Too few arguments.`];
  const unit = findUnit(name);
  if (!server || !unit) return verb === 'status' ? [`Unit ${name.replace(/\.service$/, '')}.service could not be found.`] : [`Failed to ${verb} ${name.replace(/\.service$/, '')}.service: Unit ${name.replace(/\.service$/, '')}.service not found.`];
  if (NEEDS_ROOT.has(verb) && !root) return [`Failed to ${verb} ${unit.linux}.service: Interactive authentication required.`, `See system logs and 'systemctl status ${unit.linux}.service' for details. (Prueba con sudo)`];
  return runVerb(server, unit, verb, args.includes('--now'));
}

function jobFailed(unit: UnitInfo): string[] {
  return [`Job for ${unit.linux}.service failed because the control process exited with error code.`, `See "systemctl status ${unit.linux}.service" and "journalctl -xeu ${unit.linux}.service" for details.`];
}

function started(server: Server, unit: UnitInfo): string[] {
  return unitActive(server.services, unit.id) ? [] : jobFailed(unit);
}

function restart(server: Server, unit: UnitInfo): string[] {
  server.setUnit(unit.id, false);
  server.setUnit(unit.id, true);
  return started(server, unit);
}

function runVerb(server: Server, unit: UnitInfo, verb: string, now: boolean): string[] {
  const path = `/etc/systemd/system/multi-user.target.wants/${unit.linux}.service`;
  switch (verb) {
    case 'status': return status(server, unit);
    case 'is-active': return [unitActive(server.services, unit.id) ? 'active' : 'inactive'];
    case 'is-enabled': return [server.autostart[unit.id] ? 'enabled' : 'disabled'];
    case 'start': server.setUnit(unit.id, true); return started(server, unit);
    case 'stop': server.setUnit(unit.id, false); return [];
    case 'reload': case 'force-reload':
      if (unit.id === 'http' && unitActive(server.services, 'http')) return server.reloadWeb() ? jobFailed(unit) : [];
      if (unit.id === 'firewall' && unitActive(server.services, 'firewall')) return server.reloadFirewall() ? jobFailed(unit) : [];
      if (unit.id === 'ssh' && unitActive(server.services, 'ssh')) return server.reloadSsh() ? jobFailed(unit) : [];
      return restart(server, unit);
    case 'restart': return restart(server, unit);
    case 'enable':
      server.autostart = { ...server.autostart, [unit.id]: true };
      if (now) server.setUnit(unit.id, true);
      return [`Created symlink ${path} → /usr/lib/systemd/system/${unit.linux}.service.`];
    case 'disable':
      server.autostart = { ...server.autostart, [unit.id]: false };
      if (now) server.setUnit(unit.id, false);
      return [`Removed "${path}".`];
    default: return [`Unknown command verb '${verb}'.`];
  }
}

export function journalctl(host: Host, args: string[]): string[] {
  const server = asServer(host);
  const uIdx = args.findIndex((a) => a === '-u' || a === '--unit');
  const nIdx = args.indexOf('-n');
  const limit = nIdx >= 0 ? Math.max(1, Number(args[nIdx + 1]) || DEFAULT_JOURNAL_LINES) : DEFAULT_JOURNAL_LINES;
  if (!server) return ['-- No entries --'];
  if (uIdx < 0) {
    const all = server.logs.slice(-limit).map((l) => {
      const u = UNITS.find((x) => x.id === l.unit);
      return `${stamp(l.time)} ${server.name.toLowerCase()} ${u?.process ?? 'systemd'}[${u?.pid ?? 1}]: ${l.line}`;
    });
    return all.length ? all : ['-- No entries --'];
  }
  const unit = findUnit(args[uIdx + 1] ?? '');
  if (!unit) return ['-- No entries --'];
  const lines = journalLines(server, unit, limit);
  return lines.length ? lines : ['-- No entries --'];
}

export function ss(host: Host): string[] {
  const header = 'Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process';
  const server = asServer(host);
  if (!server) return [header];
  const v4 = host.config.ip !== undefined ? '0.0.0.0' : '*';
  return [header, ...openPorts(server.services, { http: server.web.httpPorts(), admin: server.web.adminPorts() }).map((p) => {
    // Apache and the web GUI bind the IPv6 wildcard (dual stack): Ubuntu's ss shows them as *:port, *:*.
    const dual = p.unit.id === 'http';
    const local = dual ? '*' : v4;
    const peer = dual ? '*:*' : '0.0.0.0:*';
    return `${p.proto.padEnd(5)} ${(p.proto === 'udp' ? 'UNCONN' : 'LISTEN').padEnd(6)} 0      ${p.proto === 'udp' ? '0  ' : '511'}    ${`${local}:${p.port}`.padStart(18)}  ${peer.padStart(15)}   users:(("${p.unit.process}",pid=${p.unit.pid},fd=4))`;
  })];
}

export function serverAddress(host: Host): string {
  return host.config.ip !== undefined ? formatIp(host.config.ip) : '0.0.0.0';
}
