/** $PATH lookup and the placeholder executables of /usr/bin. */
import type { Interp } from './interp.ts';
import { canAccess, normalize } from './vfs.ts';

/** First line of the placeholder files in /usr/bin: the program is implemented by netsim. */
export const BINARY_MARK = '\u007fELF\u0002\u0001\u0001 netsim:';

export function programName(content: string): string | undefined {
  return content.startsWith(BINARY_MARK) ? content.slice(BINARY_MARK.length).split('\n')[0] : undefined;
}

/** Executable file for a name found through $PATH. */
export function findInPath(sh: Interp, name: string, pathVar?: string): string | undefined {
  const dirs = (pathVar ?? sh.getVar('PATH') ?? '/usr/bin:/bin').split(':');
  for (const d of dirs) {
    const path = normalize(name, d || sh.cwd);
    const node = sh.env.fs.tryLookup(path, sh.cred);
    if (node?.kind === 'file' && canAccess(node, sh.cred, 1)) return path;
  }
  return undefined;
}
