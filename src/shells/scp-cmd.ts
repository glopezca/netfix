/** scp (OpenSSH 10, SFTP protocol): copies files between this host and `[user@]host:path`. */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { baseName, joinPath } from '../clients/sftp-client.ts';
import type { SftpSession } from '../clients/sftp-client.ts';
import { progress, statusText } from './sftp-format.ts';
import { loginOptions, sftpLogin, transferArgs } from './sftp-login.ts';
import { FsError } from '../bash/vfs.ts';

const USAGE = 'usage: scp [-346ABCOpqRrsTv] [-c cipher] [-D sftp_server_path] [-F ssh_config]\n           [-i identity_file] [-J destination] [-l limit] [-o ssh_option]\n           [-P port] [-S program] [-X sftp_option] source ... target\n';

interface Spec {
  readonly remote?: string;
  readonly path: string;
}

/** `user@host:path` (remote) or a local path; a colon after a slash is part of a local name. */
function spec(arg: string): Spec {
  const m = /^([^/:]+):(.*)$/s.exec(arg);
  return m ? { remote: m[1], path: m[2] ?? '' } : { path: arg };
}

function fsText(e: unknown): string {
  if (!(e instanceof FsError)) throw e;
  return e.code === 'EACCES' ? 'Permission denied' : e.code === 'EISDIR' ? 'Is a directory' : 'No such file or directory';
}

function upload(ctx: Ctx, s: SftpSession, src: string, dst: string, quiet: boolean): boolean {
  let data: string;
  try {
    data = ctx.sh.env.fs.readFile(ctx.resolve(src), ctx.cred);
  } catch (e) {
    ctx.err(`scp: ${src}: ${fsText(e)}\n`);
    return false;
  }
  let target = s.abs(dst);
  if (!dst || s.request({ op: 'stat', path: target }).entry?.kind === 'dir') target = joinPath(target, baseName(src));
  const r = s.request({ op: 'write', path: target, data });
  if (r.status !== 'ok') { ctx.err(`scp: dest open "${target}": ${statusText(r)}\nscp: failed to upload file ${src} to ${dst}\n`); return false; }
  if (!quiet) ctx.out(`${progress(baseName(src), data.length)}\n`);
  return true;
}

function download(ctx: Ctx, s: SftpSession, src: string, dst: string, quiet: boolean): boolean {
  const path = s.abs(src);
  const r = s.request({ op: 'read', path });
  if (r.status !== 'ok') { ctx.err(`scp: ${path}: ${statusText(r)}\n`); return false; }
  let target = ctx.resolve(dst);
  if (ctx.sh.env.fs.tryLookup(target, ctx.cred)?.kind === 'dir') target = joinPath(target, baseName(path));
  try {
    ctx.sh.env.fs.writeFile(target, r.data ?? '', ctx.cred);
  } catch (e) {
    ctx.err(`scp: ${dst}: ${fsText(e)}\n`);
    return false;
  }
  if (!quiet) ctx.out(`${progress(baseName(path), (r.data ?? '').length)}\n`);
  return true;
}

export function scp(host: Host): CommandFn {
  return function* run(ctx: Ctx): Gen<number> {
    const t = transferArgs(ctx.argv.slice(1));
    if (typeof t === 'string' || t.rest.length < 2) { ctx.err(typeof t === 'string' ? `${t}\n${USAGE}` : USAGE); return 1; }
    const specs = t.rest.map(spec);
    const target = specs[specs.length - 1] ?? { path: '' };
    const sources = specs.slice(0, -1);
    const remote = target.remote ?? sources.find((x) => x.remote)?.remote;
    if (!remote) { yield* ctx.sh.invoke(['cp', ...t.rest], ctx.fds); return 0; }
    if (target.remote && sources.some((x) => x.remote)) { ctx.err('scp: remote to remote copies are not available in Netfix\n'); return 1; }
    if (t.recursive) { ctx.err('scp: -r is not available in Netfix: copy the files one by one or use sftp\n'); return 1; }
    const opts = loginOptions(ctx, t, remote);
    if (typeof opts === 'string') { ctx.err(`${opts}\n`); return 255; }
    const session = yield* sftpLogin(ctx, host, opts);
    if (typeof session === 'number') { ctx.err('scp: Connection closed\n'); return session; }
    let ok = true;
    for (const src of sources) {
      const done = target.remote ? upload(ctx, session, src.path, target.path, t.quiet) : download(ctx, session, src.path, target.path, t.quiet);
      ok = ok && done;
    }
    return ok ? 0 : 1;
  };
}
