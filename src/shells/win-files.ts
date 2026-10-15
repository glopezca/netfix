/**
 * File commands of the Windows terminal (cmd.exe) on the device's Linux file system, with the Linux permissions of
 * the account it runs as: cd, dir, md, rd, del, copy, move, ren, type, echo (with > and >>) and edit. rd /s, del of
 * a folder or *.* and overwriting with copy or move ask first, as cmd.exe does (/Q and /Y skip the question).
 */
import { basename, canAccess, dirname } from '../bash/vfs.ts';
import type { Vfs, Cred } from '../bash/vfs.ts';
import type { EditSpec } from '../bash/types.ts';
import { hasWildcard, resolveWinPath, toWindowsPath } from './win-path.ts';
import type { Redirect } from './win-path.ts';
import { DENIED, NO_DRIVE, NO_FILE, NO_PATH, SYNTAX, WinFs, fsMessage, inDir } from './win-fsctx.ts';
import type { Confirm } from './win-fsctx.ts';
import { dirCommand } from './win-dir.ts';
import { transfer } from './win-copy.ts';

const flag = (args: readonly string[], f: string): boolean => args.some((a) => a.toLowerCase() === f);

export class WinFiles {
  private readonly ctx: WinFs;
  /** The file `edit` opened (Linux path), until the editor closes. */
  editing: EditSpec | null = null;
  /** A question waiting for the next line. */
  pending: Confirm | null = null;

  constructor(fs: Vfs, cred: Cred, home: string) {
    this.ctx = new WinFs(fs, cred, fs.tryLookup(home, cred)?.kind === 'dir' ? home : '/');
  }

  get cwd(): string {
    return this.ctx.cwd;
  }

  prompt(): string {
    return this.pending ? this.pending.question : `${toWindowsPath(this.ctx.cwd)}>`;
  }

  /** The answer to a pending question (asked again until it is a yes or a no). */
  answer(line: string): string[] {
    const q = this.pending;
    if (!q) return [];
    if (q.accept.test(line)) { this.pending = null; return q.yes(); }
    if (/^\s*n/i.test(line)) { this.pending = null; return q.no(); }
    return [];
  }

  /** Runs a file command; null when `cmd` is not one of them. */
  run(cmd: string, args: readonly string[], text: string): string[] | null {
    switch (cmd) {
      case 'cd': case 'chdir': return this.cd(args);
      case 'dir': return dirCommand(this.ctx, args);
      case 'md': case 'mkdir': return this.each(args, (p, a) => this.md(p, a));
      case 'rd': case 'rmdir': return this.rd(args);
      case 'del': case 'erase': return this.del(args);
      case 'copy': return this.ask(transfer(this.ctx, args, false));
      case 'move': return this.ask(transfer(this.ctx, args, true));
      case 'ren': case 'rename': return this.ren(args);
      case 'type': return this.each(args, (p) => this.type(p));
      case 'echo': return [echoText(text)];
      case 'edit': return this.edit(args);
      default: return null;
    }
  }

  private ask(r: string[] | Confirm): string[] {
    if (Array.isArray(r)) return r;
    this.pending = r;
    return [];
  }

  /** Writes a command's output to the file of `> name` or `>> name` (nul discards it); returns what stays on screen. */
  redirect(r: Redirect, lines: readonly string[]): string[] {
    if (r.path.toLowerCase() === 'nul') return [];
    const p = resolveWinPath(this.ctx.fs, this.ctx.cwd, r.path, this.ctx.cred);
    if (!p.ok) return [NO_PATH];
    try {
      this.ctx.fs.writeFile(p.path, lines.length ? `${lines.join('\n')}\n` : '', this.ctx.cred, r.append);
      return [];
    } catch (err) {
      return [fsMessage(err, NO_PATH)];
    }
  }

  private each(args: readonly string[], fn: (path: string, input: string) => string[]): string[] {
    const names = args.filter((a) => !a.startsWith('/'));
    if (!names.length) return [SYNTAX];
    return names.flatMap((a) => {
      const p = this.ctx.path(a);
      return p === null ? [NO_DRIVE] : fn(p, a);
    });
  }

  private cd(args: readonly string[]): string[] {
    const ctx = this.ctx;
    const target = args.filter((a) => a.toLowerCase() !== '/d').join(' ');
    if (!target) return [toWindowsPath(ctx.cwd)];
    if (/^[A-Za-z]:$/.test(target)) return target.toUpperCase() === 'C:' ? [] : [NO_DRIVE];
    const p = ctx.path(target);
    if (p === null) return [NO_DRIVE];
    try {
      if (ctx.kindOf(p) !== 'dir') return [ctx.kindOf(p) ? 'The directory name is invalid.' : NO_PATH];
      ctx.fs.readdir(p, ctx.cred);
      ctx.cwd = ctx.fs.realpath(p);
      return [];
    } catch (err) {
      return [fsMessage(err, NO_PATH)];
    }
  }

  private md(p: string, input: string): string[] {
    if (this.ctx.kindOf(p)) return [`A subdirectory or file ${input} already exists.`];
    try {
      this.ctx.fs.mkdir(p, this.ctx.cred, true);
      return [];
    } catch (err) {
      return [fsMessage(err, NO_PATH)];
    }
  }

  private rd(args: readonly string[]): string[] {
    const ctx = this.ctx;
    const recursive = flag(args, '/s');
    const [input] = args.filter((a) => !a.startsWith('/'));
    if (!input) return [SYNTAX];
    const p = ctx.path(input);
    if (p === null) return [NO_DRIVE];
    if (ctx.kindOf(p) !== 'dir') return [ctx.kindOf(p) ? 'The directory name is invalid.' : NO_FILE];
    if (p === ctx.cwd || ctx.cwd.startsWith(`${p}/`)) return ['The process cannot access the file because it is being used by another process.'];
    const go = (): string[] => {
      try {
        ctx.fs.remove(p, ctx.cred, recursive, true);
        return [];
      } catch (err) {
        return [fsMessage(err)];
      }
    };
    if (!recursive || flag(args, '/q')) return go();
    return this.ask({ question: `${input}, Are you sure (Y/N)? `, accept: /^\s*y/i, yes: go, no: () => [] });
  }

  /** del: files only; a folder name or *.* asks first and deletes the files in it. */
  private del(args: readonly string[]): string[] {
    const ctx = this.ctx;
    const [input] = args.filter((a) => !a.startsWith('/'));
    if (!input) return [SYNTAX];
    const p = ctx.path(input);
    if (p === null) return [NO_DRIVE];
    const folder = ctx.kindOf(p) === 'dir';
    const found = ctx.listing(input);
    if (typeof found === 'string') return [`Could Not Find ${toWindowsPath(p)}`];
    const files = found.names.map((n) => inDir(found.dir, n)).filter((f) => ctx.fs.tryLookup(f, ctx.cred, false) && ctx.kindOf(f) !== 'dir');
    const go = (): string[] => files.flatMap((f) => {
      try {
        ctx.fs.remove(f, ctx.cred);
        return [];
      } catch (err) {
        return [toWindowsPath(f), fsMessage(err)];
      }
    });
    const everything = folder || /^\*(\.\*)?$/.test(basename(p));
    if (!everything || flag(args, '/q')) return files.length || !hasWildcard(basename(p)) ? go() : [`Could Not Find ${toWindowsPath(p)}`];
    return this.ask({ question: `${toWindowsPath(found.dir)}\\*, Are you sure (Y/N)? `, accept: /^\s*y/i, yes: go, no: () => [] });
  }

  private ren(args: readonly string[]): string[] {
    const ctx = this.ctx;
    const [src, name] = args;
    if (!src || !name || /[\\/:*?]/.test(name)) return [SYNTAX];
    const p = ctx.path(src);
    if (p === null) return [NO_DRIVE];
    if (!ctx.fs.tryLookup(p, ctx.cred, false)) return [NO_FILE];
    const target = ctx.path(`${toWindowsPath(dirname(p))}\\${name}`);
    if (target === null) return [SYNTAX];
    const same = ctx.fs.tryLookup(target, ctx.cred, false) && ctx.fs.realpath(target) === ctx.fs.realpath(p);
    if (ctx.fs.tryLookup(target, ctx.cred, false) && !same) return ['A duplicate file name exists, or the file cannot be found.'];
    try {
      ctx.fs.rename(p, inDir(dirname(p), name), ctx.cred);
      return [];
    } catch (err) {
      return [fsMessage(err)];
    }
  }

  private type(p: string): string[] {
    if (this.ctx.kindOf(p) === 'dir') return [DENIED];
    try {
      const content = this.ctx.fs.readFile(p, this.ctx.cred);
      return content === '' ? [] : content.replace(/\n$/, '').split('\n');
    } catch (err) {
      return [fsMessage(err)];
    }
  }

  /** edit file: the full-screen editor on the file (read-only when the account cannot write it). */
  private edit(args: readonly string[]): string[] {
    const ctx = this.ctx;
    const name = args.find((a) => !a.startsWith('/'));
    if (!name) return [SYNTAX];
    const p = ctx.path(name);
    if (p === null) return [NO_DRIVE];
    if (ctx.kindOf(p) === 'dir') return [DENIED];
    const exists = ctx.kindOf(p) === 'file';
    let content = '';
    try {
      if (exists) content = ctx.fs.readFile(p, ctx.cred);
    } catch (err) {
      return [fsMessage(err)];
    }
    this.editing = { editor: 'msedit', path: p, content, exists, readOnly: !this.writable(p, exists) };
    return [];
  }

  private writable(p: string, exists: boolean): boolean {
    const node = this.ctx.fs.tryLookup(exists ? p : dirname(p), this.ctx.cred);
    if (!node || !canAccess(node, this.ctx.cred, 2)) return false;
    return !(node.kind === 'file' && node.generated && !node.writeBack);
  }

  /** Saves the file `edit` opened (only that one: the permissions of the account apply). */
  saveEdit(path: string, content: string): string | null {
    if (path !== this.editing?.path) return 'No editor is open for that file';
    try {
      this.ctx.fs.writeFile(path, content, this.ctx.cred);
      return null;
    } catch (err) {
      return fsMessage(err);
    }
  }
}

/** echo prints the rest of the line as typed (echo. a blank line); alone it reports the echo state. */
export function echoText(text: string): string {
  const rest = text.replace(/^\s*echo/i, '');
  if (/^[.:(]/.test(rest)) return rest.slice(1);
  return rest.trim() === '' ? 'ECHO is on.' : rest.slice(1);
}
