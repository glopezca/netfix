/** Per-host Ubuntu system: file system (rootfs + generated config + web root + user files), accounts and programs. */
import type { Host } from '../devices/host.ts';
import { validHostname } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import type { CommandFn, HostEnv, UserInfo } from '../bash/types.ts';
import { Vfs } from '../bash/vfs.ts';
import type { DirMount } from '../bash/vfs.ts';
import { seedRootfs, seedUsers } from '../bash/rootfs.ts';
import { COREUTILS } from '../bash/coreutils/index.ts';
import { BINARY_MARK } from '../bash/path.ts';
import { linuxFiles } from './linux-files.ts';
import { linuxPrograms } from './linux-programs.ts';
import { formatIp } from '../core/ip.ts';
import { exportFiles, importFiles } from '../bash/vfs-persist.ts';
import { seedApache } from '../services/apache/defaults.ts';
import { registerHostFs } from '../devices/host-fs.ts';
import type { FileRecord } from '../bash/vfs-persist.ts';

export interface HostSystem {
  readonly fs: Vfs;
  readonly env: HostEnv;
}

interface Entry extends HostSystem {
  mounted: Set<string>;
  usersKey: string;
}

const FIRST_UID = 1000;
const UID_SPAN = 8999;
const ADM = 4;
const SUDO = 27;
const USERS = 100;
const WWW = '/var/www/html';
const MAX_PRETTY = 256;
const systems = new WeakMap<Host, Entry>();
/** Files loaded from a topology before the host's system was first used. */
const pendingFiles = new WeakMap<Host, readonly FileRecord[]>();

const asServer = (host: Host): Server | undefined => (host.kind === 'server' ? host as Server : undefined);

/** The default console account of a host (alumno on PCs, admin on servers). */
export function defaultLinuxUser(host: Host): string {
  return host.kind === 'server' ? 'admin' : 'alumno';
}

/** UID derived from the account name, so that it does not change when other accounts are added or removed. */
function stableUid(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % UID_SPAN;
  return FIRST_UID + 1 + h;
}

/** root, the console user (in the sudo group) and every SSH account of a server. */
export function hostUsers(host: Host): UserInfo[] {
  const main = defaultLinuxUser(host);
  const user = (name: string, uid: number, groups: readonly number[]): UserInfo => ({ name, uid, gid: uid, home: `/home/${name}`, shell: '/bin/bash', groups: [uid, ...groups] });
  const list: UserInfo[] = [{ name: 'root', uid: 0, gid: 0, home: '/root', shell: '/bin/bash', groups: [0] }, user(main, FIRST_UID, [ADM, SUDO, USERS])];
  const ssh = asServer(host)?.services.ssh.users ?? [];
  const taken = new Set(list.map((u) => u.uid));
  for (const a of ssh) {
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(a.name) || list.some((u) => u.name === a.name)) continue;
    let uid = stableUid(a.name);
    while (taken.has(uid)) uid++;
    taken.add(uid);
    list.push(user(a.name, uid, [USERS]));
  }
  return list;
}

function webRoot(server: Server): DirMount {
  const files = (): readonly { name: string; content: string }[] => server.services.http.files;
  const replace = (next: readonly { name: string; content: string }[]): void => server.setServices({ ...server.services, http: { ...server.services.http, files: next } });
  return {
    list: () => files().map((f) => f.name),
    read: (name) => files().find((f) => f.name === name)?.content,
    write: (name, content) => replace([...files().filter((f) => f.name !== name), { name, content }]),
    remove: (name) => replace(files().filter((f) => f.name !== name)),
  };
}

/** Generated files that root may edit: writing them changes the device configuration. */
const WRITERS: Readonly<Record<string, (host: Host, content: string) => void>> = {
  '/etc/hostname': (host, content) => {
    const name = content.trim().split('\n')[0]?.trim() ?? '';
    if (validHostname(name) === null) host.setHostname(name);
  },
};

/** Generated configuration files follow the live device config (zones, pools, netplan…). */
function refreshMounts(host: Host, e: Entry): void {
  const now = linuxFiles(host);
  for (const p of e.mounted) if (!now.has(p)) e.fs.unmountFile(p);
  for (const p of now.keys()) {
    if (e.mounted.has(p)) continue;
    const writer = WRITERS[p];
    e.fs.mountFile(p, () => linuxFiles(host).get(p) ?? '', 0o644, writer ? (c) => writer(host, c) : undefined);
  }
  e.mounted = new Set(now.keys());
}

function refreshUsers(host: Host, e: Entry): void {
  const users = hostUsers(host);
  const key = users.map((u) => u.name).join(',');
  if (key === e.usersKey) return;
  seedUsers(e.fs, users);
  e.usersKey = key;
}

function setName(host: Host, kind: 'static' | 'transient' | 'pretty', value: string): string | null {
  if (kind === 'pretty') {
    host.prettyName = value === '' ? undefined : value.slice(0, MAX_PRETTY);
    return null;
  }
  if (validHostname(value) !== null) return `Invalid ${kind} hostname '${value}'`;
  if (kind === 'transient') host.transientName = value;
  else host.setHostname(value);
  return null;
}

function createSystem(host: Host): Entry {
  const fs = new Vfs(() => host.clock.now());
  const programs = new Map<string, CommandFn>([...COREUTILS, ...linuxPrograms(host)]);
  const users = hostUsers(host);
  seedRootfs(fs, { hostname: host.name.toLowerCase(), users, programs: [...programs.keys()].filter((p) => p !== 'command-not-found') });
  fs.seed('/usr/lib/command-not-found', { kind: 'file', content: `${BINARY_MARK}command-not-found\n` }, 0o755);
  const server = asServer(host);
  if (server) {
    seedApache(fs);
    fs.mountDir(WWW, webRoot(server));
  }
  const env: HostEnv = {
    get hostname() { return host.runtimeName().toLowerCase(); },
    fs,
    users: () => hostUsers(host),
    commands: programs,
    now: () => host.clock.now(),
    wait: (ms) => { host.hooks.runUntil(() => false, ms); },
    ipAddress: () => (host.config.ip !== undefined ? formatIp(host.config.ip) : ''),
    password: (name) => asServer(host)?.services.ssh.users.find((a) => a.name === name)?.password,
    hostnames: () => ({ static: host.name.toLowerCase(), transient: host.runtimeName().toLowerCase(), pretty: host.prettyName }),
    setHostname: (kind, value) => setName(host, kind, value),
  };
  importFiles(fs, pendingFiles.get(host) ?? []);
  pendingFiles.delete(host);
  return { fs, env, mounted: new Set(), usersKey: users.map((u) => u.name).join(',') };
}

/** The (lazily created) system of a host, with its generated files and accounts brought up to date. */
export function hostSystem(host: Host): HostSystem {
  const e = systems.get(host) ?? createSystem(host);
  systems.set(host, e);
  refreshUsers(host, e);
  refreshMounts(host, e);
  return e;
}

/** The user files of a host, for the topology file (undefined when there are none). */
export function savedFiles(host: Host): readonly FileRecord[] | undefined {
  const e = systems.get(host);
  const files = e ? exportFiles(e.fs) : pendingFiles.get(host) ?? [];
  return files.length ? files : undefined;
}

/** Restores the user files saved in a topology (applied when the host's system is created). */
export function restoreFiles(host: Host, files: readonly FileRecord[]): void {
  const e = systems.get(host);
  if (e) importFiles(e.fs, files);
  else pendingFiles.set(host, files);
}

registerHostFs((host) => hostSystem(host).fs);
