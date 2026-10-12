/** stat realpath readlink basename dirname mktemp du df file tree. */
import type { CommandFn, Ctx } from '../types.ts';
import type { StatInfo } from '../vfs.ts';
import { normalize, basename as base, dirname as dir } from '../vfs.ts';
import { gnuOpts, usageError, q, errMsg } from './common.ts';
import { modeString, humanSize } from './ls.ts';
import { strftime } from '../prompt.ts';

const KIND: Readonly<Record<string, string>> = { file: 'regular file', dir: 'directory', link: 'symbolic link', dev: 'character special file' };

function userName(ctx: Ctx, uid: number): string {
  return ctx.sh.env.users().find((u) => u.uid === uid)?.name ?? 'UNKNOWN';
}

function statFormat(ctx: Ctx, fmt: string, name: string, st: StatInfo): string {
  const time = strftime('%Y-%m-%d %H:%M:%S.000000000 +0000', st.mtime);
  return fmt.replace(/%([a-zA-Z%])/g, (m, c: string) => ({
    n: name, s: String(st.size), a: (st.mode & 0o7777).toString(8), A: modeString(st), U: userName(ctx, st.uid), u: String(st.uid), G: userName(ctx, st.gid), g: String(st.gid),
    F: KIND[st.kind] ?? 'file', y: time, Y: String(Math.floor(st.mtime / 1000)), h: st.kind === 'dir' ? '2' : '1', i: String(1000 + name.length), b: String(Math.ceil(st.size / 512)), '%': '%',
  } as Record<string, string>)[c] ?? m);
}

function stat(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'LtfF', withArg: 'c', long: { 'format=': 'c', dereference: 'L', 'printf=': 'printf' } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, 'missing operand');
  let status = 0;
  for (const f of p.operands) {
    try {
      const st = ctx.sh.env.fs.stat(ctx.resolve(f), ctx.cred, p.opts.has('L'));
      const fmt = p.opts.get('c') ?? p.opts.get('printf');
      if (typeof fmt === 'string') { ctx.out(`${statFormat(ctx, fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t'), f, st)}${p.opts.has('c') ? '\n' : ''}`); continue; }
      const node = st.kind === 'link' ? ctx.sh.env.fs.lookup(ctx.resolve(f), ctx.cred, false) : undefined;
      const time = strftime('%Y-%m-%d %H:%M:%S.000000000 +0000', st.mtime);
      ctx.out([
        `  File: ${f}${node?.kind === 'link' ? ` -> ${node.target}` : ''}`,
        `  Size: ${String(st.size).padEnd(10)}\tBlocks: ${String(Math.ceil(st.size / 4096) * 8).padEnd(10)} IO Block: 4096   ${KIND[st.kind] ?? 'file'}`,
        `Device: 8,1\tInode: ${String(1000 + f.length).padEnd(11)} Links: ${st.kind === 'dir' ? 2 : 1}`,
        `Access: (${(st.mode & 0o7777).toString(8).padStart(4, '0')}/${modeString(st)})  Uid: (${String(st.uid).padStart(5)}/${userName(ctx, st.uid).padStart(8)})   Gid: (${String(st.gid).padStart(5)}/${userName(ctx, st.gid).padStart(8)})`,
        `Access: ${time}`, `Modify: ${time}`, `Change: ${time}`, ' Birth: -', '',
      ].join('\n'));
    } catch (e) {
      ctx.err(`stat: cannot statx ${q(f)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function realpath(ctx: Ctx): number {
  const ops = ctx.argv.slice(1).filter((a) => !a.startsWith('-'));
  const must = ctx.argv.includes('-e');
  const logical = ctx.argv.some((a) => a === '-s' || a === '--strip' || a === '--no-symlinks');
  let status = 0;
  for (const f of ops) {
    const real = logical ? ctx.resolve(f) : ctx.sh.env.fs.realpath(ctx.resolve(f));
    if (!ctx.sh.env.fs.exists(dir(real)) || (must && !ctx.sh.env.fs.exists(real))) { ctx.err(`${ctx.argv[0] ?? 'realpath'}: ${f}: No such file or directory\n`); status = 1; continue; }
    ctx.out(`${real}\n`);
  }
  return status;
}

function readlink(ctx: Ctx): number {
  const canon = ctx.argv.some((a) => /^-[a-z]*[fem]/.test(a));
  const ops = ctx.argv.slice(1).filter((a) => !a.startsWith('-'));
  let status = 0;
  for (const f of ops) {
    if (canon) { ctx.out(`${ctx.sh.env.fs.realpath(ctx.resolve(f))}\n`); continue; }
    const node = ctx.sh.env.fs.tryLookup(ctx.resolve(f), ctx.cred, false);
    if (node?.kind !== 'link') { status = 1; continue; }
    ctx.out(`${node.target}\n`);
  }
  return status;
}

function basename(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'az', withArg: 's', long: { multiple: 'a', 'suffix=': 's', zero: 'z' }, posix: true });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, 'missing operand');
  const suffix = p.opts.get('s');
  const multiple = p.opts.has('a') || typeof suffix === 'string';
  const names = multiple ? p.operands : [p.operands[0] ?? ''];
  const sfx = typeof suffix === 'string' ? suffix : multiple ? '' : p.operands[1] ?? '';
  for (const n of names) {
    let b = n.replace(/\/+$/, '') === '' ? (n.startsWith('/') ? '/' : '') : base(n.replace(/\/+$/, '')).replace(/^\//, '');
    if (sfx && b.endsWith(sfx) && b !== sfx) b = b.slice(0, -sfx.length);
    ctx.out(`${b}\n`);
  }
  return 0;
}

function dirname(ctx: Ctx): number {
  const ops = ctx.argv.slice(1).filter((a) => a !== '--');
  if (!ops.length) return usageError(ctx, 'missing operand');
  for (const n of ops) {
    const t = n.replace(/\/+$/, '');
    ctx.out(`${!t.includes('/') ? (n.startsWith('/') ? '/' : '.') : t.slice(0, t.lastIndexOf('/')).replace(/\/+$/, '') || '/'}\n`);
  }
  return 0;
}

let tmpCounter = 0;
function mktemp(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'duqt', withArg: 'p', long: { directory: 'd', 'tmpdir=': 'p' } });
  if (p.error) return usageError(ctx, p.error);
  const template = p.operands[0] ?? 'tmp.XXXXXXXXXX';
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const name = template.replace(/X+$/, (x) => Array.from(x, (_, i) => chars[(ctx.sh.pid * 31 + ++tmpCounter * 17 + i * 7) % chars.length]).join(''));
  const dirOpt = p.opts.get('p');
  const path = template.includes('/') && !p.operands.length ? ctx.resolve(name) : normalize(name, typeof dirOpt === 'string' ? ctx.resolve(dirOpt) : p.operands.length && !p.opts.has('t') ? ctx.cwd : '/tmp');
  try {
    if (p.opts.has('d')) ctx.sh.env.fs.mkdir(path, ctx.cred, false, 0o700);
    else ctx.sh.env.fs.writeFile(path, '', ctx.cred, false, 0o600);
    ctx.out(`${path}\n`);
    return 0;
  } catch (e) {
    ctx.err(`mktemp: failed to create ${p.opts.has('d') ? 'directory' : 'file'} via template ${q(template)}: ${errMsg(e)}\n`);
    return 1;
  }
}

function sizeOf(ctx: Ctx, path: string): number {
  const fs = ctx.sh.env.fs;
  const node = fs.tryLookup(path, ctx.cred, false);
  if (!node) return 0;
  if (node.kind !== 'dir') return Math.ceil(fs.stat(path, ctx.cred, false).size / 4096) * 4;
  let total = 4;
  try {
    for (const n of fs.readdir(path, ctx.cred)) total += sizeOf(ctx, normalize(n, path));
  } catch {
    // unreadable directories count as empty
  }
  return total;
}

function du(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'shac', withArg: 'd', long: { summarize: 's', 'human-readable': 'h', 'max-depth=': 'd' } });
  if (p.error) return usageError(ctx, p.error);
  const fmt = (kb: number): string => (p.opts.has('h') ? humanSize(kb * 1024) : String(kb));
  let grand = 0;
  for (const f of p.operands.length ? p.operands : ['.']) {
    const path = ctx.resolve(f);
    if (!ctx.sh.env.fs.exists(path)) { ctx.err(`du: cannot access ${q(f)}: No such file or directory\n`); continue; }
    const walk = (abs: string, shown: string, depth: number): number => {
      const node = ctx.sh.env.fs.tryLookup(abs, ctx.cred, false);
      if (node?.kind !== 'dir') return sizeOf(ctx, abs);
      let sum = 4;
      for (const n of ctx.sh.env.fs.readdir(abs, ctx.cred)) sum += walk(normalize(n, abs), `${shown}/${n}`, depth + 1);
      if (!p.opts.has('s') && depth <= Number(p.opts.get('d') ?? Infinity)) ctx.out(`${fmt(sum)}\t${shown}\n`);
      return sum;
    };
    const total = walk(path, f, 0);
    if (p.opts.has('s')) ctx.out(`${fmt(total)}\t${f}\n`);
    grand += total;
  }
  if (p.opts.has('c')) ctx.out(`${fmt(grand)}\ttotal\n`);
  return 0;
}

function df(ctx: Ctx): number {
  const h = ctx.argv.some((a) => /^-[a-zA-Z]*h/.test(a));
  const used = Math.ceil(ctx.sh.env.fs.usedBytes / 1024) + 4_812_340;
  const size = 30_787_492;
  const v = (n: number): string => (h ? humanSize(n * 1024) : String(n));
  ctx.out(`${h ? 'Filesystem      Size  Used Avail Use% Mounted on' : 'Filesystem     1K-blocks    Used Available Use% Mounted on'}\n`);
  ctx.out(`${'/dev/sda1'.padEnd(h ? 14 : 14)} ${v(size).padStart(h ? 5 : 9)} ${v(used).padStart(h ? 5 : 7)} ${v(size - used).padStart(h ? 5 : 9)} ${String(Math.round((used * 100) / size)).padStart(3)}% /\n`);
  ctx.out(`${'tmpfs'.padEnd(14)} ${v(1_007_424).padStart(h ? 5 : 9)} ${v(0).padStart(h ? 5 : 7)} ${v(1_007_424).padStart(h ? 5 : 9)}   0% /dev/shm\n`);
  return 0;
}

function file(ctx: Ctx): number {
  let status = 0;
  for (const f of ctx.argv.slice(1).filter((a) => !a.startsWith('-'))) {
    const node = ctx.sh.env.fs.tryLookup(ctx.resolve(f), ctx.cred, false);
    if (!node) { ctx.out(`${f}: cannot open \`${f}' (No such file or directory)\n`); status = 1; continue; }
    if (node.kind === 'dir') { ctx.out(`${f}: directory\n`); continue; }
    if (node.kind === 'link') { ctx.out(`${f}: symbolic link to ${node.target}\n`); continue; }
    if (node.kind === 'dev') { ctx.out(`${f}: character special\n`); continue; }
    const text = ctx.sh.env.fs.readFile(ctx.resolve(f), ctx.cred);
    const kind = text.startsWith('\u007fELF') ? 'ELF 64-bit LSB pie executable, x86-64, dynamically linked, stripped'
      : text === '' ? 'empty' : /^#!.*\b(ba)?sh\b/.test(text) ? 'Bourne-Again shell script, ASCII text executable'
        : /^\s*<(!doctype html|html)/i.test(text) ? 'HTML document, ASCII text' : /^\s*[{[]/.test(text) ? 'JSON text data'
          : /[^\x00-\x7f]/.test(text) ? 'Unicode text, UTF-8 text' : 'ASCII text';
    const noEol = / text/.test(kind) && !text.endsWith('\n') ? ', with no line terminators' : '';
    ctx.out(`${f}: ${kind}${noEol}\n`);
  }
  return status;
}

export const FILEINFO: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['stat', stat], ['realpath', realpath], ['readlink', readlink], ['basename', basename], ['dirname', dirname], ['mktemp', mktemp],
  ['du', du], ['df', df], ['file', file],
]);
