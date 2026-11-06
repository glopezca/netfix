/**
 * named's start and `rndc reload` on a Linux server (Ubuntu's bind9, named confined by AppArmor): it reads
 * /etc/bind/named.conf with its includes and loads each primary zone, as `named-checkconf -z` does, from /etc/bind and
 * /var/cache/bind only. A bad named.conf stops the start (a reload keeps what named had); a bad zone stays unloaded.
 * An untouched /etc/bind holds only the files generated from the model: there is nothing to read back.
 */
import type { Server } from '../devices/server.ts';
import type { CheckMode, UnitCheck } from '../devices/unit-checks.ts';
import { FsError, ROOT } from '../bash/vfs.ts';
import type { Vfs } from '../bash/vfs.ts';
import type { ConfReader } from '../services/named-conf-parse.ts';
import { checkNamedConf, LOADABLE } from '../services/named-conf-check.ts';
import type { NamedConf } from '../services/named-conf-check.ts';
import { checkZone } from '../services/zone-check.ts';
import { importBind } from '../services/bind-import.ts';
import type { BindRead, ZoneResult } from '../services/bind-import.ts';
import { NAMED_OPTIONS } from '../services/named-options.ts';
import { RPZ_FILE } from '../services/dns-rpz.ts';
import { listenChoices } from '../services/listen.ts';
import { MAX_ZONES } from '../services/dns-zones.ts';

export const NAMED_CONF = '/etc/bind/named.conf';
export const NAMED_IDENT = 'named[845]';
const BIND_DIR = '/etc/bind';
/** named's working directory when named.conf.options says none (Ubuntu's default). */
const CACHE_DIR = '/var/cache/bind';
/** What AppArmor lets named read (usr.sbin.named: /etc/bind/** r, /var/cache/bind/** rw). */
const READABLE = [`${BIND_DIR}/`, `${CACHE_DIR}/`];
const OK: UnitCheck = { ok: true };

/** How isc_result names why a file cannot be read (anything else is ISC_R_UNEXPECTED). */
function reason(e: unknown): string {
  if (!(e instanceof FsError)) return 'unexpected error';
  if (e.code === 'ENOENT') return 'file not found';
  if (e.code === 'EACCES') return 'permission denied';
  return 'unexpected error';
}

/** The files named may read, by their real path (a link out of /etc/bind is denied as AppArmor does). */
function confinedReader(fs: Vfs): ConfReader {
  return (path) => {
    try {
      const real = fs.realpath(path);
      if (!READABLE.some((d) => real.startsWith(d))) return { error: 'permission denied' };
      return fs.readFile(real, ROOT);
    } catch (e) {
      return { error: reason(e) };
    }
  };
}

/** Only generated files in /etc/bind: named would load exactly what the model already says. */
function untouched(fs: Vfs): boolean {
  try {
    return fs.readdir(BIND_DIR).every((name) => {
      const node = fs.tryLookup(`${BIND_DIR}/${name}`, ROOT, false);
      return node?.kind === 'file' && node.generated !== undefined;
    });
  } catch {
    return false;
  }
}

const generated = (fs: Vfs, path: string): boolean => {
  try {
    const node = fs.tryLookup(fs.realpath(path), ROOT, false);
    return node?.kind === 'file' && node.generated !== undefined;
  } catch {
    return false;
  }
};

/** A file edited by root, or undefined while it is the generated one. */
function edited(fs: Vfs, path: string, read: ConfReader): string | undefined {
  if (generated(fs, path)) return undefined;
  const text = read(path);
  return typeof text === 'string' ? text : undefined;
}

/** Each primary zone loaded as named loads it: a relative file from named's directory. */
function loadZones(fs: Vfs, conf: NamedConf, read: ConfReader): { zones: ZoneResult[]; lines: string[] } {
  const dir = (conf.directory ?? CACHE_DIR).replace(/\/$/, '');
  const at = (file: string): string => (file.startsWith('/') ? file : `${dir}/${file}`);
  const inDirectory: ConfReader = (file) => read(at(file));
  const zones: ZoneResult[] = [];
  const lines: string[] = [];
  // The model keeps MAX_ZONES zones: named does not load more of them here (each load has its own budget).
  for (const z of conf.zones.filter((c) => c.type !== undefined && LOADABLE.has(c.type) && c.file !== undefined).slice(0, MAX_ZONES)) {
    if (z.file === undefined) continue;
    const text = inDirectory(z.file);
    const r = typeof text === 'string' ? checkZone(z.name, z.file, text, undefined, inDirectory) : checkZone(z.name, z.file, undefined, text.error);
    lines.push(...r.lines);
    zones.push({ name: z.name, ok: r.ok, records: r.records, generated: generated(fs, at(z.file)) });
  }
  return { zones, lines };
}

const LOADING = `loading configuration from '${NAMED_CONF}'`;
const RECEIVED = "received control channel command 'reload'";

/** What named writes when named.conf does not load: at a start it exits; at a reload it goes on as it was. */
function failure(mode: CheckMode, errors: readonly string[]): string[] {
  if (mode === 'reload') return [RECEIVED, LOADING, ...errors, 'reloading configuration failed: failure'];
  return [LOADING, ...errors, 'loading configuration: failure', 'exiting (due to fatal error)'];
}

/** named's start (or reload) on a Linux server: the BIND files root edited, checked and applied, or why it failed. */
export function namedStart(server: Server, fs: Vfs, mode: CheckMode): UnitCheck {
  if (server.os !== 'linux' || untouched(fs)) return OK;
  const read = confinedReader(fs);
  const conf = checkNamedConf(NAMED_CONF, read);
  if (conf.errors.length > 0) return { ok: false, ident: NAMED_IDENT, lines: failure(mode, conf.errors) };
  const loaded = loadZones(fs, conf, read);
  const options = edited(fs, NAMED_OPTIONS, read);
  const rpz = edited(fs, RPZ_FILE, read);
  const bind: BindRead = { zones: loaded.zones, ...(options === undefined ? {} : { options }), ...(rpz === undefined ? {} : { rpz }) };
  const done = mode === 'reload' ? ['reloading configuration succeeded', 'reloading zones succeeded'] : ['all zones loaded', 'running'];
  const lines = [...(mode === 'reload' ? [RECEIVED] : []), LOADING, ...loaded.lines, ...done];
  const choices = listenChoices(server, true);
  return { ok: true, ident: NAMED_IDENT, lines, apply: (s) => ({ ...s, dns: importBind(s.dns, bind, mode, choices) }) };
}
