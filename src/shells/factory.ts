/** Creates the right shell for a host and operating system. */
import type { Host, HostOs } from '../devices/host.ts';
import type { ShellSession } from './base.ts';
import { LinuxShell } from './linux.ts';
import { WindowsShell } from './windows.ts';

export function defaultUser(host: Host, os: HostOs): string {
  if (os === 'windows') return host.kind === 'server' ? 'Administrator' : 'user';
  return host.kind === 'server' ? 'admin' : 'alumno';
}

export function createShell(host: Host, os: HostOs, user = defaultUser(host, os), remote = false): ShellSession {
  return os === 'windows' ? new WindowsShell(host, user, remote) : new LinuxShell(host, user, remote);
}
