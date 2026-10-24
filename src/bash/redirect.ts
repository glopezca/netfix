/** Redirections: open files in the VFS, duplicate/close descriptors, here-documents and here-strings. */
import type { Redirect } from './ast.ts';
import type { Interp } from './interp.ts';
import type { Fd, Fds, Sink, Source } from './types.ts';
import { dataSource } from './io.ts';
import { FsError } from './vfs.ts';

export class RedirError extends Error {}

const INPUT_OPS = new Set(['<', '<<', '<<-', '<<<', '<&', '<>']);
const FIRST_VAR_FD = 10;

function target(sh: Interp, r: Redirect): string {
  const fields = sh.expander.words([r.target]);
  if (fields.length !== 1) throw new RedirError(`${r.target.raw}: ambiguous redirect`);
  return fields[0] ?? '';
}

function special(path: string, fds: Map<number, Fd>): Fd | undefined {
  switch (path) {
    case '/dev/null': return { read: { kind: 'null' }, write: { kind: 'null' } };
    case '/dev/stdout': return fds.get(1);
    case '/dev/stderr': return fds.get(2);
    case '/dev/stdin': return fds.get(0);
    case '/dev/tty': return { read: { kind: 'tty' }, write: { kind: 'term' } };
    default: {
      const m = /^\/dev\/fd\/(\d+)$/.exec(path);
      return m && fds.has(Number(m[1])) ? fds.get(Number(m[1])) : undefined;
    }
  }
}

function openWrite(sh: Interp, path: string, append: boolean, clobber: boolean): Sink {
  const abs = sh.resolvePath(path);
  const fs = sh.env.fs;
  try {
    const node = fs.tryLookup(abs, sh.cred);
    if (node?.kind === 'dir') throw new FsError('EISDIR');
    if (!append && !clobber && sh.opt('noclobber') && node?.kind === 'file') throw new RedirError(`${path}: cannot overwrite existing file`);
    if (!append || !node) fs.writeFile(abs, '', sh.cred, false, 0o666 & ~sh.umask);
    // Appending opens the file for writing too: without permission bash fails there, not on the first write.
    else fs.writeFile(abs, '', sh.cred, true);
  } catch (e) {
    if (e instanceof FsError) throw new RedirError(`${path}: ${e.message}`);
    throw e;
  }
  return { kind: 'file', path: abs };
}

function openRead(sh: Interp, path: string, create = false): Source {
  const abs = sh.resolvePath(path);
  try {
    if (create && !sh.env.fs.exists(abs)) sh.env.fs.writeFile(abs, '', sh.cred);
    return dataSource(sh.env.fs.readFile(abs, sh.cred));
  } catch (e) {
    if (e instanceof FsError) throw new RedirError(`${path}: ${e.message}`);
    throw e;
  }
}

function allocFd(fds: Map<number, Fd>): number {
  let n = FIRST_VAR_FD;
  while (fds.has(n)) n++;
  return n;
}

function duplicate(fds: Map<number, Fd>, fd: number, spec: string, input: boolean): void {
  if (spec === '-') {
    fds.delete(fd);
    return;
  }
  const move = /^(\d+)-$/.exec(spec);
  const src = Number(move ? move[1] : spec);
  const from = fds.get(src);
  if (!from || (input ? !from.read : !from.write)) throw new RedirError(`${src}: Bad file descriptor`);
  fds.set(fd, from);
  if (move) fds.delete(src);
}

/** Applies redirections left to right on a copy of the descriptor table. */
export function applyRedirects(sh: Interp, redirs: readonly Redirect[], base: Fds): Map<number, Fd> {
  const fds = new Map(base);
  for (const r of redirs) {
    let fd = r.fd ?? (INPUT_OPS.has(r.op) ? 0 : 1);
    if (r.varFd) {
      fd = allocFd(fds);
      sh.setVar(r.varFd, String(fd));
    }
    applyOne(sh, r, fd, fds);
  }
  return fds;
}

function applyOne(sh: Interp, r: Redirect, fd: number, fds: Map<number, Fd>): void {
  switch (r.op) {
    case '<<': case '<<-': {
      const body = r.heredoc?.body ?? '';
      fds.set(fd, { read: dataSource(r.heredoc?.quoted ? body : sh.expander.heredoc(body)) });
      return;
    }
    case '<<<': fds.set(fd, { read: dataSource(`${sh.expander.word(r.target.raw)}\n`) }); return;
    case '<&': case '>&': {
      const spec = target(sh, r);
      if (/^(\d+-?|-)$/.test(spec)) return duplicate(fds, fd, spec, r.op === '<&');
      if (r.op === '>&' && r.fd === undefined) return both(sh, fds, spec, false);
      throw new RedirError(`${spec}: ambiguous redirect`);
    }
    case '&>': case '&>>': return both(sh, fds, target(sh, r), r.op === '&>>');
    default: break;
  }
  const path = target(sh, r);
  const sp = special(path, fds);
  if (sp) {
    fds.set(fd, sp);
    return;
  }
  if (r.op === '<') fds.set(fd, { read: openRead(sh, path) });
  else if (r.op === '<>') fds.set(fd, { read: openRead(sh, path, true) });
  else fds.set(fd, { write: openWrite(sh, path, r.op === '>>', r.op === '>|') });
}

function both(sh: Interp, fds: Map<number, Fd>, path: string, append: boolean): void {
  const sp = special(path, fds);
  const fd: Fd = sp ?? { write: openWrite(sh, path, append, false) };
  fds.set(1, fd);
  fds.set(2, fd);
}
