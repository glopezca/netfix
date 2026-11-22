/**
 * Terminal programs added from outside the core (extension SDK, PUBLIC-API.md §3.4b). A program has a name, the systems
 * it exists on (GNU/Linux: /usr/bin/<name>; Windows: <name>.exe in a folder of %PATH%, as Git's vim.exe), its manual
 * page in each language, which hosts have it (an extension decides: its lab, its class) and what it does. It works on
 * the files as the terminal's user does: `files` never reads or writes what that user cannot (the same as nano).
 * The core's programs always win: an extension cannot replace or shadow one.
 */
import type { Host } from '../devices/host.ts';
import type { Cred, Vfs } from '../bash/vfs.ts';
import { FsError, normalize } from '../bash/vfs.ts';
import { COREUTILS } from '../bash/coreutils/index.ts';
import { registerExtensionDocs } from '../docs/extension-docs.ts';
import { resolveWinPath, toWindowsPath } from './win-path.ts';

export type ProgramSystem = 'linux' | 'windows';

/** Its manual page (man on GNU/Linux, /? on Windows): what `utilDocs` lists for the core's programs. */
export interface ProgramDoc {
  readonly synopsis: string;
  readonly summary: string;
  readonly options?: string;
}

export interface FileEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

/** A host's files as one user sees them; paths as that system writes them (relative ones from `cwd`). */
export interface HostFiles {
  readonly system: ProgramSystem;
  /** The user's home folder and the current one, in the system's form (/home/alumno, C:\Users\user). */
  readonly home: string;
  readonly cwd: string;
  /** The text of a file, or null when it does not exist; any other refusal (permissions…) throws. */
  read(path: string): string | null;
  /** Writes (creates or replaces) a file; throws what the system would say (Permission denied…). */
  write(path: string, content: string): void;
  list(path: string): FileEntry[];
  kind(path: string): 'file' | 'dir' | null;
  /** The absolute path, in the system's form. */
  resolve(path: string): string;
}

export interface ProgramCall {
  readonly host: Host;
  readonly system: ProgramSystem;
  /** argv[0] is the name as typed (code, code.exe). */
  readonly argv: readonly string[];
  readonly user: string;
  readonly cwd: string;
  readonly files: HostFiles;
  out(text: string): void;
  err(text: string): void;
}

export interface ProgramDef {
  readonly name: string;
  /** Other names for it: a symlink to it in /usr/bin on GNU/Linux, another <alias>.exe beside it on Windows. */
  readonly aliases?: readonly string[];
  readonly systems: readonly ProgramSystem[];
  /** Its folder on C:\ (default: Program Files/<name>), added to %PATH%. */
  readonly windowsDir?: string;
  readonly doc: { readonly es: ProgramDoc; readonly en: ProgramDoc };
  /**
   * A file editor (`code FILE`): Midnight Commander opens text files with it (F4, and Enter on one that is not a
   * program) on the hosts that have it, as mc with use_internal_edit off runs $EDITOR. It runs without a screen of its
   * own: it hands the file to its host page. Hosts with none keep mc's own editor and viewer.
   */
  readonly editor?: boolean;
  /** Whether a host has it; asked when its system is laid out (GNU/Linux) and on each use (Windows). */
  readonly applies: (host: Host) => boolean;
  /** Its exit status (0 when nothing is returned). */
  readonly run: (call: ProgramCall) => number | void;
}

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const defs = new Map<string, ProgramDef>();

const taken = (name: string): boolean => COREUTILS.has(name) || [...defs.values()].some((d) => d.name === name || (d.aliases ?? []).includes(name));

export function registerProgram(def: ProgramDef): void {
  const names = [def.name, ...(def.aliases ?? [])];
  for (const n of names) {
    if (!NAME_RE.test(n)) throw new Error(`Programa: nombre no válido «${n}»`);
    if (taken(n) || names.indexOf(n) !== names.lastIndexOf(n)) throw new Error(`El programa «${n}» ya existe`);
  }
  if (def.systems.length === 0) throw new Error(`Programa «${def.name}»: indica al menos un sistema`);
  defs.set(def.name, def);
  for (const n of names) registerExtensionDocs(n, { 'es-ES': def.doc.es, 'en-GB': def.doc.en });
}

/** The editor program (`editor`) a host has on one system, if any: the first registered. */
export function editorProgram(host: Host, system: ProgramSystem): ProgramDef | undefined {
  return programsOn(host, system).find((d) => d.editor === true);
}

/** The registered programs a host has on one system. */
export function programsOn(host: Host, system: ProgramSystem): ProgramDef[] {
  return [...defs.values()].filter((d) => d.systems.includes(system) && d.applies(host));
}

/** C:\ folder of a program (relative to C:\; its %PATH% entry). */
export function windowsDirOf(def: ProgramDef): string {
  return def.windowsDir ?? `Program Files/${def.name}`;
}

/** Runs a program and turns what it returns into an exit status. */
export function exitOf(def: ProgramDef, call: ProgramCall): number {
  const status = def.run(call);
  return typeof status === 'number' ? status : 0;
}

const readOrNull = (fs: Vfs, path: string, cred: Cred): string | null => {
  try {
    return fs.readFile(path, cred);
  } catch (e) {
    if (e instanceof FsError && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    throw e;
  }
};

/** The files of `fs` as `cred`, with paths resolved and shown as `system` does (Windows: C:\ is /mnt/c). */
export function userFiles(fs: Vfs, cred: Cred, system: ProgramSystem, home: string, cwd: string): HostFiles {
  const abs = (path: string): string => {
    if (system === 'linux') return normalize(path, cwd);
    const r = resolveWinPath(fs, cwd, path, cred);
    if (!r.ok) throw new FsError('ENOENT');
    return r.path;
  };
  const show = (linux: string): string => (system === 'linux' ? linux : toWindowsPath(linux));
  const kind = (path: string): 'file' | 'dir' | null => {
    const n = fs.tryLookup(abs(path), cred);
    return n ? (n.kind === 'dir' ? 'dir' : 'file') : null;
  };
  return {
    system, home: show(home), cwd: show(cwd),
    read: (path) => readOrNull(fs, abs(path), cred),
    write: (path, content) => { fs.writeFile(abs(path), content, cred); },
    list: (path) => {
      const dir = abs(path);
      return fs.readdir(dir, cred).map((name) => ({ name, kind: fs.tryLookup(`${dir === '/' ? '' : dir}/${name}`, cred)?.kind === 'dir' ? 'dir' as const : 'file' as const }));
    },
    kind,
    resolve: (path) => show(abs(path)),
  };
}
