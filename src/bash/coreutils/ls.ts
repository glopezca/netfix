/** ls (GNU coreutils 9.4 behaviour: columns on a terminal, one per line otherwise, -l, colors). */
import type { Ctx, Gen } from '../types.ts';
import type { FsNode, StatInfo, Vfs } from '../vfs.ts';
import { normalize } from '../vfs.ts';
import { gnuOpts, usageError, q, errMsg } from './common.ts';
import { isTty } from '../io.ts';

const COLORS: Readonly<Record<string, string>> = { di: '01;34', ln: '01;36', ex: '01;32', tw: '30;42', ow: '34;42', st: '37;44', pi: '40;33', cd: '40;33;01' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HALF_YEAR_MS = 182.5 * 86_400_000;

interface Entry {
  readonly name: string;
  readonly path: string;
  readonly stat: StatInfo;
  readonly node: FsNode;
  readonly target?: string;
}

export function modeString(st: StatInfo): string {
  const type = st.kind === 'dir' ? 'd' : st.kind === 'link' ? 'l' : st.kind === 'dev' ? 'c' : '-';
  const m = st.mode;
  const bit = (b: number, c: string): string => (m & b ? c : '-');
  const x = (exec: number, special: number, on: string, off: string): string => (m & special ? (m & exec ? on : off) : bit(exec, 'x'));
  return type + bit(0o400, 'r') + bit(0o200, 'w') + x(0o100, 0o4000, 's', 'S') + bit(0o40, 'r') + bit(0o20, 'w') + x(0o10, 0o2000, 's', 'S') + bit(0o4, 'r') + bit(0o2, 'w') + x(0o1, 0o1000, 't', 'T');
}

export function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G', 'T'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : Math.ceil(v)}${units[u] ?? ''}`;
}

export function lsDate(ms: number, now: number): string {
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, ' ');
  const old = Math.abs(now - ms) > HALF_YEAR_MS;
  const tail = old ? ` ${d.getUTCFullYear()}` : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${MONTHS[d.getUTCMonth()] ?? ''} ${day} ${old ? tail.padStart(5) : tail}`;
}

function colorOf(e: Entry): string | undefined {
  const m = e.stat.mode;
  if (e.stat.kind === 'link') return COLORS.ln;
  if (e.stat.kind === 'dev') return COLORS.cd;
  if (e.stat.kind === 'dir') return m & 0o1000 && m & 0o2 ? COLORS.tw : m & 0o2 ? COLORS.ow : m & 0o1000 ? COLORS.st : COLORS.di;
  return m & 0o111 ? COLORS.ex : undefined;
}

function suffix(e: Entry, classify: boolean, slash: boolean): string {
  if (e.stat.kind === 'dir') return classify || slash ? '/' : '';
  if (!classify) return '';
  if (e.stat.kind === 'link') return '@';
  return e.stat.mode & 0o111 ? '*' : '';
}

/** Lays out names in columns (column-major), as GNU ls does for an 80-column terminal. */
export function columns(names: readonly string[], widths: readonly number[], width: number): string[] {
  if (!names.length) return [];
  for (let cols = Math.min(names.length, Math.max(1, Math.floor(width / 3))); cols >= 1; cols--) {
    const rows = Math.ceil(names.length / cols);
    const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...widths.slice(c * rows, (c + 1) * rows)));
    const total = colW.reduce((a, b) => a + b + 2, 0) - 2;
    if (total > width && cols > 1) continue;
    return Array.from({ length: rows }, (_, r) => {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const i = c * rows + r;
        if (i >= names.length) break;
        const last = c === cols - 1 || (c + 1) * rows + r >= names.length;
        line += last ? names[i] : (names[i] ?? '') + ' '.repeat((colW[c] ?? 0) - (widths[i] ?? 0) + 2);
      }
      return line;
    });
  }
  return [...names];
}

function owner(ctx: Ctx, uid: number, numeric: boolean): string {
  if (numeric) return String(uid);
  return ctx.sh.env.users().find((u) => u.uid === uid)?.name ?? String(uid);
}

function group(ctx: Ctx, gid: number, numeric: boolean): string {
  if (numeric) return String(gid);
  const special: Record<number, string> = { 0: 'root', 4: 'adm', 27: 'sudo', 33: 'www-data', 42: 'shadow', 100: 'users' };
  return special[gid] ?? ctx.sh.env.users().find((u) => u.gid === gid)?.name ?? String(gid);
}

function entry(fs: Vfs, ctx: Ctx, name: string, path: string): Entry {
  const node = fs.lookup(path, ctx.cred, false);
  const stat = fs.stat(path, ctx.cred, false);
  return { name, path, stat, node, target: node.kind === 'link' ? node.target : undefined };
}

interface LsOpts {
  readonly all: boolean;
  readonly almost: boolean;
  readonly long: boolean;
  readonly human: boolean;
  readonly one: boolean;
  readonly color: boolean;
  readonly classify: boolean;
  readonly slash: boolean;
  readonly numeric: boolean;
  readonly inode: boolean;
  readonly sort: 'name' | 'time' | 'size' | 'none';
  readonly reverse: boolean;
  readonly tty: boolean;
}

function sortEntries(list: Entry[], o: LsOpts): Entry[] {
  const byName = (a: Entry, b: Entry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const sorted = o.sort === 'none' ? list : [...list].sort(o.sort === 'time' ? (a, b) => b.stat.mtime - a.stat.mtime || byName(a, b) : o.sort === 'size' ? (a, b) => b.stat.size - a.stat.size || byName(a, b) : byName);
  return o.reverse ? sorted.reverse() : sorted;
}

function render(ctx: Ctx, list: Entry[], o: LsOpts): string[] {
  const paint = (e: Entry, text: string): string => {
    const c = o.color ? colorOf(e) : undefined;
    return c ? `\x1b[${c}m${text}\x1b[0m` : text;
  };
  const label = (e: Entry): string => paint(e, e.name) + suffix(e, o.classify, o.slash);
  if (o.long) {
    const now = ctx.sh.env.now();
    const rows = list.map((e) => ({ e, mode: modeString(e.stat), links: String(e.stat.kind === 'dir' ? 2 : 1), user: owner(ctx, e.stat.uid, o.numeric), grp: group(ctx, e.stat.gid, o.numeric), size: o.human ? humanSize(e.stat.size) : String(e.stat.size) }));
    const w = (k: 'links' | 'user' | 'grp' | 'size'): number => Math.max(0, ...rows.map((r) => r[k].length));
    return rows.map((r) => `${o.inode ? `${String(1000 + r.e.name.length).padStart(7)} ` : ''}${r.mode} ${r.links.padStart(w('links'))} ${r.user.padEnd(w('user'))} ${r.grp.padEnd(w('grp'))} ${r.size.padStart(w('size'))} ${lsDate(r.e.stat.mtime, now)} ${label(r.e)}${r.e.target !== undefined ? ` -> ${r.e.target}` : ''}`);
  }
  const names = list.map(label);
  if (o.one || !o.tty) return names;
  const widths = list.map((e) => Array.from(e.name).length + suffix(e, o.classify, o.slash).length);
  return columns(names, widths, Number(ctx.sh.getVar('COLUMNS') ?? 80) || 80);
}

function total(list: readonly Entry[], human: boolean): string {
  const blocks = list.reduce((s, e) => s + (e.stat.kind === 'file' ? Math.ceil(e.stat.size / 4096) * 4 : e.stat.kind === 'dir' ? 4 : 0), 0);
  return `total ${human && blocks >= 1024 ? humanSize(blocks * 1024) : blocks}`;
}

function listDir(ctx: Ctx, path: string, o: LsOpts): Entry[] {
  const fs = ctx.sh.env.fs;
  const names = fs.readdir(path, ctx.cred).filter((n) => o.all || o.almost || !n.startsWith('.'));
  const list = names.map((n) => entry(fs, ctx, n, normalize(n, path)));
  if (o.all) list.unshift(entry(fs, ctx, '.', path), entry(fs, ctx, '..', normalize('..', path)));
  return sortEntries(list, o);
}

export function* ls(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'aAlhR1dtSrFpniUc', long: { all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', directory: 'd', reverse: 'r', classify: 'F', 'color=': 'color', color: 'color', 'numeric-uid-gid': 'n', inode: 'i' } });
  if (p.error) return usageError(ctx, p.error, 2);
  const has = (c: string): boolean => p.opts.has(c);
  const tty = isTty(ctx.fds.get(1));
  const colorOpt = p.opts.get('color');
  const o: LsOpts = {
    all: has('a'), almost: has('A'), long: has('l') || has('n'), human: has('h'), one: has('1'), classify: has('F'), slash: has('p'), numeric: has('n'), inode: has('i'),
    color: colorOpt === true || colorOpt === 'always' || (colorOpt === 'auto' && tty), sort: has('U') ? 'none' : has('t') ? 'time' : has('S') ? 'size' : 'name', reverse: has('r'), tty,
  };
  const fs = ctx.sh.env.fs;
  const operands = p.operands.length ? p.operands : ['.'];
  let status = 0;
  const files: Entry[] = [];
  const dirs: { name: string; path: string }[] = [];
  for (const op of operands) {
    const path = ctx.resolve(op);
    try {
      const node = fs.lookup(path, ctx.cred, o.long && !op.endsWith('/'));
      if (node.kind === 'dir' && !has('d')) dirs.push({ name: op, path });
      else files.push(entry(fs, ctx, op, path));
    } catch (e) {
      ctx.err(`ls: cannot access ${q(op)}: ${errMsg(e)}\n`);
      status = 2;
    }
  }
  const out: string[] = render(ctx, sortEntries(files, o), o);
  const queue = sortEntries(dirs.map((d) => ({ ...d, stat: fs.stat(d.path), node: fs.lookup(d.path) })), o).map((d) => ({ name: d.name, path: d.path }));
  const header = operands.length > 1 || has('R') || files.length > 0;
  while (queue.length) {
    const d = queue.shift() as { name: string; path: string };
    if (out.length) out.push('');
    if (header) out.push(`${d.name}:`);
    try {
      const list = listDir(ctx, d.path, o);
      if (o.long) out.push(total(list, o.human));
      out.push(...render(ctx, list, o));
      if (has('R')) queue.unshift(...list.filter((e) => e.stat.kind === 'dir' && e.name !== '.' && e.name !== '..').map((e) => ({ name: d.name === '.' ? `./${e.name}` : `${d.name.replace(/\/$/, '')}/${e.name}`, path: e.path })));
    } catch (e) {
      ctx.err(`ls: cannot open directory ${q(d.name)}: ${errMsg(e)}\n`);
      status = 2;
    }
  }
  ctx.out(out.length ? `${out.join('\n')}\n` : '');
  return status;
}
