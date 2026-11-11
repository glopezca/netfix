/** Per-host Ubuntu system: file system (rootfs + generated config + web root + user files), accounts and programs. */
import { NSSWITCH, seededNsswitch } from './nsswitch.ts';
import { DEFAULT_RESOLVED_CONF, parseResolvedConf, RESOLVED_CONF } from './resolved-conf.ts';
import { setResolvedConfig } from './resolved.ts';
import { t } from '../i18n/t.ts';
import { runsServices } from '../devices/kinds.ts';
import { NETPLAN_FILE, netplanFileContent, writeNetplanFile } from './netplan.ts';
import { SSHD_CONFIG, DEFAULT_SSHD_CONFIG } from '../services/sshd-config.ts';
import { hostKeyFiles } from '../services/ssh-hostkeys.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import type { CommandFn, HostEnv, UserInfo } from '../bash/types.ts';
import { FsError, MAX_FILE, ROOT, Vfs, dirname } from '../bash/vfs.ts';
import { EDITABLE_CONFIGS, editableOf } from './editable-configs.ts';
import { registerUnitCheck } from '../devices/unit-checks.ts';
import type { UnitCheck } from '../devices/unit-checks.ts';
import { adoptEdits, familyOf, followModel, guardCheck, noteEdit } from './hand-edits.ts';
import type { Family } from './hand-edits.ts';
import type { DirMount } from '../bash/vfs.ts';
import { seedRootfs, seedUsers } from '../bash/rootfs.ts';
import { COREUTILS } from '../bash/coreutils/index.ts';
import { BINARY_MARK } from '../bash/path.ts';
import { linuxFiles } from './linux-files.ts';
import { linuxPrograms } from './linux-programs.ts';
import { formatIp } from '../core/ip.ts';
import { exportFiles, importFiles } from '../bash/vfs-persist.ts';
import { seedApache } from '../services/apache/defaults.ts';
import { registerHostFs, registerHostFileReader } from '../devices/host-fs.ts';
import { seedKernel, sysctlFiles, applySysctlFile } from './kernel-files.ts';
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

const asServer = (host: Host): Server | undefined => (runsServices(host.kind) ? host as Server : undefined);

/** The default console account of a host (alumno on PCs, admin on servers). */
export function defaultLinuxUser(host: Host): string {
  return runsServices(host.kind) ? 'admin' : 'alumno';
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
  [NETPLAN_FILE]: (host, content) => writeNetplanFile(host, content),
};

/** Generated files readable only by root (like Ubuntu's 600 netplan files). */
const PRIVATE_MODE: Readonly<Record<string, number>> = { [NETPLAN_FILE]: 0o600 };

/**
 * Files root may write as ordinary files (root, 644, saved with the lab): those of editable-configs.ts (kea-dhcp4.conf,
 * the files right in /etc/bind, main.cf, dovecot.conf), generated or new. Saving applies nothing; the unit reads them
 * when it starts.
 */
const editable = (p: string): boolean => editableOf(p) !== undefined;
/** The directories above the editable files: a saved lab may not replace them (by a link, say). */
const EDITABLE_DIRS: ReadonlySet<string> = new Set(EDITABLE_CONFIGS.flatMap((c) => c.dirs));

/** A saved editable file comes back as root's 644 file in place of the generated one, whatever its record says. */
function restoreEditable(fs: Vfs, path: string, content: string): void {
  const parent = dirname(path);
  const dir = fs.tryLookup(parent, ROOT, false);
  if (content.length > MAX_FILE || (dir !== undefined && dir.kind !== 'dir')) return;
  const there = fs.tryLookup(path, ROOT, false);
  if (there !== undefined && there.kind !== 'file') return;
  if (there?.kind === 'file' && !there.generated) fs.usedBytes -= there.content.length;
  fs.unmountFile(path);
  fs.seed(path, { kind: 'file', content }, 0o644, 0, 0);
  fs.lookup(path, ROOT, false).dirty = true;
  fs.usedBytes += content.length;
}

/** The files of a saved lab: the editable ones and the directories above them apart, as root's. */
function restoreRecords(fs: Vfs, records: readonly FileRecord[]): void {
  importFiles(fs, records.filter((r) => !editable(r.path) && !EDITABLE_DIRS.has(r.path)));
  for (const r of records) if (editable(r.path) && r.kind === 'file') restoreEditable(fs, r.path, r.content ?? '');
}

/** An editable path keeps the file there only if it is root's, not writable by others and not behind a link. */
function keptUserFile(fs: Vfs, p: string): boolean {
  const there = fs.tryLookup(p, ROOT, false);
  if (!editable(p) || there?.kind !== 'file' || there.generated) return false;
  return there.uid === 0 && (there.mode & 0o022) === 0 && fs.realpath(dirname(p)) === dirname(p);
}

/** The first write of an editable generated file: from then on it is the user's file. */
function toUserFile(host: Host, fs: Vfs, path: string, content: string, read: () => string): void {
  if (content.length > MAX_FILE) throw new FsError('EFBIG');
  fs.unmountFile(path);
  try {
    fs.writeFile(path, content);
  } catch (err) {
    fs.mountFile(path, read, 0o644, (c) => { toUserFile(host, fs, path, c, read); });
    throw err;
  }
  noteEdit(host, path);
}

function writerOf(host: Host, fs: Vfs, p: string, read: () => string): ((c: string) => void) | undefined {
  if (editable(p)) return (c) => { toUserFile(host, fs, p, c, read); };
  const writer = WRITERS[p];
  return writer ? (c) => { writer(host, c); } : undefined;
}

/** Generated configuration files follow the live device config (zones, pools, netplan…); a user's file stays. */
function refreshMounts(host: Host, e: Entry): void {
  const now = linuxFiles(host);
  now.set(NETPLAN_FILE, '');
  const read = (p: string): string => (p === NETPLAN_FILE ? netplanFileContent(host) : linuxFiles(host).get(p) ?? '');
  for (const p of e.mounted) if (!now.has(p)) e.fs.unmountFile(p);
  for (const p of now.keys()) {
    if (e.mounted.has(p)) continue;
    if (keptUserFile(e.fs, p)) continue;
    e.fs.mountFile(p, () => read(p), PRIVATE_MODE[p] ?? 0o644, writerOf(host, e.fs, p, () => read(p)));
  }
  e.mounted = new Set(now.keys());
}

/** Servicios changed the model behind the family's files: root's copies of generated files give way to the model's. */
function regenerate(host: Host, e: Entry, family: Family): void {
  const read = (p: string): string => linuxFiles(host).get(p) ?? '';
  for (const p of linuxFiles(host).keys()) {
    const there = e.fs.tryLookup(p, ROOT, false);
    if (familyOf(p) !== family || there?.kind !== 'file' || there.generated || e.fs.realpath(dirname(p)) !== dirname(p)) continue;
    e.fs.usedBytes -= there.content.length;
    e.fs.mountFile(p, () => read(p), PRIVATE_MODE[p] ?? 0o644, writerOf(host, e.fs, p, () => read(p)));
    e.mounted.add(p);
  }
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
    host.setPrettyName(value === '' ? undefined : value.slice(0, MAX_PRETTY));
    return null;
  }
  // The host name comes from the device name (Equipo), never from the terminal.
  return t('host.locked');
}

const SSH_CLIENT_CONFIG = `# This is the ssh client system-wide configuration file.  See ssh_config(5).

Include /etc/ssh/ssh_config.d/*.conf

Host *
#   StrictHostKeyChecking ask
#   IdentityFile ~/.ssh/id_rsa
#   IdentityFile ~/.ssh/id_ecdsa
#   IdentityFile ~/.ssh/id_ed25519
    SendEnv LANG LC_* COLORTERM NO_COLOR
    HashKnownHosts no
    GSSAPIAuthentication yes
`;

/** OpenSSH client config on every host; sshd config and host keys on servers. */
function seedSsh(fs: Vfs, host: Host): void {
  fs.seed('/etc/ssh', { kind: 'dir' }, 0o755);
  fs.seed('/etc/ssh/ssh_config', { kind: 'file', content: SSH_CLIENT_CONFIG }, 0o644);
  fs.seed('/etc/ssh/ssh_config.d', { kind: 'dir' }, 0o755);
  if (!asServer(host)) return;
  fs.seed(SSHD_CONFIG, { kind: 'file', content: DEFAULT_SSHD_CONFIG }, 0o644);
  fs.seed('/etc/ssh/sshd_config.d', { kind: 'dir' }, 0o755);
  for (const f of hostKeyFiles(host.mac, host.name.toLowerCase())) fs.seed(f.path, { kind: 'file', content: f.content }, f.mode);
}

function createSystem(host: Host): Entry {
  const fs = new Vfs(() => host.clock.now());
  const programs = new Map<string, CommandFn>([...COREUTILS, ...linuxPrograms(host)]);
  const users = hostUsers(host);
  seedRootfs(fs, { hostname: host.name.toLowerCase(), users, programs: [...programs.keys()].filter((p) => p !== 'command-not-found') });
  // An ordinary file, as in Ubuntu: root edits it, it is saved with the topology and the resolver reads it first.
  fs.seed(NSSWITCH, { kind: 'file', content: seededNsswitch(host) }, 0o644);
  fs.seed(RESOLVED_CONF, { kind: 'file', content: DEFAULT_RESOLVED_CONF }, 0o644);
  fs.seed('/etc/hosts', { kind: 'file', content: `127.0.0.1 localhost\n127.0.1.1 ${host.name.toLowerCase()}\n` }, 0o644);
  fs.seed('/usr/lib/command-not-found', { kind: 'file', content: `${BINARY_MARK}command-not-found\n` }, 0o755);
  const server = asServer(host);
  seedSsh(fs, host);
  seedKernel(fs, host);
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
  restoreRecords(fs, pendingFiles.get(host) ?? []);
  pendingFiles.delete(host);
  bootResolvedFrom(host, fs);
  return { fs, env, mounted: new Set(), usersKey: users.map((u) => u.name).join(',') };
}

/** The (lazily created) system of a host, with its generated files and accounts brought up to date. */
export function hostSystem(host: Host): HostSystem {
  let e = systems.get(host);
  if (!e) {
    const made = createSystem(host);
    systems.set(host, made);
    const server = asServer(host);
    server?.onChange(() => { followModel(server, (f) => { regenerate(host, made, f); }); });
    e = made;
  }
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
  if (e) {
    restoreRecords(e.fs, files);
    bootResolvedFrom(host, e.fs);
    return;
  }
  pendingFiles.set(host, files);
  // Records apply in order: the last one for the path is what will be on disk (a deleted file is the defaults).
  const last = files.filter((f) => f.path === RESOLVED_CONF).pop();
  if (last) bootResolved(host, last.kind === 'file' ? last.content ?? '' : '');
}

/** The host boots: systemd-resolved reads its file (later edits wait for a restart of the unit). */
function bootResolved(host: Host, text: string): void {
  setResolvedConfig(host, parseResolvedConf(text));
}

const bootResolvedFrom = (host: Host, fs: Vfs): void => bootResolved(host, fs.tryLookup(RESOLVED_CONF)?.kind === 'file' ? fs.readFile(RESOLVED_CONF) : '');

/**
 * Boot of a host loaded from a topology: if its saved files change kernel parameters, `sysctl --system`
 * applies them (systemd-sysctl). Hosts without such files keep the defaults and no system is created.
 */
export function bootKernel(host: Host, files: readonly FileRecord[]): void {
  if (!files.some((f) => f.path === '/etc/sysctl.conf' || f.path.startsWith('/etc/sysctl.d/'))) return;
  const fs = hostSystem(host).fs;
  for (const path of sysctlFiles(fs)) applySysctlFile(fs, host, path);
}

/**
 * A lab just loaded (its services already started with the saved files): the saved service files go with the saved
 * model, so the next change from Servicios writes them again.
 */
export function adoptSavedFiles(server: Server, files: readonly FileRecord[]): void {
  const families = new Set(files.filter((f) => f.kind === 'file').map((f) => familyOf(f.path)).filter((f) => f !== undefined));
  if (!families.size) return;
  hostSystem(server);
  adoptEdits(server, families);
}

/** A unit's start or reload reads its files; a host whose system does not exist yet has only the generated ones. */
function checkFiles(srv: Server, family: Family, run: (fs: Vfs) => UnitCheck): UnitCheck {
  if (!systems.has(srv) && !(pendingFiles.get(srv) ?? []).some((f) => familyOf(f.path) === family)) return { ok: true };
  const fs = hostSystem(srv).fs;
  const e = systems.get(srv);
  return guardCheck(srv, family, (f) => { if (e) regenerate(srv, e, f); }, () => run(fs));
}

registerHostFs((host) => hostSystem(host).fs);
// Each unit of editable-configs.ts reads its files when it starts (and at reload, those that have one).
for (const c of EDITABLE_CONFIGS) registerUnitCheck(c.unit, (srv, mode) => checkFiles(srv, c.unit, (fs) => c.check(srv, fs, mode)));
// Before the system exists, a file saved with the topology is read from the pending records (same result either way).
registerHostFileReader((host, path) => {
  const e = systems.get(host);
  if (!e) return pendingFiles.get(host)?.find((f) => f.path === path && f.kind === 'file')?.content;
  try {
    return e.fs.readFile(path);
  } catch {
    return undefined;
  }
});
