/** sc and net start / net stop: the services of a Windows Server (the same units GNU/Linux runs with systemctl). */
import { runsServices } from '../devices/kinds.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { findUnit, unitActive, UNITS } from '../services/units.ts';

export function serverOf(host: Host): Server | undefined {
  return runsServices(host.kind) ? (host as Server) : undefined;
}

function scBlock(s: Server, name: string): string[] {
  const unit = findUnit(name);
  if (!unit) return [];
  const on = unitActive(s.services, unit.id);
  return ['', `SERVICE_NAME: ${unit.windows}`, '        TYPE               : 10  WIN32_OWN_PROCESS', `        STATE              : ${on ? '4  RUNNING' : '1  STOPPED'}`, '        WIN32_EXIT_CODE    : 0  (0x0)'];
}

export function sc(host: Host, args: readonly string[]): string[] {
  const verb = (args[0] ?? '').toLowerCase();
  const s = serverOf(host);
  const unit = args[1] ? findUnit(args[1]) : undefined;
  if (verb === 'query' && !args[1]) return s ? UNITS.flatMap((u) => scBlock(s, u.windows)) : [];
  if (!s || !unit) return [`[SC] OpenService FAILED 1060:`, '', 'The specified service does not exist as an installed service.', ''];
  if (verb === 'query') return scBlock(s, unit.windows);
  if (verb !== 'start' && verb !== 'stop') return ['DESCRIPTION:', '        SC is a command line program used for communicating with the Service Control Manager.'];
  const running = unitActive(s.services, unit.id);
  if (verb === 'start' && running) return ['[SC] StartService FAILED 1056:', '', 'An instance of the service is already running.', ''];
  if (verb === 'stop' && !running) return ['[SC] ControlService FAILED 1062:', '', 'The service has not been started.', ''];
  s.setUnit(unit.id, verb === 'start');
  return scBlock(s, unit.windows);
}

export function netService(host: Host, args: readonly string[]): string[] {
  const verb = (args[0] ?? '').toLowerCase();
  const s = serverOf(host);
  if (verb !== 'start' && verb !== 'stop') return ['The syntax of this command is:', '', 'NET [ SHARE | START | STOP | USE | VIEW ]'];
  if (verb === 'start' && !args[1]) return ['These Windows services are started:', '', ...(s ? UNITS.filter((u) => unitActive(s.services, u.id)).map((u) => `   ${u.windowsDisplay}`) : []), '', 'The command completed successfully.'];
  const unit = args[1] ? findUnit(args.slice(1).join(' ')) : undefined;
  if (!s || !unit) return ['The service name is invalid.', '', 'More help is available by typing NET HELPMSG 2185.'];
  const running = unitActive(s.services, unit.id);
  if ((verb === 'start') === running) return [verb === 'start' ? 'The requested service has already been started.' : `The ${unit.windowsDisplay} service is not started.`];
  s.setUnit(unit.id, verb === 'start');
  return [`The ${unit.windowsDisplay} service was ${verb === 'start' ? 'started' : 'stopped'} successfully.`, ''];
}
