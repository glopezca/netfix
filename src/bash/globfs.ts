/** Pathname expansion over the virtual file system (with globstar, dotglob and GLOBSORT). */
import type { Cred, Vfs } from './vfs.ts';
import { normalize } from './vfs.ts';
import { hasGlob, matchPattern, unescapePattern } from './glob.ts';

export interface GlobFsOptions {
  readonly dotglob: boolean;
  readonly nocaseglob: boolean;
  readonly globstar: boolean;
  /** bash 5.3 GLOBSORT: name, size, mtime, atime, ctime, blocks, numeric, none; "-" reverses. */
  readonly sort: string;
}

const MAX_MATCHES = 20_000;

function splitSegments(pattern: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? '';
    if (c === '\\') { cur += c + (pattern[i + 1] ?? ''); i++; continue; }
    if (c === '/') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function globPaths(fs: Vfs, cred: Cred, cwd: string, pattern: string, opts: GlobFsOptions): string[] {
  const absolute = pattern.startsWith('/');
  const segs = splitSegments(absolute ? pattern.slice(1) : pattern);
  let paths: string[] = [''];
  segs.forEach((seg, idx) => {
    const last = idx === segs.length - 1;
    if (seg === '') {
      paths = paths.map((p) => `${p}/`);
      return;
    }
    const next: string[] = [];
    for (const prefix of paths) {
      const dir = normalize(prefix === '' ? '.' : prefix, absolute ? '/' : cwd);
      if (seg === '**' && opts.globstar) next.push(...starStar(fs, cred, dir, prefix, last, opts));
      else if (!hasGlob(seg)) {
        const name = unescapePattern(seg);
        const candidate = join(prefix, name);
        if (fs.tryLookup(normalize(candidate, absolute ? '/' : cwd), cred) || (!last && name === '..')) next.push(candidate);
      } else next.push(...matchDir(fs, cred, dir, seg, opts).map((n) => join(prefix, n)));
      if (next.length > MAX_MATCHES) break;
    }
    paths = last ? next : next.filter((p) => isDir(fs, cred, normalize(p, absolute ? '/' : cwd)));
  });
  const results = paths.map((p) => (absolute ? `/${p}` : p)).map((p) => p.replace(/\/{2,}/g, '/'));
  return sortResults(fs, cwd, results, opts.sort);
}

function join(prefix: string, name: string): string {
  return prefix === '' ? name : prefix.endsWith('/') ? prefix + name : `${prefix}/${name}`;
}

function isDir(fs: Vfs, cred: Cred, path: string): boolean {
  return fs.tryLookup(path, cred)?.kind === 'dir';
}

function matchDir(fs: Vfs, cred: Cred, dir: string, seg: string, opts: GlobFsOptions): string[] {
  let names: string[];
  try {
    names = fs.readdir(dir, cred);
  } catch {
    return [];
  }
  const explicitDot = seg.startsWith('.') || seg.startsWith('\\.');
  return names.filter((n) => (explicitDot || opts.dotglob || !n.startsWith('.')) && matchPattern(seg, n, { pathname: true, nocase: opts.nocaseglob }));
}

/** `**`: zero or more directories (and files when it is the last segment). */
function starStar(fs: Vfs, cred: Cred, dir: string, prefix: string, last: boolean, opts: GlobFsOptions): string[] {
  const out: string[] = last ? [] : [prefix];
  const walk = (abs: string, rel: string, depth: number): void => {
    if (depth > 32 || out.length > MAX_MATCHES) return;
    let names: string[] = [];
    try { names = fs.readdir(abs, cred); } catch { return; }
    for (const n of names) {
      if (!opts.dotglob && n.startsWith('.')) continue;
      const childRel = join(rel, n);
      const childAbs = normalize(n, abs);
      const directory = isDir(fs, cred, childAbs);
      if (last || directory) out.push(directory && !last ? `${childRel}` : childRel);
      if (directory && fs.tryLookup(childAbs, cred, false)?.kind !== 'link') walk(childAbs, childRel, depth + 1);
    }
  };
  walk(dir, prefix, 0);
  return out;
}

function sortResults(fs: Vfs, cwd: string, paths: string[], spec: string): string[] {
  const reverse = spec.startsWith('-');
  const key = (reverse || spec.startsWith('+') ? spec.slice(1) : spec) || 'name';
  if (key === 'none') return paths;
  const stat = (p: string): { size: number; mtime: number } => {
    try { return fs.stat(normalize(p, cwd)); } catch { return { size: 0, mtime: 0 }; }
  };
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const cmp: (a: string, b: string) => number =
    key === 'size' || key === 'blocks' ? (a, b) => stat(a).size - stat(b).size || byName(a, b)
      : key === 'mtime' || key === 'atime' || key === 'ctime' ? (a, b) => stat(a).mtime - stat(b).mtime || byName(a, b)
        : key === 'numeric' ? (a, b) => (Number(/\d+/.exec(a)?.[0] ?? NaN) - Number(/\d+/.exec(b)?.[0] ?? NaN)) || byName(a, b)
          : byName;
  const sorted = [...paths].sort(cmp);
  return reverse ? sorted.reverse() : sorted;
}
