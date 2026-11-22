/**
 * Extensions' programs on Windows (shells/programs.ts): <name>.exe in its folder of C:\, that folder in %PATH%, and the
 * terminal running it with or without .exe while the file is there (as Git's vim.exe). Laid out with the disk.
 */
import type { Host } from '../devices/host.ts';
import type { Vfs } from '../bash/vfs.ts';
import { BINARY_MARK } from '../bash/path.ts';
import { WIN_ROOT } from './win-path.ts';
import { WIN_PATH } from './win-system.ts';
import type { WinFs } from './win-fsctx.ts';
import { exitOf, programsOn, userFiles, windowsDirOf, type ProgramDef } from './programs.ts';

const dirOf = (def: ProgramDef): string => `${WIN_ROOT}/${windowsDirOf(def)}`;
const exeOf = (def: ProgramDef, name = def.name): string => `${dirOf(def)}/${name}.exe`;

/** Each program the host has: its folders and its .exe (what is there already is kept). */
export function seedWindowsPrograms(fs: Vfs, host: Host): void {
  for (const def of programsOn(host, 'windows')) {
    let path = WIN_ROOT;
    for (const part of windowsDirOf(def).split('/')) {
      path = `${path}/${part}`;
      if (!fs.tryLookup(path, undefined, false)) fs.seed(path, { kind: 'dir' }, 0o755);
    }
    for (const name of [def.name, ...(def.aliases ?? [])]) {
      if (!fs.tryLookup(exeOf(def, name), undefined, false)) fs.seed(exeOf(def, name), { kind: 'file', content: `${BINARY_MARK}${def.name}\n` }, 0o755);
    }
  }
}

/** %PATH%: Windows' and Git's folders, then each program's. */
export function windowsPathFor(host: Host): string {
  const extra = programsOn(host, 'windows').map((d) => `C:\\${windowsDirOf(d).replace(/\//g, '\\')}`);
  return [WIN_PATH, ...extra].join(';');
}

/** Runs `name` (or name.exe) when the host has it and its .exe is there; null when it is not one of them. */
export function runWindowsProgram(host: Host, name: string, args: readonly string[], w: WinFs, user: string, home: string): string[] | null {
  const called = name.replace(/\.exe$/i, '');
  const def = programsOn(host, 'windows').find((d) => called === d.name || (d.aliases ?? []).includes(called));
  if (!def || w.kindOf(exeOf(def, called)) !== 'file') return null;
  let text = '';
  const files = userFiles(w.fs, w.cred, 'windows', home, w.cwd);
  exitOf(def, { host, system: 'windows', argv: [name, ...args], user, cwd: files.cwd, files, out: (t) => { text += t; }, err: (t) => { text += t; } });
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
