/**
 * apt (3.1, Ubuntu 26.04) with a limited reach: the catalogue is fictitious and always up to date, but the mirrors are
 * reached over the simulated network (no way out or no DNS: apt's real errors), and installing or removing a service
 * package switches its panel on the device (Configuración tab) and starts or stops the service, as dpkg would.
 */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { aptSources, mirrorStatus } from './apt-net.ts';
import type { AptSource } from './apt-net.ts';
import { BASE, PACKAGES, findPackage, kb } from './apt-catalog.ts';
import type { AptDep, AptPackage } from './apt-catalog.ts';
import { mooLines } from './apt-moo.ts';
import { installedPackage, setPackage } from './apt-state.ts';

const READING = 'Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n';
const summary = (installing: number, removing: number): string => `Summary:\n  Upgrading: 0, Installing: ${installing}, Removing: ${removing}, Not Upgrading: 0\n`;
const NOTHING = summary(0, 0);
const DB_FILES = 68143;
const KB_PER_SECOND = 2500;
const FREE_SPACE = '24.1 GB';

const HELP = `apt 3.1.6ubuntu2 (amd64)
Usage: apt [options] command

apt is a commandline package manager and provides commands for
searching and managing as well as querying information about packages.
It provides the same functionality as the specialized APT tools,
like apt-get and apt-cache, but enables options more suitable for
interactive use by default.

Most used commands:
  list - list packages based on package names
  search - search in package descriptions
  show - show package details
  install - install packages
  reinstall - reinstall packages
  remove - remove packages
  autoremove - automatically remove all unused packages
  update - update list of available packages
  upgrade - upgrade the system by installing/upgrading packages
  full-upgrade - upgrade the system by removing/installing/upgrading packages
  edit-sources - edit the source information file
  modernize-sources - modernize .list files to .sources files
  satisfy - satisfy dependency strings

See apt(8) for more information about the available commands.
Configuration options and syntax is detailed in apt.conf(5).
Information about how to configure sources can be found in sources.list(5).
Package and version choices can be expressed via apt_preferences(5).
Security details are available in apt-secure(8).
                                        This APT has Super Cow Powers.
`;

/** What changes the system needs root (dpkg's lock, or the lists' lock for update). */
function locked(ctx: Ctx, update: boolean): boolean {
  if (ctx.cred.uid === 0) return false;
  ctx.err(update
    ? 'Error: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nError: Unable to lock directory /var/lib/apt/lists/\n'
    : 'Error: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nError: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n');
  return true;
}

function update(ctx: Ctx, host: Host): number {
  const status = mirrorStatus(host);
  const sources = aptSources(ctx.sh.env.fs);
  const reasons = sources.map((s) => status(s.uri, `dists/${s.suite}/InRelease`));
  const line = (s: AptSource, i: number): string => `${s.uri} ${s.suite} InRelease`.replace(/^/, `${i + 1} `);
  const out = sources.map((s, i) => (reasons[i] === undefined ? `Hit:${line(s, i)}` : `Ign:${line(s, i)}`));
  const errs = sources.flatMap((s, i) => (reasons[i] === undefined ? [] : [`Err:${line(s, i)}\n  ${reasons[i]}`]));
  ctx.out(`${[...out, ...errs].join('\n')}${sources.length ? '\n' : ''}${READING}All packages are up to date.\n`);
  const failed = sources.flatMap((s, i) => (reasons[i] === undefined ? [] : [`Warning: Failed to fetch ${s.uri}/dists/${s.suite}/InRelease  ${reasons[i]}`]));
  if (failed.length) ctx.err(`${failed.join('\n')}\nWarning: Some index files failed to download. They have been ignored, or old ones used instead.\n`);
  return 0;
}

/** «Continue? [Y/n]»: only an explicit no stops (with -y it is not asked). */
function* confirm(ctx: Ctx, yes: boolean): Gen<boolean> {
  if (yes) return true;
  // On a terminal the question is the input prompt; from a pipe apt still prints it, then reads.
  const tty = ctx.fds.get(0)?.read?.kind === 'tty';
  if (!tty) ctx.out('Continue? [Y/n] ');
  const answer = yield* ctx.readLine(tty ? 'Continue? [Y/n] ' : '');
  if (answer && /^\s*n/i.test(answer.text)) {
    ctx.out('Abort.\n');
    return false;
  }
  return true;
}

const debName = (d: AptDep): string => `${d.name}_${d.version.replace(/^\d+:/, '')}_${d.arch}.deb`;
const poolPath = (p: AptDep, section: string): string => `pool/${section}/${p.name.startsWith('lib') ? p.name.slice(0, 4) : p.name[0]}/${p.name}/${debName(p)}`;

/** The packages to fetch for `todo` (dependencies first, each once). */
function toFetch(todo: readonly AptPackage[]): { pkg: AptDep; section: string }[] {
  const seen = new Set(todo.map((p) => p.name));
  const deps = todo.flatMap((p) => p.deps.map((d) => ({ pkg: d, section: p.section }))).filter(({ pkg }) => !seen.has(pkg.name) && (seen.add(pkg.name), true));
  return [...deps, ...todo.map((p) => ({ pkg: p as AptDep, section: p.section }))];
}

function plan(todo: readonly AptPackage[], fetch: readonly { pkg: AptDep }[]): string {
  const deps = fetch.filter(({ pkg }) => !todo.some((p) => p.name === pkg.name)).map(({ pkg }) => pkg.name);
  const size = fetch.reduce((n, { pkg }) => n + pkg.kb, 0);
  return `Installing:\n  ${todo.map((p) => p.name).join('  ')}\n\n${deps.length ? `Installing dependencies:\n  ${deps.join('  ')}\n\n` : ''}${summary(fetch.length, 0)}`
    + `  Download size: ${kb(size)} kB\n  Space needed: ${kb(size * 4)} kB / ${FREE_SPACE} available\n\n`;
}

function fetchFailed(ctx: Ctx, archive: string, fetch: readonly { pkg: AptDep; section: string }[], reason: string): number {
  const first = fetch[0];
  if (first) ctx.out(`Err:1 ${archive} resolute/${first.section} amd64 ${first.pkg.name} ${first.pkg.arch} ${first.pkg.version}\n  ${reason}\n`);
  ctx.err(`${fetch.map(({ pkg, section }) => `Error: Failed to fetch ${archive}/${poolPath(pkg, section)}  ${reason}`).join('\n')}\nError: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?\n`);
  return 100;
}

function unpack(ctx: Ctx, host: Host, todo: readonly AptPackage[], fetch: readonly { pkg: AptDep; section: string }[], archive: string): void {
  const size = fetch.reduce((n, { pkg }) => n + pkg.kb, 0);
  const seconds = Math.max(1, Math.ceil(size / KB_PER_SECOND));
  ctx.out(fetch.map(({ pkg, section }, i) => `Get:${i + 1} ${archive} resolute/${section} amd64 ${pkg.name} ${pkg.arch} ${pkg.version} [${kb(pkg.kb)} kB]`).join('\n') + '\n');
  ctx.sh.env.wait?.(seconds * 1000);
  ctx.out(`Fetched ${kb(size)} kB in ${seconds}s (${kb(Math.round(size / seconds))} kB/s)\n`);
  const lines = fetch.flatMap(({ pkg }, i) => [`Selecting previously unselected package ${pkg.name}.`, ...(i === 0 ? [`(Reading database ... ${dbFiles(host)} files and directories currently installed.)`] : []),
    `Preparing to unpack .../${i}-${debName(pkg)} ...`, `Unpacking ${pkg.name} (${pkg.version}) ...`]);
  const setup = fetch.flatMap(({ pkg }) => {
    const unit = todo.find((p) => p.name === pkg.name)?.unit;
    return [`Setting up ${pkg.name} (${pkg.version}) ...`, ...(unit ? [`Created symlink '/etc/systemd/system/multi-user.target.wants/${unit}.service' → '/usr/lib/systemd/system/${unit}.service'.`] : [])];
  });
  ctx.out(`${[...lines, ...setup, 'Processing triggers for man-db (2.13.1-1) ...', 'Processing triggers for libc-bin (2.42-0ubuntu3) ...'].join('\n')}\n`);
}

const dbFiles = (host: Host): number => DB_FILES + PACKAGES.filter((p) => installedPackage(host, p)).length * 137;

function* install(ctx: Ctx, host: Host, names: readonly string[], yes: boolean): Gen<number> {
  ctx.out(READING);
  const unknown = names.find((n) => !findPackage(n) && BASE[n] === undefined);
  if (unknown !== undefined) { ctx.err(`Error: Unable to locate package ${unknown}\n`); return 100; }
  const newest = names.flatMap((n) => {
    const p = findPackage(n);
    return !p || installedPackage(host, p) ? [`${n} is already the newest version (${p?.version ?? BASE[n]}).`] : [];
  });
  const todo = names.flatMap((n) => { const p = findPackage(n); return p && !installedPackage(host, p) ? [p] : []; });
  if (newest.length) ctx.out(`${newest.join('\n')}\n`);
  if (!todo.length) { ctx.out(NOTHING); return 0; }
  const fetch = toFetch(todo);
  ctx.out(plan(todo, fetch));
  if (!(yield* confirm(ctx, yes))) return 1;
  const archive = aptSources(ctx.sh.env.fs).find((s) => s.suite === 'resolute')?.uri ?? 'http://archive.ubuntu.com/ubuntu';
  const reason = mirrorStatus(host)(archive, 'dists/resolute/InRelease');
  if (reason !== undefined) return fetchFailed(ctx, archive, fetch, reason);
  unpack(ctx, host, todo, fetch, archive);
  for (const p of todo) setPackage(host, p, true);
  return 0;
}

function* remove(ctx: Ctx, host: Host, names: readonly string[], yes: boolean, purge: boolean): Gen<number> {
  ctx.out(READING);
  const unknown = names.find((n) => !findPackage(n) && BASE[n] === undefined);
  if (unknown !== undefined) { ctx.err(`Error: Unable to locate package ${unknown}\n`); return 100; }
  if (names.some((n) => BASE[n] !== undefined)) { ctx.err('Error: Removing essential system-critical packages is not permitted. This might break the system.\n'); return 100; }
  const todo = names.flatMap((n) => { const p = findPackage(n); return p && installedPackage(host, p) ? [p] : []; });
  const absent = names.filter((n) => !todo.some((p) => p.name === n));
  if (absent.length) ctx.out(absent.map((n) => `Package '${n}' is not installed, so not removed`).join('\n') + '\n');
  if (!todo.length) { ctx.out(NOTHING); return 0; }
  const freed = todo.reduce((n, p) => n + p.kb * 4, 0);
  ctx.out(`REMOVING:\n  ${todo.map((p) => `${p.name}${purge ? '*' : ''}`).join('  ')}\n\n${summary(0, todo.length)}  Freed space: ${kb(freed)} kB\n\n`);
  if (!(yield* confirm(ctx, yes))) return 1;
  const lines = todo.flatMap((p) => [`Removing ${p.name} (${p.version}) ...`, ...(purge ? [`Purging configuration files for ${p.name} (${p.version}) ...`] : [])]);
  ctx.out(`(Reading database ... ${dbFiles(host)} files and directories currently installed.)\n${lines.join('\n')}\nProcessing triggers for man-db (2.13.1-1) ...\n`);
  for (const p of todo) setPackage(host, p, false);
  return 0;
}

function list(ctx: Ctx, host: Host): number {
  const installed = [...Object.entries(BASE).map(([name, version]) => ({ name, version, arch: 'amd64' })), ...PACKAGES.filter((p) => installedPackage(host, p))];
  ctx.out(`Listing... Done\n${installed.sort((a, b) => a.name.localeCompare(b.name)).map((p) => `${p.name}/resolute,now ${p.version} ${p.arch} [installed]`).join('\n')}\n`);
  return 0;
}

function* run(ctx: Ctx, host: Host): Gen<number> {
  const args = ctx.argv.slice(1);
  const words = args.filter((a) => !a.startsWith('-'));
  const yes = args.some((a) => a === '-y' || a === '--yes' || a === '--assume-yes' || /^-[a-z]*y/.test(a));
  const [cmd, ...names] = words;
  if (cmd === undefined || args.includes('-h') || args.includes('--help')) { ctx.out(HELP); return cmd === undefined ? 1 : 0; }
  if (cmd === 'moo') { ctx.out(`${mooLines(words.filter((w) => w === 'moo').length, ctx.sh.env.now()).join('\n')}\n`); return 0; }
  if (cmd === 'list') return list(ctx, host);
  if (!['update', 'upgrade', 'full-upgrade', 'dist-upgrade', 'autoremove', 'install', 'remove', 'purge'].includes(cmd)) { ctx.err(`Error: Invalid operation ${cmd}\n`); return 100; }
  if (locked(ctx, cmd === 'update')) return 100;
  if (cmd === 'update') return update(ctx, host);
  if (cmd === 'install' || cmd === 'remove' || cmd === 'purge') {
    if (!names.length) { ctx.out(`${READING}${NOTHING}`); return 0; }
    return cmd === 'install' ? yield* install(ctx, host, names, yes) : yield* remove(ctx, host, names, yes, cmd === 'purge');
  }
  ctx.out(`${READING}${cmd === 'autoremove' ? '' : 'Calculating upgrade... Done\n'}${NOTHING}`);
  return 0;
}

export function apt(host: Host): CommandFn {
  return (ctx) => run(ctx, host);
}
