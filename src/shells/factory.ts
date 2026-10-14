/** Creates the right shell for a host and operating system. */
import { runsServices } from '../devices/kinds.ts';
import type { Host, HostOs } from '../devices/host.ts';
import type { ShellSession } from './base.ts';
import { LinuxShell } from './linux.ts';
import { WindowsShell } from './windows.ts';

export function defaultUser(host: Host, os: HostOs): string {
  if (os === 'windows') return runsServices(host.kind) ? 'Administrator' : 'user';
  return runsServices(host.kind) ? 'admin' : 'alumno';
}

export function createShell(host: Host, os: HostOs, user = defaultUser(host, os), remote = false): ShellSession {
  return os === 'windows' ? new WindowsShell(host, user, remote) : new LinuxShell(host, user, remote);
}
