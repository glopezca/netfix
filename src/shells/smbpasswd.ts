/**
 * smbpasswd (samba-common-bin): root adds (-a), deletes (-x), disables (-d) and enables (-e) Samba accounts of Linux
 * users and sets their SMB password; anyone else may only change their own. -s reads the passwords from stdin
 * without prompts (for scripts: printf 'clave\nclave\n' | smbpasswd -s -a ana).
 */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { ntHash, readPassdb, removeSmbAccount, setSmbDisabled, setSmbPassword, unixAccount, writePassdb } from '../services/smb-passdb.ts';
import type { SmbAccount } from '../services/smb-passdb.ts';

const USAGE = `When run by root:
    smbpasswd [options] [username]
otherwise:
    smbpasswd [options]

options:
  -L                   local mode (must be first option)
  -h                   print this usage message
  -s                   use stdin for password prompt
  -c smb.conf file     Use the given path to the smb.conf file
  -D LEVEL             debug level
  -r MACHINE           remote machine
  -U USER              remote username (e.g. SAM/user)
extra options when run by root or in local mode:
  -a                   add user
  -d                   disable user
  -e                   enable user
  -x                   delete user
`;

type Action = 'password' | 'add' | 'delete' | 'disable' | 'enable';
const FLAGS: Readonly<Record<string, Action>> = { '-a': 'add', '-x': 'delete', '-d': 'disable', '-e': 'enable' };

interface Options {
  readonly action: Action;
  readonly silent: boolean;
  readonly user?: string;
}

function parseArgs(argv: readonly string[]): Options | null {
  let action: Action = 'password';
  let silent = false;
  let user: string | undefined;
  for (const a of argv) {
    if (a === '-s') silent = true;
    else if (a === '-L') continue;
    else if (FLAGS[a]) {
      if (action !== 'password') return null;
      action = FLAGS[a] ?? 'password';
    } else if (!a.startsWith('-') && user === undefined) user = a;
    else return null;
  }
  return { action, silent, ...(user !== undefined ? { user } : {}) };
}

/** Reads one password: from stdin with -s, else at a prompt that does not echo. */
function* password(ctx: Ctx, silent: boolean, prompt: string): Gen<string | null> {
  const line = silent ? yield* ctx.readLine() : yield* ctx.readLine(prompt, true);
  return line ? line.text : null;
}

/** The new password twice, as smbpasswd asks for it; null (and the message) when they differ. */
function* newPassword(ctx: Ctx, silent: boolean): Gen<string | null> {
  const first = yield* password(ctx, silent, 'New SMB password:');
  const again = yield* password(ctx, silent, 'Retype new SMB password:');
  if (first === null || first !== again) {
    ctx.err('Mismatch - password unchanged.\nUnable to get new password.\n');
    return null;
  }
  return first;
}

/** -x, -d and -e: no password, one message each. */
function toggle(ctx: Ctx, accounts: readonly SmbAccount[], action: 'delete' | 'disable' | 'enable', name: string): number {
  const fs = ctx.sh.env.fs;
  if (!accounts.some((a) => a.name === name)) {
    ctx.err(action === 'delete' ? `Failed to delete entry for user ${name}.\n` : `Failed to find entry for user ${name}.\n`);
    return 1;
  }
  if (action === 'delete') writePassdb(fs, removeSmbAccount(accounts, name));
  else writePassdb(fs, setSmbDisabled(accounts, name, action === 'disable'));
  ctx.out(`${{ delete: 'Deleted', disable: 'Disabled', enable: 'Enabled' }[action]} user ${name}.\n`);
  return 0;
}

function* asRoot(ctx: Ctx, o: Options, name: string): Gen<number> {
  const fs = ctx.sh.env.fs;
  const accounts = readPassdb(fs);
  if (o.action === 'delete' || o.action === 'disable' || o.action === 'enable') return toggle(ctx, accounts, o.action, name);
  const pass = yield* newPassword(ctx, o.silent);
  if (pass === null) return 1;
  const unix = unixAccount(fs, name);
  const known = accounts.some((a) => a.name === name);
  if (o.action === 'add' && !unix) { ctx.err(`Failed to add entry for user ${name}.\n`); return 1; }
  if (o.action === 'password' && (!known || !unix)) {
    ctx.err(`Failed to find entry for user ${name}.\nFailed to modify password entry for user ${name}\n`);
    return 1;
  }
  writePassdb(fs, setSmbPassword(accounts, name, unix?.uid ?? 0, pass));
  if (o.action === 'add' && !known) ctx.out(`Added user ${name}.\n`);
  return 0;
}

/** A user changes their own SMB password, proving the old one. */
function* ownPassword(ctx: Ctx, o: Options, name: string): Gen<number> {
  const fs = ctx.sh.env.fs;
  const accounts = readPassdb(fs);
  const old = yield* password(ctx, o.silent, 'Old SMB password:');
  const mine = accounts.find((a) => a.name === name);
  const pass = yield* newPassword(ctx, o.silent);
  if (pass === null) return 1;
  if (!mine || old === null || mine.hash !== ntHash(old)) {
    ctx.err('Could not connect to machine 127.0.0.1: NT_STATUS_LOGON_FAILURE\nFailed to change password for ' + name + '\n');
    return 1;
  }
  writePassdb(fs, setSmbPassword(accounts, name, mine.uid, pass));
  ctx.out(`Password changed for user ${name}\n`);
  return 0;
}

function* run(ctx: Ctx): Gen<number> {
  const o = parseArgs(ctx.argv.slice(1));
  const self = ctx.env.get('USER') ?? '';
  if (!o || (ctx.cred.uid !== 0 && (o.action !== 'password' || (o.user !== undefined && o.user !== self)))) {
    ctx.err(USAGE);
    return 1;
  }
  const name = o.user ?? (ctx.cred.uid === 0 ? 'root' : self);
  return ctx.cred.uid === 0 ? yield* asRoot(ctx, o, name) : yield* ownPassword(ctx, o, name);
}

export function smbpasswd(host: Host): CommandFn {
  return (ctx) => {
    if (hasPackage(host, 'samba-common-bin')) return run(ctx);
    ctx.err("Command 'smbpasswd' not found, but can be installed with:\nsudo apt install samba-common-bin\n");
    return 127;
  };
}
