/**
 * The Windows terminal works on the Linux file system of the same device: drive C:\ is the root /, folders are
 * separated by \ (or /) and names are matched without regard to case, as on Windows. Also the cmd.exe command
 * line (quotes and > / >> redirection) and its * ? wildcards.
 */
import type { Vfs, Cred } from '../bash/vfs.ts';

export interface Redirect {
  readonly path: string;
  readonly append: boolean;
}

export interface CmdLine {
  readonly words: readonly string[];
  readonly redirect: Redirect | null;
  /** The line without the redirection (echo prints it as typed). */
  readonly text: string;
  /** A > without a file name. */
  readonly error: boolean;
}

export type WinResolve = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: 'drive' };

/** C:\home\alumno for /home/alumno. */
export function toWindowsPath(linux: string): string {
  return `C:\\${linux.split('/').filter(Boolean).join('\\')}`;
}

/**
 * Words (double quotes group and are removed) and the last > or >> outside quotes, followed by its file name
 * (`nul` discards the output; `2>` sends errors, which are not told apart here, so it is ignored). A > with no
 * file name is a syntax error.
 */
export function splitCmdLine(line: string): CmdLine {
  const words: string[] = [];
  let word: string | null = null;
  let quoted = false;
  let redirect: { path: string; append: boolean; stderr: boolean } | null = null;
  let target = false;
  let missing = false;
  let text = '';
  const flush = (): void => {
    if (word === null) return;
    if (target && redirect) { redirect.path = word; target = false; } else words.push(word);
    word = null;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (ch === '"') { quoted = !quoted; word ??= ''; if (!target) text += ch; continue; }
    if (!quoted && ch === '>') {
      const stderr = word === '2' && !/\s/.test(line[i - 1] ?? ' ') && (i < 2 || /\s/.test(line[i - 2] ?? ' '));
      if (stderr) { word = null; text = text.slice(0, -1); } else flush();
      if (target) missing = true;
      const append = line[i + 1] === '>';
      if (append) i++;
      redirect = { path: '', append, stderr };
      target = true;
      continue;
    }
    if (!quoted && /\s/.test(ch)) { flush(); if (!target) text += ch; continue; }
    word = (word ?? '') + ch;
    if (!target) text += ch;
  }
  flush();
  if (redirect && (!redirect.path || missing)) return { words, redirect: null, text, error: true };
  const out = redirect && !redirect.stderr ? { path: redirect.path, append: redirect.append } : null;
  return { words, redirect: out, text, error: false };
}

/**
 * cmd.exe wildcards: * any run of characters, ? one character, case-insensitive; *.* is every name and a final .*
 * also matches names without a dot. Linear backtracking on the last *, never exponential.
 */
export function wildMatch(pattern: string, name: string): boolean {
  if (pattern === '*.*') return true;
  if (pattern.endsWith('.*') && glob(pattern.slice(0, -2).toLowerCase(), name.toLowerCase())) return true;
  return glob(pattern.toLowerCase(), name.toLowerCase());
}

function glob(p: string, s: string): boolean {
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && (p[i] === '?' || p[i] === s[j])) { i++; j++; } else if (i < p.length && p[i] === '*') { star = i++; mark = j; } else if (star >= 0) { i = star + 1; j = ++mark; } else return false;
  }
  while (p[i] === '*') i++;
  return i === p.length;
}

export function hasWildcard(name: string): boolean {
  return /[*?]/.test(name);
}

/** The entry of `dir` whose name matches `name` exactly or, failing that, without regard to case. */
function matchEntry(fs: Vfs, dir: string, name: string, cred: Cred): string {
  if (fs.tryLookup(`${dir === '/' ? '' : dir}/${name}`, cred)) return name;
  try {
    return fs.readdir(dir, cred).find((n) => n.toLowerCase() === name.toLowerCase()) ?? name;
  } catch {
    return name;
  }
}

/** Linux path of a Windows path typed in the folder `cwd` (a Linux path). */
export function resolveWinPath(fs: Vfs, cwd: string, input: string, cred: Cred): WinResolve {
  let rest = input.replace(/\//g, '\\');
  let parts: string[] = rest.startsWith('\\') ? [] : cwd.split('/').filter(Boolean);
  const drive = /^([A-Za-z]):(.*)$/.exec(rest);
  if (drive) {
    if ((drive[1] ?? '').toUpperCase() !== 'C') return { ok: false, error: 'drive' };
    rest = drive[2] ?? '';
    // "C:" alone or "C:name" is relative to the current folder of the drive, as in cmd.exe.
    parts = rest.startsWith('\\') ? [] : cwd.split('/').filter(Boolean);
  }
  for (const seg of rest.split('\\')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    const dir = `/${parts.join('/')}`;
    parts.push(matchEntry(fs, dir, seg.replace(/[. ]+$/, '') || seg, cred));
  }
  return { ok: true, path: `/${parts.join('/')}` };
}
