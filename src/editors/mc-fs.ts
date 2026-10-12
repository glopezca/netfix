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
}

export function joinPath(dir: string, name: string): string {
  if (name === '..') return dir === '/' ? '/' : dir.replace(/\/[^/]*$/, '') || '/';
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

export function shortPath(path: string, home: string): string {
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
