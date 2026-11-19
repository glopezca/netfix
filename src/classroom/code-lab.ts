/**
 * A Codefix code lab (D24): one PC whose user finds the starting files in their home folder — /home/alumno on GNU/Linux
 * (bash) or C:\Users\user on Windows (cmd.exe) — owned by that user so they can edit them, as the topology file a
 * pupil's attempt starts from. It is marked with `run` checks on CODE_LAB_DEVICE. CodeLab gives the code workbench
 * (ui/code-mount.ts) that user's files: listed, written and removed as the user, as the terminal would.
 */
import { Topology, type TopologyFile } from '../net/topology.ts';
import type { Host, HostOs } from '../devices/host.ts';
import type { Cred, Vfs } from '../bash/vfs.ts';
import { createShell, defaultUser } from '../shells/factory.ts';
import { defaultLinuxUser, hostSystem, hostUsers } from '../shells/host-system.ts';
import { windowsAccount } from '../shells/win-system.ts';

export const CODE_LAB_DEVICE = 'PC';
/** What the workbench lists: enough for any practical, never the whole disk. */
export const MAX_LISTED = 200;
const MAX_DEPTH = 6;

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

export class CodeLab {
  readonly topology: Topology;
  readonly pc: Host;
  readonly os: HostOs;
  readonly user: string;
  private readonly cred: Cred;
  private readonly home: string;
  private readonly fs: Vfs;

  /** The lab of `topology` (its CODE_LAB_DEVICE, else its first PC), or a new one; the terminal's folders made first. */
  constructor(os: HostOs, topology = new Topology()) {
    this.topology = topology;
    const found = topology.byLabel(CODE_LAB_DEVICE);
    this.pc = (found as Host | undefined) ?? (topology.add('pc', 0, 0, { label: CODE_LAB_DEVICE }).device as Host);
    this.os = os;
    if (!found) this.pc.os = os;
    this.user = defaultUser(this.pc, os);
    // The terminal makes its folders the first time (C: and its Users on Windows): files go in after it.
    createShell(this.pc, os, this.user).prompt();
    const account = windowsAccount(hostUsers(this.pc), this.user, defaultLinuxUser(this.pc));
    this.cred = { uid: account?.uid ?? 0, gid: account?.gid ?? 0, groups: account?.groups ?? [] };
    this.home = os === 'windows' ? `/mnt/c/Users/${this.user}` : (account?.home ?? `/home/${this.user}`);
    this.fs = hostSystem(this.pc).fs;
  }

  /** The user's text files under their home (not hidden ones, as `ls` shows), by path, at most MAX_LISTED. */
  files(): CodeLabFile[] {
    const out: CodeLabFile[] = [];
    const walk = (dir: string, rel: string, depth: number): void => {
      let names: string[];
      try { names = this.fs.readdir(dir, this.cred); } catch { return; }
      for (const name of names.filter((n) => !n.startsWith('.')).sort()) {
        if (out.length >= MAX_LISTED) return;
        const path = `${dir}/${name}`;
        const node = this.fs.tryLookup(path, this.cred, false);
        if (node?.kind === 'dir' && depth < MAX_DEPTH) walk(path, `${rel}${name}/`, depth + 1);
        else if (node?.kind === 'file') {
          try { out.push({ path: `${rel}${name}`, content: this.fs.readFile(path, this.cred) }); } catch { /* not readable by the user: not listed */ }
        }
      }
    };
    walk(this.home, '', 0);
    return out;
  }

  /** Writes a file as the user (its folders too); throws Netfix's message when the user may not. */
  write(path: string, content: string): void {
    const full = `${this.home}/${relative(path)}`;
    const dir = full.slice(0, full.lastIndexOf('/'));
    if (!this.fs.tryLookup(dir, this.cred)) this.fs.mkdir(dir, this.cred, true);
    this.fs.writeFile(full, content, this.cred);
  }

  remove(path: string): void {
    this.fs.remove(`${this.home}/${relative(path)}`, this.cred);
  }

  toJSON(): TopologyFile {
    return this.topology.toJSON();
  }
}

export function codeLab(os: HostOs, files: readonly CodeLabFile[]): TopologyFile {
  const lab = new CodeLab(os);
  for (const f of files) lab.write(f.path, f.content);
  return lab.toJSON();
}
