/** What Midnight Commander needs from the file system (the shell provides it with the user's credentials). */

export interface McEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly link: boolean;
  readonly exec: boolean;
  readonly size: number;
  readonly mtime: number;
}

/** Every operation returns an error message (as mc shows it) or null. */
export interface McFs {
  readonly home: string;
  list(dir: string): McEntry[] | string;
  read(path: string): string | { readonly error: string };
  write(path: string, content: string): string | null;
  copy(sources: readonly string[], target: string): string | null;
  move(sources: readonly string[], target: string): string | null;
  remove(paths: readonly string[]): string | null;
  mkdir(path: string): string | null;
  /** The prompt of the shell, shown on mc's command line. */
  prompt(dir: string): string;
  /** The top folder, with no ".." above it (GNU/Linux: /; Windows: C:\). */
  readonly root?: string;
  /** How a path is shown (title, dialogs, viewer); GNU/Linux: ~ for the home folder. */
  show?(path: string): string;
  /** Opens a file in the host's editor program (shells/programs.ts `editor`) instead of nano: an error or null. */
  edit?(path: string): string | null;
  /** Runs a line typed on mc's command line in the shell, from folder `dir`: its output and the folder it ends in. */
  run?(line: string, dir: string): { readonly lines: readonly string[]; readonly dir: string };
  /** Windows (Git's mc.exe): its ini under %APPDATA% of `profile`; no chmod, chown nor links. */
  readonly windows?: boolean;
  /** The user's folder when `home` is not it (Windows: home is C:\\, the profile C:\\Users\\user). */
  readonly profile?: string;
  /** Runs a file utility (chmod, chown, ln…) with these arguments as the user: its error text or null. GNU/Linux only. */
  exec?(argv: readonly string[]): string | null;
  /** The path typed in a dialog, from folder `dir`; null when it cannot be reached (another drive). */
  parse?(text: string, dir: string): string | null;
}

export function joinPath(dir: string, name: string): string {
  if (name === '..') return dir === '/' ? '/' : dir.replace(/\/[^/]*$/, '') || '/';
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

export function shortPath(path: string, home: string): string {
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
