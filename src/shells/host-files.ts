/**
 * A device's files without a terminal (extension SDK): as its default console user (alumno on a PC, admin on a server),
 * with that user's permissions; GNU/Linux paths where the device has GNU/Linux, else Windows ones. For actions such as
 * opening a PC's files in an editor from the workspace; a terminal program gets its own user's in `call.files`.
 */
import type { Host } from '../devices/host.ts';
import { hasSystem } from '../net/device-apps.ts';
import { defaultLinuxUser, hostSystem, hostUsers } from './host-system.ts';
import { defaultWindowsUser, usersDir, windowsAccount } from './win-system.ts';
import { userFiles, type HostFiles, type ProgramSystem } from './programs.ts';

/** `system`: which of its systems (default: GNU/Linux when it has it, else Windows). */
export function hostFiles(host: Host, system?: ProgramSystem): HostFiles {
  const fs = hostSystem(host).fs;
  const users = hostUsers(host);
  const linux = system ? system === 'linux' : !hasSystem(host, 'windows') || hasSystem(host, 'linux');
  if (linux) {
    const u = users.find((x) => x.name === defaultLinuxUser(host)) ?? users[0];
    const cred = { uid: u?.uid ?? 0, gid: u?.gid ?? 0, groups: u?.groups ?? [] };
    const home = u?.home ?? '/';
    return userFiles(fs, cred, 'linux', home, home);
  }
  const user = defaultWindowsUser(host.kind);
  const a = windowsAccount(users, user, defaultLinuxUser(host));
  const cred = { uid: a?.uid ?? 0, gid: a?.gid ?? 0, groups: a?.groups ?? [] };
  return userFiles(fs, cred, 'windows', usersDir(user), usersDir(user));
}
