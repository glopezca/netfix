/** sftp (OpenSSH 10): interactive or batch (-b, or commands on stdin) file transfer over the SSH login. */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { baseName, joinPath } from '../clients/sftp-client.ts';
import type { SftpSession } from '../clients/sftp-client.ts';
import { columns, longLine, progress, statusText } from './sftp-format.ts';
import { loginOptions, sftpLogin, transferArgs } from './sftp-login.ts';
import { FsError } from '../bash/vfs.ts';

const USAGE = 'usage: sftp [-46AaCfNpqrv] [-B buffer_size] [-b batchfile] [-c cipher]\n          [-D sftp_server_command] [-F ssh_config] [-i identity_file]\n          [-J destination] [-l limit] [-o ssh_option] [-P port]\n          [-R num_requests] [-S program] [-s subsystem | sftp_server]\n          destination\n';
const HELP = `Available commands:
bye                                Quit sftp
cd path                            Change remote directory to 'path'
chmod mode path                    Change permissions of file 'path' to 'mode'
exit                               Quit sftp
get remote [local]                 Download file
help                               Display this help text
lcd path                           Change local directory to 'path'
lls [ls-options [path]]            Display local directory listing
lmkdir path                        Create local directory
lpwd                               Print local working directory
ls [-la] [path]                    Display remote directory listing
mkdir path                         Create remote directory
put local [remote]                 Upload file
pwd                                Display remote working directory
quit                               Quit sftp
rename oldpath newpath             Rename remote file
rm path                            Delete remote file
rmdir path                         Remove remote directory
?                                  Synonym for help`;

interface State {
  readonly s: SftpSession;
  /** Login directory (cd without arguments). */
  readonly home: string;
  lcwd: string;
}

const say = (ctx: Ctx, text: string): void => ctx.out(`${text}\n`);
const warn = (ctx: Ctx, text: string): void => ctx.err(`${text}\n`);

function ls(ctx: Ctx, st: State, args: readonly string[]): void {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const given = args.find((a) => !a.startsWith('-'));
  const target = st.s.abs(given ?? '.');
  const one = st.s.request({ op: 'stat', path: target });
  if (one.status !== 'ok') return warn(ctx, `Can't ls: "${target}" not found`);
  const r = one.entry?.kind === 'dir' ? st.s.request({ op: 'list', path: target }) : { ...one, entries: one.entry ? [{ ...one.entry, name: given ?? one.entry.name }] : [] };
  if (r.status !== 'ok') return warn(ctx, `remote readdir("${target}"): ${statusText(r)}`);
  const entries = (r.entries ?? []).filter((e) => flags.includes('a') || !e.name.startsWith('.'));
  if (flags.includes('l')) entries.forEach((e) => say(ctx, longLine(e, ctx.sh.env.now())));
  else columns(entries.map((e) => e.name)).forEach((l) => say(ctx, l));
}

function get(ctx: Ctx, st: State, remote: string | undefined, local: string | undefined): void {
  if (!remote) return warn(ctx, 'You must specify at least one path after a get command.');
  const src = st.s.abs(remote);
  const r = st.s.request({ op: 'read', path: src });
  if (r.status === 'no-such-file') return warn(ctx, `File "${src}" not found.`);
  if (r.status !== 'ok') return warn(ctx, `remote open("${src}"): ${statusText(r)}`);
  const dst = joinPath(st.lcwd, local ?? baseName(src));
  const finalDst = ctx.sh.env.fs.tryLookup(dst, ctx.cred)?.kind === 'dir' ? `${dst}/${baseName(src)}` : dst;
  say(ctx, `Fetching ${src} to ${local ?? baseName(src)}`);
  try {
    ctx.sh.env.fs.writeFile(finalDst, r.data ?? '', ctx.cred);
    say(ctx, progress(baseName(src), (r.data ?? '').length));
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    warn(ctx, `Couldn't open local file "${finalDst}" for writing: ${e.code === 'EACCES' ? 'Permission denied' : 'No such file or directory'}`);
  }
}

function put(ctx: Ctx, st: State, local: string | undefined, remote: string | undefined): void {
  if (!local) return warn(ctx, 'You must specify at least one path after a put command.');
  const src = joinPath(st.lcwd, local);
  let data: string;
  try {
    data = ctx.sh.env.fs.readFile(src, ctx.cred);
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    return warn(ctx, `stat ${local}: ${e.code === 'EACCES' ? 'Permission denied' : e.code === 'EISDIR' ? 'Is a directory' : 'No such file or directory'}`);
  }
  let dst = st.s.abs(remote ?? baseName(src));
  if (st.s.request({ op: 'stat', path: dst }).entry?.kind === 'dir') dst = `${dst}/${baseName(src)}`;
  say(ctx, `Uploading ${local} to ${dst}`);
  const r = st.s.request({ op: 'write', path: dst, data });
  if (r.status !== 'ok') return warn(ctx, `dest open "${dst}": ${statusText(r)}`);
  say(ctx, progress(baseName(src), data.length));
}

function simple(ctx: Ctx, st: State, cmd: string, args: readonly string[]): void {
  const [a, b] = args;
  if (a === undefined) return warn(ctx, `You must specify a path after a ${cmd} command.`);
  const path = st.s.abs(a);
  if (cmd === 'mkdir' || cmd === 'rmdir') {
    const r = st.s.request({ op: cmd, path });
    if (r.status !== 'ok') warn(ctx, `remote ${cmd} "${path}": ${statusText(r)}`);
  } else if (cmd === 'rm') {
    say(ctx, `Removing ${path}`);
    const r = st.s.request({ op: 'remove', path });
    if (r.status !== 'ok') warn(ctx, `Couldn't delete file: ${statusText(r)}`);
  } else if (cmd === 'rename') {
    if (b === undefined) return warn(ctx, 'You must specify two paths after a rename command.');
    const r = st.s.request({ op: 'rename', path, to: st.s.abs(b) });
    if (r.status !== 'ok') warn(ctx, `Couldn't rename file "${path}" to "${st.s.abs(b)}": ${statusText(r)}`);
  }
}

function chmod(ctx: Ctx, st: State, args: readonly string[]): void {
  const [mode, file] = args;
  if (!mode || !/^[0-7]{1,4}$/.test(mode) || !file) return warn(ctx, "You must supply a numeric argument to the chmod command.");
  const path = st.s.abs(file);
  say(ctx, `Changing mode on ${path}`);
  const r = st.s.request({ op: 'chmod', path, mode: parseInt(mode, 8) });
  if (r.status !== 'ok') warn(ctx, `Couldn't setstat on "${path}": ${statusText(r)}`);
}

function* local(ctx: Ctx, st: State, cmd: string, args: readonly string[]): Gen<void> {
  if (cmd === 'lpwd') return say(ctx, `Local working directory: ${st.lcwd}`);
  if (cmd === 'lcd') {
    const dir = joinPath(st.lcwd, args[0] ?? (ctx.env.get('HOME') ?? '/'));
    if (ctx.sh.env.fs.tryLookup(dir, ctx.cred)?.kind !== 'dir') return warn(ctx, `Couldn't change local directory to "${dir}": No such file or directory`);
    st.lcwd = dir;
    return;
  }
  if (cmd === 'lmkdir') {
    try { ctx.sh.env.fs.mkdir(joinPath(st.lcwd, args[0] ?? ''), ctx.cred, false, 0o755); } catch { warn(ctx, `Couldn't create local directory "${args[0] ?? ''}": Failure`); }
    return;
  }
  yield* ctx.sh.invoke(['ls', ...args.map((a) => (a.startsWith('-') ? a : joinPath(st.lcwd, a))), ...(args.some((a) => !a.startsWith('-')) ? [] : [st.lcwd])], ctx.fds);
}

/** One sftp command; false = quit. */
function* command(ctx: Ctx, st: State, line: string): Gen<boolean> {
  const [cmd = '', ...args] = line.trim().split(/\s+/);
  if (!cmd) return true;
  if (['bye', 'exit', 'quit'].includes(cmd)) return false;
  if (cmd === 'help' || cmd === '?') say(ctx, HELP);
  else if (cmd === 'pwd') say(ctx, `Remote working directory: ${st.s.cwd}`);
  else if (cmd === 'cd') { const r = st.s.cd(args[0] ?? st.home); if (r.status !== 'ok') warn(ctx, r.status === 'failure' ? `Can't change directory: ${r.message ?? ''}` : `Can't change directory: Can't check target`); }
  else if (cmd === 'ls' || cmd === 'dir') ls(ctx, st, args);
  else if (cmd === 'get') get(ctx, st, args[0], args[1]);
  else if (cmd === 'put') put(ctx, st, args[0], args[1]);
  else if (['mkdir', 'rmdir', 'rm', 'rename'].includes(cmd)) simple(ctx, st, cmd, args);
  else if (cmd === 'chmod') chmod(ctx, st, args);
  else if (['lpwd', 'lcd', 'lls', 'lmkdir'].includes(cmd)) yield* local(ctx, st, cmd, args);
  else warn(ctx, 'Invalid command.');
  return !st.s.closed;
}

export function sftp(host: Host): CommandFn {
  return function* run(ctx: Ctx): Gen<number> {
    const t = transferArgs(ctx.argv.slice(1));
    if (typeof t === 'string' || t.rest.length !== 1) { ctx.err(typeof t === 'string' ? `${t}\n${USAGE}` : USAGE); return 1; }
    const [dest = '', startDir] = (t.rest[0] ?? '').split(/:(.*)$/s);
    const opts = loginOptions(ctx, t, dest);
    if (typeof opts === 'string') { ctx.err(`${opts}\n`); return 255; }
    const session = yield* sftpLogin(ctx, host, opts);
    if (typeof session === 'number') { ctx.err('Connection closed\n'); return session; }
    say(ctx, `Connected to ${opts.target}.`);
    const st: State = { s: session, home: session.cwd, lcwd: ctx.cwd };
    if (startDir) session.cd(startDir);
    const script = t.batch !== undefined ? readBatch(ctx, t.batch) : null;
    if (script !== null) {
      for (const line of script) {
        say(ctx, `sftp> ${line}`);
        if (!(yield* command(ctx, st, line))) break;
      }
      return 0;
    }
    for (;;) {
      const line = yield* ctx.readLine('sftp> ');
      if (line === null) return 0;
      if (!(yield* command(ctx, st, line.text))) return 0;
    }
  };
}

function readBatch(ctx: Ctx, path: string): string[] {
  try {
    return ctx.sh.env.fs.readFile(ctx.resolve(path), ctx.cred).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    ctx.err(`${path} (No such file or directory)\n`);
    return [];
  }
}
