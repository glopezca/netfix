/** The commands of smbclient's «smb: \>» prompt: ls, cd, pwd, get, put, mkdir, rmdir, rm and the way out. */
import type { Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { SmbEntry, SmbOp } from '../net/smb-types.ts';
import { smbCall, smbPath } from '../clients/smb-client.ts';
import type { SmbLogin, SmbResult } from '../clients/smb-client.ts';

export interface SmbSession {
  readonly host: Host;
  readonly ip: number;
  readonly server: string;
  readonly share: string;
  readonly login: SmbLogin;
  /** The current directory on the share: \ or \dir\sub\ */
  cwd: string;
}

export type Outcome = 'ok' | 'fail' | 'quit';

/** What `df` would say of the share's disk (fixed: Netfix does not size the server's disk). */
const BLOCKS = '\t\t30787492 blocks of size 1024. 21345612 blocks available';
const HELP = ['?              cd             del            dir            exit', 'get            help           ls             mkdir          put', 'pwd            q              quit           rm             rmdir'];

const call = (s: SmbSession, req: SmbOp): SmbResult => smbCall(s.host, s.ip, s.login, s.share, req);

/** A path typed at the prompt, on the share: from the root when it starts with a slash, else from the current directory. */
function remote(s: SmbSession, name: string): string {
  return smbPath(/^[\\/]/.test(name) ? name : `${s.cwd}${name}`);
}

/** «Wed Nov  4 10:00:00 2026», as ctime(3) writes it. */
function ctime(ms: number): string {
  const [day = '', date = '', month = '', year = '', time = ''] = new Date(ms).toUTCString().split(' ');
  return `${day.slice(0, 3)} ${month} ${String(Number(date)).padStart(2)} ${time} ${year}`;
}

const row = (e: SmbEntry): string => `  ${e.name.padEnd(30)}${(e.dir ? 'D' : 'A').padStart(7)} ${String(e.size).padStart(8)}  ${ctime(e.mtime)}`;

function failed(ctx: Ctx, r: SmbResult, what: string): Outcome {
  ctx.err(`${r.status} ${what}\n`);
  return 'fail';
}

function ls(ctx: Ctx, s: SmbSession, arg: string | undefined): Outcome {
  const path = arg ? remote(s, arg) : smbPath(s.cwd);
  const r = call(s, { op: 'list', path });
  if (r.status !== 'NT_STATUS_OK') return failed(ctx, r, `listing ${path === '\\' ? '' : path}\\*`);
  ctx.out(`${(r.entries ?? []).map(row).join('\n')}\n\n${BLOCKS}\n`);
  return 'ok';
}

/** cd: «..» is worked out here, as smbclient does, before asking the server whether the directory exists. */
function cd(ctx: Ctx, s: SmbSession, arg: string | undefined): Outcome {
  if (!arg) { ctx.out(`Current directory is \\\\${s.server}\\${s.share}${s.cwd}\n`); return 'ok'; }
  const parts: string[] = [];
  for (const p of remote(s, arg).split('\\').filter(Boolean)) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  const target = parts.length ? `\\${parts.join('\\')}\\` : '\\';
  const r = call(s, { op: 'stat', path: smbPath(target) });
  if (r.status === 'NT_STATUS_OK' && !r.entry?.dir) { ctx.err(`cd ${target.slice(0, -1)}: NT_STATUS_NOT_A_DIRECTORY\n`); return 'fail'; }
  if (r.status !== 'NT_STATUS_OK') { ctx.err(`cd ${target.slice(0, -1) || '\\'}: ${r.status}\n`); return 'fail'; }
  s.cwd = target;
  return 'ok';
}

const rate = (bytes: number): string => (bytes / 1024 / 0.01).toFixed(1);

function get(ctx: Ctx, s: SmbSession, args: readonly string[]): Outcome {
  const [name, local = name?.split(/[\\/]/).pop()] = args;
  if (!name || !local) { ctx.err('get <filename> [localname]\n'); return 'fail'; }
  const path = remote(s, name);
  const r = call(s, { op: 'read', path });
  if (r.status !== 'NT_STATUS_OK') return failed(ctx, r, `opening remote file ${path}`);
  const data = r.data ?? '';
  try {
    ctx.sh.env.fs.writeFile(ctx.resolve(local), data, ctx.cred);
  } catch {
    ctx.err(`Error opening local file ${local}\n`);
    return 'fail';
  }
  ctx.out(`getting file ${path} of size ${data.length} as ${local} (${rate(data.length)} KiloBytes/sec) (average ${rate(data.length)} KiloBytes/sec)\n`);
  return 'ok';
}

function put(ctx: Ctx, s: SmbSession, args: readonly string[]): Outcome {
  const [local, name = local?.split('/').pop()] = args;
  if (!local || !name) { ctx.err('put <filename> [remotename]\n'); return 'fail'; }
  let data: string;
  try {
    data = ctx.sh.env.fs.readFile(ctx.resolve(local), ctx.cred);
  } catch {
    ctx.err(`${local} does not exist\n`);
    return 'fail';
  }
  const path = remote(s, name);
  const r = call(s, { op: 'write', path, data });
  if (r.status !== 'NT_STATUS_OK') return failed(ctx, r, `opening remote file ${path}`);
  ctx.out(`putting file ${local} as ${path} (${rate(data.length)} kb/s) (average ${rate(data.length)} kb/s)\n`);
  return 'ok';
}

/** mkdir, rmdir and rm: one path each, and the words smbclient uses when it fails. */
const SIMPLE: Readonly<Record<string, { readonly op: 'mkdir' | 'rmdir' | 'remove'; readonly what: string }>> = {
  mkdir: { op: 'mkdir', what: 'making remote directory' }, md: { op: 'mkdir', what: 'making remote directory' },
  rmdir: { op: 'rmdir', what: 'removing remote directory file' }, rd: { op: 'rmdir', what: 'removing remote directory file' },
  rm: { op: 'remove', what: 'deleting remote file' }, del: { op: 'remove', what: 'deleting remote file' },
};

function simple(ctx: Ctx, s: SmbSession, cmd: string, arg: string | undefined): Outcome {
  const c = SIMPLE[cmd];
  if (!c) return 'fail';
  if (!arg) { ctx.err(`${cmd} <${c.op === 'remove' ? 'mask' : 'directory'}>\n`); return 'fail'; }
  const path = remote(s, arg);
  const r = call(s, { op: c.op, path });
  return r.status === 'NT_STATUS_OK' ? 'ok' : failed(ctx, r, `${c.what} ${path}`);
}

/** Splits a command line into words, with "quotes" for names with spaces. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '');
}

export function smbCommand(ctx: Ctx, s: SmbSession, line: string): Outcome {
  const [cmd = '', ...args] = words(line);
  switch (cmd.toLowerCase()) {
    case '': return 'ok';
    case 'ls': case 'dir': return ls(ctx, s, args[0]);
    case 'cd': return cd(ctx, s, args[0]);
    case 'pwd': ctx.out(`Current directory is \\\\${s.server}\\${s.share}${s.cwd}\n`); return 'ok';
    case 'get': return get(ctx, s, args);
    case 'put': return put(ctx, s, args);
    case 'help': case '?': ctx.out(`${HELP.join('\n')}\n`); return 'ok';
    case 'exit': case 'quit': case 'q': case 'bye': return 'quit';
    default:
      if (SIMPLE[cmd.toLowerCase()]) return simple(ctx, s, cmd.toLowerCase(), args[0]);
      ctx.err(`${cmd}: command not found\n`);
      return 'fail';
  }
}
