/** File utilities: cat touch mkdir rmdir rm cp mv ln chmod chown chgrp. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { normalize, basename as base, FsError } from '../vfs.ts';
import { gnuOpts, usageError, q, lq, errMsg, readInputs } from './common.ts';

function* cat(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'nbsEATve', long: { number: 'n', 'number-nonblank': 'b', 'squeeze-blank': 's', 'show-ends': 'E', 'show-all': 'A', 'show-tabs': 'T' } });
  if (p.error) return usageError(ctx, p.error);
  const has = (c: string): boolean => p.opts.has(c);
  const plain = !['n', 'b', 's', 'E', 'A', 'T', 'v', 'e'].some(has);
  if (plain && !p.operands.length && ctx.fds.get(0)?.read?.kind === 'tty') {
    // cat on the terminal echoes every line as it is typed, until Ctrl+D
    for (let line = yield* ctx.readLine(); line; line = yield* ctx.readLine()) ctx.out(line.eof ? line.text : `${line.text}\n`);
    return 0;
  }
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  let text = inputs.map((i) => i.text).join('');
  if (plain) { ctx.out(text); return failed ? 1 : 0; }
  let n = 0;
  let blankRun = false;
  const parts = text.split('\n');
  const endsNl = text.endsWith('\n');
  if (endsNl) parts.pop();
  const out: string[] = [];
  for (const raw of parts) {
    if (has('s') && raw === '' && blankRun) continue;
    blankRun = raw === '';
    let l = raw;
    if (has('T') || has('A')) l = l.replace(/\t/g, '^I');
    if (has('E') || has('A') || has('e')) l += '$';
    if (has('b') ? raw !== '' : has('n')) l = `${String(++n).padStart(6)}\t${l}`;
    out.push(l);
  }
  text = out.join('\n') + (endsNl ? '\n' : '');
  ctx.out(text);
  return failed ? 1 : 0;
}

function touch(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'acmh', withArg: 'dtr', long: { 'no-create': 'c', 'date=': 'd' } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, 'missing file operand');
  let status = 0;
  for (const f of p.operands) {
    const path = ctx.resolve(f);
    if (p.opts.has('c') && !ctx.sh.env.fs.exists(path)) continue;
    try {
      ctx.sh.env.fs.touch(path, ctx.cred, 0o666 & ~ctx.sh.umask);
    } catch (e) {
      ctx.err(`touch: cannot touch ${q(f)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

export function parseMode(spec: string, current: number, isDir: boolean, umask = 0o022): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = current;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([-+=])([rwxXst]*|[ugo])$/.exec(clause);
    if (!m) return null;
    const who = m[1] || 'a';
    const mask = (who.includes('a') ? 0o7777 : 0) | (who.includes('u') ? 0o4700 : 0) | (who.includes('g') ? 0o2070 : 0) | (who.includes('o') ? 0o1007 : 0);
    let bits = 0;
    for (const c of m[3] ?? '') {
      if (c === 'r') bits |= 0o444;
      else if (c === 'w') bits |= 0o222;
      else if (c === 'x' || (c === 'X' && (isDir || current & 0o111))) bits |= 0o111;
      else if (c === 's') bits |= 0o6000;
      else if (c === 't') bits |= 0o1000;
    }
    bits &= mask;
    if (!m[1] && m[2] !== '=') bits &= ~umask;
    if (m[2] === '+') mode |= bits;
    else if (m[2] === '-') mode &= ~bits;
    else mode = (mode & ~mask) | bits;
  }
  return mode;
}

function mkdir(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'pv', withArg: 'm', long: { parents: 'p', verbose: 'v', 'mode=': 'm' } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, 'missing operand');
  const fs = ctx.sh.env.fs;
  let status = 0;
  for (const d of p.operands) {
    const path = ctx.resolve(d);
    try {
      fs.mkdir(path, ctx.cred, p.opts.has('p'), 0o777 & ~ctx.sh.umask);
      const m = p.opts.get('m');
      if (typeof m === 'string') fs.chmod(path, parseMode(m, 0o755, true) ?? 0o755, ctx.cred);
      if (p.opts.has('v')) ctx.out(`mkdir: created directory ${q(d)}\n`);
    } catch (e) {
      ctx.err(`mkdir: cannot create directory ${lq(d)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function rmdir(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'pv', long: { parents: 'p', verbose: 'v', 'ignore-fail-on-non-empty': 'ignore' } });
  if (p.error) return usageError(ctx, p.error);
  if (!p.operands.length) return usageError(ctx, 'missing operand');
  const fs = ctx.sh.env.fs;
  let status = 0;
  for (const d of p.operands) {
    let path = ctx.resolve(d);
    try {
      const node = fs.lookup(path, ctx.cred, false);
      if (node.kind !== 'dir') throw new FsError('ENOTDIR');
      fs.remove(path, ctx.cred, false, true);
      if (p.opts.has('v')) ctx.out(`rmdir: removing directory, ${q(d)}\n`);
      if (p.opts.has('p')) {
        const parts = d.replace(/\/+$/, '').split('/');
        while (parts.length > 1) {
          parts.pop();
          path = ctx.resolve(parts.join('/') || '/');
          fs.remove(path, ctx.cred, false, true);
        }
      }
    } catch (e) {
      if (p.opts.has('ignore') && e instanceof FsError && e.code === 'ENOTEMPTY') continue;
      ctx.err(`rmdir: failed to remove ${q(d)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function rm(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'rRfivdI', long: { recursive: 'r', force: 'f', verbose: 'v', dir: 'd', 'no-preserve-root': 'nopreserve', interactive: 'i' } });
  if (p.error) return usageError(ctx, p.error);
  const force = p.opts.has('f');
  if (!p.operands.length) return force ? 0 : usageError(ctx, 'missing operand');
  const recursive = p.opts.has('r') || p.opts.has('R');
  const fs = ctx.sh.env.fs;
  let status = 0;
  for (const f of p.operands) {
    const path = ctx.resolve(f);
    if (recursive && path === '/' && !p.opts.has('nopreserve')) {
      ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      status = 1;
      continue;
    }
    try {
      const node = fs.lookup(path, ctx.cred, false);
      if (node.kind === 'dir' && !recursive && !p.opts.has('d')) throw new FsError('EISDIR');
      fs.remove(path, ctx.cred, recursive, p.opts.has('d'));
      if (p.opts.has('v')) ctx.out(`removed ${node.kind === 'dir' ? 'directory ' : ''}${q(f)}\n`);
    } catch (e) {
      if (force && e instanceof FsError && e.code === 'ENOENT') continue;
      ctx.err(`rm: cannot remove ${q(f)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function copyTree(ctx: Ctx, from: string, to: string, preserve: boolean): void {
  const fs = ctx.sh.env.fs;
  const node = fs.lookup(from, ctx.cred);
  if (node.kind === 'dir') {
    if (!fs.exists(to)) fs.mkdir(to, ctx.cred, false);
    for (const n of fs.readdir(from, ctx.cred)) copyTree(ctx, normalize(n, from), normalize(n, to), preserve);
    return;
  }
  fs.writeFile(to, fs.readFile(from, ctx.cred), ctx.cred, false, 0o666 & ~ctx.sh.umask);
  const st = fs.stat(from, ctx.cred);
  if (preserve || st.mode & 0o111) fs.chmod(to, st.mode, ctx.cred);
}

/** Destination for each source of cp/mv: into a directory or onto a file. */
function targets(ctx: Ctx, ops: readonly string[]): { pairs: [string, string, string][]; error?: string } {
  if (ops.length < 2) return { pairs: [], error: ops.length ? `missing destination file operand after ${q(ops[0] ?? '')}` : 'missing file operand' };
  const dest = ops[ops.length - 1] ?? '';
  const destPath = ctx.resolve(dest);
  const isDir = ctx.sh.env.fs.tryLookup(destPath, ctx.cred)?.kind === 'dir';
  if (ops.length > 2 && !isDir) return { pairs: [], error: `target ${q(dest)} is not a directory` };
  const into = (s: string): string => (/(^|\/)\.\/?$/.test(s) ? destPath : normalize(base(s), destPath));
  return { pairs: ops.slice(0, -1).map((s) => [s, ctx.resolve(s), isDir ? into(s) : destPath]) };
}

function cp(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'rRapvfinuT', long: { recursive: 'r', archive: 'a', verbose: 'v', force: 'f', 'no-clobber': 'n', preserve: 'p' } });
  if (p.error) return usageError(ctx, p.error);
  const t = targets(ctx, p.operands);
  if (t.error) return usageError(ctx, t.error);
  const fs = ctx.sh.env.fs;
  const recursive = p.opts.has('r') || p.opts.has('R') || p.opts.has('a');
  let status = 0;
  for (const [shown, from, to] of t.pairs) {
    try {
      const node = fs.lookup(from, ctx.cred);
      if (node.kind === 'dir' && !recursive) { ctx.err(`cp: -r not specified; omitting directory ${q(shown)}\n`); status = 1; continue; }
      if (normalize(to) === normalize(from)) { ctx.err(`cp: ${q(shown)} and ${q(shown)} are the same file\n`); status = 1; continue; }
      if (p.opts.has('n') && fs.exists(to)) continue;
      if (node.kind === 'dir' && normalize(to).startsWith(`${normalize(from)}/`)) { ctx.err(`cp: cannot copy a directory, ${q(shown)}, into itself, ${q(to)}\n`); status = 1; continue; }
      copyTree(ctx, from, to, p.opts.has('a') || p.opts.has('p'));
      if (p.opts.has('v')) ctx.out(`${q(shown)} -> ${q(to)}\n`);
    } catch (e) {
      ctx.err(e instanceof FsError && e.code === 'ENOENT' && !fs.exists(from) ? `cp: cannot stat ${q(shown)}: ${errMsg(e)}\n` : `cp: cannot create regular file ${q(to)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function mv(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'vfinuT', long: { verbose: 'v', force: 'f', 'no-clobber': 'n' } });
  if (p.error) return usageError(ctx, p.error);
  const t = targets(ctx, p.operands);
  if (t.error) return usageError(ctx, t.error);
  const fs = ctx.sh.env.fs;
  let status = 0;
  for (const [shown, from, to] of t.pairs) {
    try {
      if (!fs.tryLookup(from, ctx.cred, false)) { ctx.err(`mv: cannot stat ${q(shown)}: No such file or directory\n`); status = 1; continue; }
      if (p.opts.has('n') && fs.exists(to)) continue;
      if (fs.realpath(from) === fs.realpath(to)) { ctx.err(`mv: ${q(shown)} and ${q(shown)} are the same file\n`); status = 1; continue; }
      fs.rename(from, to, ctx.cred);
      if (p.opts.has('v')) ctx.out(`renamed ${q(shown)} -> ${q(to)}\n`);
    } catch (e) {
      ctx.err(`mv: cannot move ${q(shown)} to ${q(to)}: ${errMsg(e)}\n`);
      status = 1;
    }
  }
  return status;
}

function ln(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'sfvnrT', long: { symbolic: 's', force: 'f', verbose: 'v' } });
  if (p.error) return usageError(ctx, p.error);
  const [target, name] = p.operands;
  if (target === undefined) return usageError(ctx, 'missing file operand');
  const fs = ctx.sh.env.fs;
  const linkName = name ?? base(target);
  let path = ctx.resolve(linkName);
  if (fs.tryLookup(path, ctx.cred)?.kind === 'dir' && !p.opts.has('n')) path = normalize(base(target), path);
  try {
    if (p.opts.has('f') && fs.tryLookup(path, ctx.cred, false)) fs.remove(path, ctx.cred);
    if (p.opts.has('s')) fs.symlink(target, path, ctx.cred);
    else {
      if (fs.tryLookup(path, ctx.cred, false)) throw new FsError('EEXIST');
      fs.writeFile(path, fs.readFile(ctx.resolve(target), ctx.cred), ctx.cred);
    }
    if (p.opts.has('v')) ctx.out(`${q(linkName)} -> ${q(target)}\n`);
    return 0;
  } catch (e) {
    ctx.err(`ln: failed to create ${p.opts.has('s') ? 'symbolic ' : 'hard '}link ${q(linkName)}: ${errMsg(e)}\n`);
    return 1;
  }
}

function chmod(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  const recursive = args.includes('-R');
  const verbose = args.includes('-v');
  const rest = args.filter((a) => !['-R', '-v', '-c', '-f'].includes(a));
  const [spec, ...files] = rest;
  if (spec === undefined) return usageError(ctx, 'missing operand');
  if (!files.length) return usageError(ctx, `missing operand after ${q(spec)}`);
  const fs = ctx.sh.env.fs;
  let status = 0;
  const apply = (shown: string, path: string): void => {
    const st = fs.stat(path, ctx.cred);
    const mode = parseMode(spec, st.mode, st.kind === 'dir', ctx.sh.umask);
    if (mode === null) throw new Error(`invalid mode: ${q(spec)}`);
    fs.chmod(path, mode, ctx.cred);
    if (verbose) ctx.out(`mode of ${q(shown)} changed from ${st.mode.toString(8).padStart(4, '0')} to ${mode.toString(8).padStart(4, '0')}\n`);
    if (recursive && st.kind === 'dir') for (const n of fs.readdir(path, ctx.cred)) apply(`${shown}/${n}`, normalize(n, path));
  };
  for (const f of files) {
    try {
      apply(f, ctx.resolve(f));
    } catch (e) {
      const msg = errMsg(e);
      if (msg.startsWith('invalid mode')) { ctx.err(`chmod: ${msg}\nTry 'chmod --help' for more information.\n`); return 1; }
      ctx.err(e instanceof FsError && e.code === 'ENOENT' ? `chmod: cannot access ${q(f)}: ${msg}\n` : `chmod: changing permissions of ${q(f)}: ${msg}\n`);
      status = 1;
    }
  }
  return status;
}

/** Changes owner and group of `path` (and, with -R, of everything below it). */
function chownTree(ctx: Ctx, path: string, uid: number | undefined, gid: number | undefined, recursive: boolean): void {
  const fs = ctx.sh.env.fs;
  const st = fs.stat(path, ctx.cred, !recursive);
  fs.chown(path, uid ?? st.uid, gid ?? st.gid, ctx.cred);
  if (recursive && st.kind === 'dir') for (const n of fs.readdir(path, ctx.cred)) chownTree(ctx, normalize(n, path), uid, gid, true);
}

function chown(groupOnly: boolean): CommandFn {
  return (ctx) => {
    const recursive = ctx.argv.slice(1).includes('-R');
    const args = ctx.argv.slice(1).filter((a) => !['-R', '-v', '-h', '-f'].includes(a));
    const [spec, ...files] = args;
    const name = groupOnly ? 'chgrp' : 'chown';
    if (spec === undefined || !files.length) return usageError(ctx, spec === undefined ? 'missing operand' : `missing operand after ${q(spec)}`);
    const users = ctx.sh.env.users();
    const [u, g] = groupOnly ? [undefined, spec] : spec.split(/[:.]/);
    const uid = u ? users.find((x) => x.name === u)?.uid ?? (/^\d+$/.test(u) ? Number(u) : undefined) : undefined;
    const gid = g ? users.find((x) => x.name === g)?.gid ?? (/^\d+$/.test(g) ? Number(g) : g === 'root' ? 0 : g === 'www-data' ? 33 : undefined) : undefined;
    if (u && uid === undefined) { ctx.err(`${name}: invalid user: ${q(spec)}\n`); return 1; }
    if (g && gid === undefined) { ctx.err(`${name}: invalid group: ${q(spec)}\n`); return 1; }
    let status = 0;
    for (const f of files) {
      try {
        chownTree(ctx, ctx.resolve(f), uid, gid, recursive);
      } catch (e) {
        ctx.err(e instanceof FsError && e.code === 'ENOENT' ? `${name}: cannot access ${q(f)}: ${errMsg(e)}\n` : `${name}: changing ${groupOnly ? 'group' : 'ownership'} of ${q(f)}: ${errMsg(e)}\n`);
        status = 1;
      }
    }
    return status;
  };
}

export const FILES: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['cat', cat], ['touch', touch], ['mkdir', mkdir], ['rmdir', rmdir], ['rm', rm], ['cp', cp], ['mv', mv], ['ln', ln],
  ['chmod', chmod], ['chown', chown(false)], ['chgrp', chown(true)],
]);
