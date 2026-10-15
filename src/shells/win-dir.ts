/** dir of the Windows terminal, in cmd.exe's format, over the Linux file system. */
import { MAX_TOTAL } from '../bash/vfs.ts';
import { toWindowsPath } from './win-path.ts';
import { inDir } from './win-fsctx.ts';
import type { WinFs } from './win-fsctx.ts';

const SERIAL = '4E37-1F0A';
const HEAD = [' Volume in drive C has no label.', ` Volume Serial Number is ${SERIAL}`, ''];

const twoDigits = (n: number): string => String(n).padStart(2, '0');
const thousands = (n: number): string => n.toLocaleString('en-US');

/** 10/15/2026  02:55 PM (the date column of dir). */
function dirDate(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  return `${twoDigits(d.getUTCMonth() + 1)}/${twoDigits(d.getUTCDate())}/${d.getUTCFullYear()}  ${twoDigits(h % 12 || 12)}:${twoDigits(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

interface Row {
  readonly text: string;
  readonly bytes: number | null;
}

/** One line of the listing; a link shows its target, a broken or forbidden one does not stop the listing. */
function row(ctx: WinFs, path: string, name: string): Row {
  const fs = ctx.fs;
  try {
    const own = fs.stat(path, ctx.cred, false);
    if (own.kind === 'link') {
      const node = fs.lookup(path, ctx.cred, false);
      const target = node.kind === 'link' ? node.target : '';
      const tag = ctx.kindOf(path) === 'dir' ? '<SYMLINKD>' : '<SYMLINK> ';
      return { text: `${dirDate(own.mtime)}    ${tag}     ${name} [${target}]`, bytes: null };
    }
    if (own.kind === 'dir') return { text: `${dirDate(own.mtime)}    <DIR>          ${name}`, bytes: null };
    return { text: `${dirDate(own.mtime)} ${thousands(own.size).padStart(17)} ${name}`, bytes: own.size };
  } catch {
    return { text: `${' '.repeat(20)}    <?>            ${name}`, bytes: null };
  }
}

export function dirCommand(ctx: WinFs, args: readonly string[]): string[] {
  const bare = args.some((a) => a.toLowerCase() === '/b');
  const input = args.find((a) => !a.startsWith('/')) ?? '';
  const found = ctx.listing(input);
  if (typeof found === 'string') {
    if (bare) return [found];
    const where = ctx.path(input || '.');
    const folder = where && ctx.kindOf(where) !== 'dir' ? where.replace(/\/[^/]*$/, '') || '/' : where ?? ctx.cwd;
    return [...HEAD, ` Directory of ${toWindowsPath(folder)}`, '', found];
  }
  if (bare) return [...found.names];
  const dots = found.whole && found.dir !== '/' ? [row(ctx, found.dir, '.'), row(ctx, found.dir.replace(/\/[^/]*$/, '') || '/', '..')] : [];
  const rows = [...dots, ...found.names.map((n) => row(ctx, inDir(found.dir, n), n))];
  const files = rows.filter((r) => r.bytes !== null);
  const bytes = files.reduce((n, r) => n + (r.bytes ?? 0), 0);
  return [...HEAD, ` Directory of ${toWindowsPath(found.dir)}`, '', ...rows.map((r) => r.text),
    `${String(files.length).padStart(16)} File(s) ${thousands(bytes).padStart(14)} bytes`,
    `${String(rows.length - files.length).padStart(16)} Dir(s) ${thousands(Math.max(0, MAX_TOTAL - ctx.fs.usedBytes)).padStart(15)} bytes free`];
}
