/**
 * A Codefix code lab (D24): one PC whose user finds the starting files in their home folder — /home/alumno on GNU/Linux
 * (bash) or C:\Users\user on Windows (cmd.exe) — owned by that user so they can edit them, as the topology file a
 * pupil's attempt starts from. It is marked with `run` checks on CODE_LAB_DEVICE.
 */
import { Topology, type TopologyFile } from '../net/topology.ts';
import type { Host, HostOs } from '../devices/host.ts';
import { createShell, defaultUser } from '../shells/factory.ts';
import { defaultLinuxUser, hostSystem, hostUsers } from '../shells/host-system.ts';
import { windowsAccount } from '../shells/win-system.ts';

export const CODE_LAB_DEVICE = 'PC';

export interface CodeLabFile {
  /** Relative to the user's home folder, with / between folders. */
  readonly path: string;
  readonly content: string;
}

/** A relative path with no empty, . or .. part (the host checks its own sizes; the caller checks names and counts). */
function relative(path: string): string {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\u0000'))) {
    throw new Error(`La ruta «${path}» no es una ruta relativa válida`);
  }
  return path;
}

export function codeLab(os: HostOs, files: readonly CodeLabFile[]): TopologyFile {
  const t = new Topology();
  const pc = t.add('pc', 0, 0, { label: CODE_LAB_DEVICE }).device as Host;
  pc.os = os;
  const user = defaultUser(pc, os);
  // The terminal makes its folders the first time (C: and its Users on Windows): the files go in after it.
  createShell(pc, os, user).prompt();
  const account = windowsAccount(hostUsers(pc), user, defaultLinuxUser(pc));
  const cred = { uid: account?.uid ?? 0, gid: account?.gid ?? 0, groups: account?.groups ?? [] };
  const home = os === 'windows' ? `/mnt/c/Users/${user}` : (account?.home ?? `/home/${user}`);
  const fs = hostSystem(pc).fs;
  for (const f of files) {
    const path = `${home}/${relative(f.path)}`;
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (!fs.tryLookup(dir, cred)) fs.mkdir(dir, cred, true);
    fs.writeFile(path, f.content, cred);
  }
  return t.toJSON();
}
