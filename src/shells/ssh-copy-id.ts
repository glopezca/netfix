/**
 * ssh-copy-id: installs a public key in the remote ~/.ssh/authorized_keys through ssh (the password is
 * asked by ssh), creating ~/.ssh with mode 700 and the file with mode 600, without duplicating keys.
 */
import type { Ctx, Gen } from '../bash/types.ts';
import { parsePublicLine } from '../net/ssh-keys.ts';

const PROG = '/usr/bin/ssh-copy-id';
const DEFAULT_KEYS = ['id_ed25519.pub', 'id_ecdsa.pub', 'id_rsa.pub'];
/** Remote exit status meaning "every key was already there". */
const ALREADY = 7;
const USAGE = `Usage: ${PROG} [-h|-?|-f|-n|-s|-x] [-i [identity_file]] [-t target_path] [-F ssh_config] [[-o <ssh -o options>] ...] [-p port] [user@]hostname
\t-f: force mode -- copy keys without trying to check if they are already installed
\t-n: dry run    -- no keys are actually copied
\t-h|-?: print this help`;

interface CopyOpts {
  readonly identity?: string;
  readonly sshArgs: readonly string[];
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly dest: string;
}

function parse(argv: readonly string[]): CopyOpts | null {
  const sshArgs: string[] = [];
  let identity: string | undefined;
  let force = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '-i') identity = argv[++i];
    else if (a.startsWith('-i')) identity = a.slice(2);
    else if (a === '-p' || a === '-o') sshArgs.push(a, argv[++i] ?? '');
    else if (/^-[po]./.test(a)) sshArgs.push(a.slice(0, 2), a.slice(2));
    else if (a === '-f') force = true;
    else if (a === '-n') dryRun = true;
    else if (a.startsWith('-')) return null;
    else return argv.length === i + 1 ? { identity, sshArgs, force, dryRun, dest: a } : null;
  }
  return null;
}

/** Quotes for the remote shell. */
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function identityFile(ctx: Ctx, given: string | undefined): string | null {
  const fs = ctx.sh.env.fs;
  const home = ctx.sh.user.home === '/' ? '' : ctx.sh.user.home;
  if (given !== undefined) {
    const path = ctx.resolve(given.replace(/^~(?=\/)/, ctx.sh.user.home));
    return path.endsWith('.pub') ? path : `${path}.pub`;
  }
  return DEFAULT_KEYS.map((n) => `${home}/.ssh/${n}`).find((p) => fs.tryLookup(p, ctx.cred)?.kind === 'file') ?? null;
}

/**
 * Remote command: creates ~/.ssh and authorized_keys (umask 077), stops with ALREADY when the key (type and
 * base64, whatever its comment) is there, adds a missing final newline and appends the key line.
 */
function remoteScript(keyLine: string, force: boolean): string {
  const [type = '', blob = ''] = keyLine.split(/\s+/);
  const file = '.ssh/authorized_keys';
  const check = force ? '' : `{ grep -v '^#' ${file} | grep -qF -- ${quote(`${type} ${blob}`)} && exit ${ALREADY}; true; } && `;
  return `cd && umask 077 && mkdir -p .ssh && touch ${file} && ${check}{ [ -z "$(tail -c1 ${file})" ] || echo >> ${file}; } && echo ${quote(keyLine)} >> ${file}`;
}

export function* sshCopyId(ctx: Ctx): Gen<number> {
  const o = parse(ctx.argv.slice(1));
  if (!o) { ctx.err(`${USAGE}\n`); return 1; }
  const path = identityFile(ctx, o.identity);
  const text = path === null ? null : (() => { try { return ctx.sh.env.fs.readFile(path, ctx.cred); } catch { return null; } })();
  if (path === null || text === null) {
    ctx.err(`${PROG}: ERROR: ${path === null ? 'No identities found' : `failed to open ID file '${path}': No such file or directory`}\n`);
    return 1;
  }
  const key = text.split('\n').find((l) => parsePublicLine(l) !== null)?.trim();
  if (!key) { ctx.err(`${PROG}: ERROR: ${path} is not a public key\n`); return 1; }
  ctx.err(`${PROG}: INFO: Source of key(s) to be installed: "${path}"\n`);
  if (o.dryRun) {
    ctx.out(`=-=-=-=-=-=-=-=\nWould have added the following key(s):\n\n${key}\n=-=-=-=-=-=-=-=\n`);
    return 0;
  }
  if (!o.force) ctx.err(`${PROG}: INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys\n`);
  const status = Number((yield { kind: 'ssh', args: [...o.sshArgs, o.dest, remoteScript(key, o.force)], cwd: ctx.cwd }) ?? 255);
  if (status === ALREADY) {
    ctx.err(`\n${PROG}: WARNING: All keys were skipped because they already exist on the remote system.\n\t\t(if you think this is a mistake, you may want to use -f option)\n\n`);
    return 0;
  }
  if (status !== 0) return 1;
  const port = o.sshArgs.indexOf('-p');
  const how = [...(port >= 0 ? [`-p '${o.sshArgs[port + 1] ?? ''}'`] : []), `'${o.dest}'`].join(' ');
  ctx.out(`\nNumber of key(s) added: 1\n\nNow try logging into the machine, with: "ssh ${how}"\nand check to make sure that only the key(s) you wanted were added.\n\n`);
  return 0;
}
