/**
 * Shared by sftp and scp: their command line (-P port, -i identity, -o option) and the SSH login of the
 * sftp subsystem, with the host key question, passphrases and passwords asked on the terminal.
 */
import type { Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { parseSshArgs, SshLogin } from './ssh-client.ts';
import type { LoginResult, SshOptions } from './ssh-client.ts';
import { linuxSshStore } from './ssh-stores.ts';
import { SftpSession } from '../clients/sftp-client.ts';

export interface TransferArgs {
  /** ssh-style options (-p PORT, -i FILE, -o OPT). */
  readonly ssh: string[];
  readonly rest: string[];
  readonly batch?: string;
  readonly recursive: boolean;
  readonly quiet: boolean;
}

/** sftp/scp options: -P is the port (ssh's -p); -b batch file (sftp); -r recursive (scp). */
export function transferArgs(argv: readonly string[]): TransferArgs | string {
  const ssh: string[] = [];
  let batch: string | undefined;
  let recursive = false;
  let quiet = false;
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('-') || a === '-') break;
    const value = (): string | undefined => (a.length > 2 ? a.slice(2) : argv[++i]);
    if (a.startsWith('-P')) ssh.push('-p', value() ?? '');
    else if (a.startsWith('-i')) ssh.push('-i', value() ?? '');
    else if (a.startsWith('-o')) ssh.push('-o', value() ?? '');
    else if (a.startsWith('-b')) batch = value();
    else if (a === '-r') recursive = true;
    else if (a === '-q') quiet = true;
    else if (!['-4', '-C', '-p', '-v', '-T', '-O', '-s'].includes(a)) return `unknown option -- ${a.replace(/^-+/, '')}`;
  }
  return { ssh, rest: argv.slice(i), batch, recursive, quiet };
}

/** Options for the login of `[user@]host` (port and identities from the command line). */
export function loginOptions(ctx: Ctx, t: TransferArgs, dest: string): SshOptions | string {
  const user = ctx.sh.env.users().find((u) => u.uid === ctx.cred.uid)?.name ?? 'root';
  const opts = parseSshArgs([...t.ssh, dest], user);
  return typeof opts === 'string' ? opts : { ...opts, subsystem: 'sftp', batch: opts.batch || t.batch !== undefined };
}

function show(ctx: Ctx, r: LoginResult): void {
  if (r.lines.length) ctx.err(`${r.lines.join('\n')}\n`);
}

/** Logs in and opens the sftp subsystem; a number is the exit status when it fails. */
export function* sftpLogin(ctx: Ctx, host: Host, opts: SshOptions): Gen<SftpSession | number> {
  const acct = ctx.sh.env.users().find((u) => u.uid === ctx.cred.uid);
  if (!acct) return 255;
  const login = new SshLogin(host, 'Linux', linuxSshStore(ctx.sh.env.fs, acct, ctx.cwd), opts);
  let r = login.begin();
  for (;;) {
    show(ctx, r);
    if (r.failed) return 255;
    if (r.session) break;
    const line = yield* ctx.readLine(login.prompt(), login.secret());
    if (line === null) return 255;
    r = login.input(line.text);
  }
  const session = new SftpSession(host, r.session.ip, opts.port, r.session.id);
  session.start();
  return session;
}
