/** What the cmd.exe file commands share: the account's view of the Linux file system, cmd's messages and listings. */
import { FsError, basename, dirname } from '../bash/vfs.ts';
import type { Vfs, Cred } from '../bash/vfs.ts';
import { hasWildcard, resolveWinPath, wildMatch } from './win-path.ts';

export const NO_PATH = 'The system cannot find the path specified.';
export const NO_FILE = 'The system cannot find the file specified.';
export const NO_DRIVE = 'The system cannot find the drive specified.';
export const SYNTAX = 'The syntax of the command is incorrect.';
export const DENIED = 'Access is denied.';
export const NOT_FOUND = 'File Not Found';

/** cmd.exe wording for a file-system error (anything else is a bug and is not hidden). */
export function fsMessage(err: unknown, notFound = NO_FILE): string {
  if (!(err instanceof FsError)) throw err;
  switch (err.code) {
    case 'ENOENT': case 'ENOTDIR': return notFound;
    case 'ENOTEMPTY': return 'The directory is not empty.';
    case 'ENOSPC': case 'EFBIG': return 'There is not enough space on the disk.';
    case 'EINVAL': return 'The parameter is incorrect.';
    default: return DENIED;
  }
}

export const inDir = (dir: string, name: string): string => `${dir === '/' ? '' : dir}/${name}`;

/** A question of cmd.exe waiting for the next line (Are you sure (Y/N)?, Overwrite …?). */
export interface Confirm {
  readonly question: string;
  /** Answer that runs the action (Y, or Y/A for Overwrite). */
  readonly accept: RegExp;
  readonly yes: () => string[];
  readonly no: () => string[];
}

/** The folder and entries a command works on: a whole folder, a wildcard or one entry. */
export interface Listing {
  readonly dir: string;
  readonly names: readonly string[];
  /** A whole folder (dir shows . and .. then). */
  readonly whole: boolean;
}

/** The file system as the terminal's account sees it, from its current folder. */
export class WinFs {
  readonly fs: Vfs;
  readonly cred: Cred;
  cwd: string;

  constructor(fs: Vfs, cred: Cred, cwd: string) {
    this.fs = fs;
    this.cred = cred;
    this.cwd = cwd;
  }

  /** Linux path of a Windows path, or null for another drive. */
  path(input: string): string | null {
    const p = resolveWinPath(this.fs, this.cwd, input, this.cred);
    return p.ok ? p.path : null;
  }

  kindOf(path: string): 'file' | 'dir' | null {
    const n = this.fs.tryLookup(path, this.cred);
    return n ? (n.kind === 'dir' ? 'dir' : 'file') : null;
  }

  /** The entries `input` names: a folder's contents, the matches of a wildcard or a single entry. */
  listing(input: string): Listing | string {
    const p = this.path(input || '.');
    if (p === null) return NO_DRIVE;
    const last = basename(p);
    const pattern = hasWildcard(last) ? last : null;
    const dir = pattern ? dirname(p) : p;
    try {
      if (!pattern && this.fs.tryLookup(p, this.cred, false) && this.kindOf(p) !== 'dir') return { dir: dirname(p), names: [basename(p)], whole: false };
      if (this.kindOf(dir) !== 'dir') return NOT_FOUND;
      const names = this.fs.readdir(dir, this.cred).filter((n) => !pattern || wildMatch(pattern, n));
      if (pattern && !names.length) return NOT_FOUND;
      return { dir, names, whole: !pattern };
    } catch (err) {
      return fsMessage(err, NOT_FOUND);
    }
  }
}
