/**
 * ssh-keygen (OpenSSH 10): generates key pairs in ~/.ssh with OpenSSH's prompts, shows fingerprints (-l),
 * derives the public key (-y), changes the passphrase (-p) and searches or edits known_hosts (-F, -R).
 */
import type { Ctx, Gen, LineRead } from '../bash/types.ts';
import type { KeyPair, KeyType } from '../net/ssh-keys.ts';
import { generateKey, privateFile, parsePrivateFile, parsePublicLine, publicLine, fingerprint, randomart, isEncrypted, LABEL } from '../net/ssh-keys.ts';
import { readLineFrom } from '../bash/io.ts';
import { FsError } from '../bash/vfs.ts';
import { knownHostsFind, knownHostsRemove } from './known-hosts.ts';
import { parseAuthorizedLine } from '../services/authorized-keys.ts';

const USAGE = [
  'usage: ssh-keygen [-q] [-a rounds] [-b bits] [-C comment] [-f output_keyfile]',
  '                  [-m format] [-N new_passphrase] [-O option]',
  '                  [-t ecdsa | ecdsa-sk | ed25519 | ed25519-sk | rsa]',
  '                  [-w provider] [-Z cipher]',
  '       ssh-keygen -p [-a rounds] [-f keyfile] [-m format] [-N new_passphrase]',
  '                   [-P old_passphrase] [-Z cipher]',
  '       ssh-keygen -l [-v] [-E fingerprint_hash] [-f input_keyfile]',
  '       ssh-keygen -y [-f input_keyfile]',
  '       ssh-keygen -F hostname [-lv] [-f known_hosts_file]',
  '       ssh-keygen -R hostname [-f known_hosts_file]',
].join('\n');

const WITH_VALUE = new Set(['a', 'b', 'C', 'f', 'm', 'N', 'O', 'P', 't', 'w', 'Z', 'E', 'F', 'R']);
const FLAGS = new Set(['q', 'l', 'y', 'p', 'v', 'A']);
const DEFAULT_BITS: Readonly<Record<KeyType, number>> = { ed25519: 256, ecdsa: 256, rsa: 3072 };
const RSA_MIN = 1024;
const RSA_MAX = 16384;
const PRIVATE_MODE = 0o600;
const PUBLIC_MODE = 0o644;
const DIR_MODE = 0o700;
const EXIT_USAGE = 255;

interface Opts {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

function parseOpts(argv: readonly string[]): Opts | string {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('-') || a === '-') return USAGE;
    for (let j = 1; j < a.length; j++) {
      const c = a[j] ?? '';
      if (WITH_VALUE.has(c)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : argv[++i];
        if (v === undefined) return `ssh-keygen: option requires an argument -- ${c}\n${USAGE}`;
        values.set(c, v);
        break;
      }
      if (!FLAGS.has(c)) return `ssh-keygen: invalid option -- '${c}'\n${USAGE}`;
      flags.add(c);
    }
  }
  return { values, flags };
}

// ------------------------------------------------------------ files

function home(ctx: Ctx): string {
  return ctx.sh.user.home === '/' ? '' : ctx.sh.user.home;
}

function readText(ctx: Ctx, path: string): string | null {
  try {
    return ctx.sh.env.fs.readFile(path, ctx.cred);
  } catch (e) {
    ctx.err(`${path}: ${e instanceof FsError ? e.message : 'No such file or directory'}\n`);
    return null;
  }
}

function write(ctx: Ctx, path: string, text: string, mode: number): boolean {
  const fs = ctx.sh.env.fs;
  try {
    if (fs.tryLookup(path, ctx.cred)) fs.writeFile(path, '', ctx.cred);
    fs.writeFile(path, text, ctx.cred, false, mode);
    fs.chmod(path, mode, ctx.cred);
    return true;
  } catch (e) {
    ctx.err(`Saving key "${path}" failed: ${e instanceof FsError ? e.message.replace(/^.*: /, '') : 'Permission denied'}\n`);
    return false;
  }
}

function* ask(prompt: string, secret: boolean): Gen<string | null> {
  const r: LineRead | null = yield* readLineFrom({ kind: 'tty' }, prompt, secret);
  return r === null ? null : r.text;
}

/** Asks twice for a new passphrase (until both match); null = Ctrl+D. */
function* newPassphrase(ctx: Ctx, first: string): Gen<string | null> {
  for (;;) {
    const a = yield* ask(first, true);
    if (a === null) return null;
    const b = yield* ask('Enter same passphrase again: ', true);
    if (b === null) return null;
    if (a === b) return a;
    ctx.err('Passphrases do not match.  Try again.\n');
  }
}

// ------------------------------------------------------------ generation

function keyType(ctx: Ctx, o: Opts): { type: KeyType; bits: number } | null {
  const t = (o.values.get('t') ?? 'ed25519').toLowerCase();
  if (t !== 'ed25519' && t !== 'ecdsa' && t !== 'rsa') {
    ctx.err(`unknown key type ${t}\n`);
    return null;
  }
  const text = o.values.get('b');
  const bits = text === undefined ? DEFAULT_BITS[t] : /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isNaN(bits)) {
    ctx.err(`Bits has bad value ${text ?? ''} (invalid)\n`);
    return null;
  }
  if (t === 'rsa' && (bits < RSA_MIN || bits > RSA_MAX || bits % 8 !== 0)) {
    ctx.err(bits > RSA_MAX ? `Invalid RSA key length: maximum is ${RSA_MAX} bits\n` : `Invalid RSA key length: minimum is ${RSA_MIN} bits\n`);
    return null;
  }
  if (t === 'ecdsa' && bits !== 256) {
    ctx.err(bits === 384 || bits === 521 ? 'Invalid ECDSA key length: Netfix only generates 256-bit keys (nistp256)\n' : 'Invalid ECDSA key length: valid lengths are 256, 384 or 521 bits\n');
    return null;
  }
  return { type: t, bits: t === 'ed25519' ? 256 : bits };
}

/** Output file, asked when -f is missing; creates ~/.ssh when needed. Null = abort. */
function* outputPath(ctx: Ctx, o: Opts, type: KeyType): Gen<string | null> {
  const fs = ctx.sh.env.fs;
  const dflt = `${home(ctx)}/.ssh/id_${type}`;
  let path = o.values.get('f');
  if (path === undefined) {
    const answer = yield* ask(`Enter file in which to save the key (${dflt}): `, false);
    if (answer === null) return null;
    path = answer.trim() || dflt;
  }
  path = ctx.resolve(path.replace(/^~(?=\/|$)/, ctx.sh.user.home));
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  if (path === dflt && !fs.tryLookup(dir, ctx.cred)) {
    try {
      fs.mkdir(dir, ctx.cred, false, DIR_MODE);
      ctx.out(`Created directory '${dir}'.\n`);
    } catch {
      ctx.err(`Could not create directory '${dir}'.\n`);
    }
  }
  if (!fs.tryLookup(path, ctx.cred)) return path;
  ctx.out(`${path} already exists.\n`);
  const yes = yield* ask('Overwrite (y/n)? ', false);
  return yes !== null && /^y/i.test(yes.trim()) ? path : null;
}

function* generate(ctx: Ctx, o: Opts): Gen<number> {
  const kind = keyType(ctx, o);
  if (!kind) return 1;
  const quiet = o.flags.has('q');
  if (!quiet) ctx.out(`Generating public/private ${kind.type} key pair.\n`);
  const path = yield* outputPath(ctx, o, kind.type);
  if (path === null) return 1;
  const pass = o.values.get('N') ?? (yield* newPassphrase(ctx, `Enter passphrase for "${path}" (empty for no passphrase): `));
  if (pass === null) return 1;
  const kp = generateKey(kind.type, kind.bits, o.values.get('C') ?? `${ctx.sh.user.name}@${ctx.sh.env.hostname}`);
  if (!write(ctx, path, privateFile(kp, pass), PRIVATE_MODE)) return 1;
  if (!write(ctx, `${path}.pub`, `${publicLine(kp)}\n`, PUBLIC_MODE)) return 1;
  if (quiet) return 0;
  ctx.out([
    `Your identification has been saved in ${path}`,
    `Your public key has been saved in ${path}.pub`,
    'The key fingerprint is:',
    `${fingerprint(kp.blob)} ${kp.comment}`,
    "The key's randomart image is:",
    ...randomart(kp),
  ].join('\n') + '\n');
  return 0;
}

// ------------------------------------------------------------ existing keys

function* keyPath(ctx: Ctx, o: Opts, prompt: string): Gen<string | null> {
  const given = o.values.get('f');
  if (given !== undefined) return ctx.resolve(given);
  const dflt = `${home(ctx)}/.ssh/id_ed25519`;
  const answer = yield* ask(`${prompt} (${dflt}): `, false);
  return answer === null ? null : ctx.resolve(answer.trim() || dflt);
}

/** The private key of `path`, asking for its passphrase (with -P as the answer) when needed. */
function* loadPrivate(ctx: Ctx, path: string, text: string, given?: string): Gen<KeyPair | null> {
  let pass = given ?? '';
  if (given === undefined && isEncrypted(text)) {
    const answer = yield* ask('Enter passphrase: ', true);
    if (answer === null) return null;
    pass = answer;
  }
  const kp = parsePrivateFile(text, pass);
  if (kp === 'invalid') ctx.err(`Load key "${path}": invalid format\n`);
  if (kp === 'bad-passphrase') ctx.err(`Load key "${path}": incorrect passphrase supplied to decrypt private key\n`);
  return typeof kp === 'string' ? null : kp;
}

function* listFingerprint(ctx: Ctx, o: Opts): Gen<number> {
  const path = yield* keyPath(ctx, o, 'Enter file in which the key is');
  if (path === null) return 1;
  const fs = ctx.sh.env.fs;
  const pub = path.endsWith('.pub') || !fs.tryLookup(`${path}.pub`, ctx.cred) ? path : `${path}.pub`;
  const text = readText(ctx, pub);
  if (text === null) return 1;
  const keys = text.split('\n').map((l) => parsePublicLine(l) ?? parseAuthorizedLine(l)?.key ?? null).filter((k) => k !== null);
  if (!keys.length) {
    const kp = parsePrivateFile(text, '');
    if (typeof kp === 'string') { ctx.err(`${path} is not a key file.\n`); return 1; }
    keys.push(kp);
  }
  ctx.out(keys.map((k) => `${k.bits} ${fingerprint(k.blob)} ${k.comment || 'no comment'} (${LABEL[k.type]})`).join('\n') + '\n');
  return 0;
}

function* printPublic(ctx: Ctx, o: Opts): Gen<number> {
  const path = yield* keyPath(ctx, o, 'Enter file in which the key is');
  const text = path === null ? null : readText(ctx, path);
  if (path === null || text === null) return 1;
  const kp = yield* loadPrivate(ctx, path, text, o.values.get('P'));
  if (!kp) return 1;
  ctx.out(`${publicLine(kp)}\n`);
  return 0;
}

function* changePassphrase(ctx: Ctx, o: Opts): Gen<number> {
  const path = yield* keyPath(ctx, o, 'Enter file in which the key is');
  const text = path === null ? null : readText(ctx, path);
  if (path === null || text === null) return 1;
  const kp = yield* loadPrivate(ctx, path, text, o.values.get('P') ?? (isEncrypted(text) ? undefined : ''));
  if (!kp) return 1;
  if (!o.values.has('N')) ctx.out(`Key has comment '${kp.comment}'\n`);
  const pass = o.values.get('N') ?? (yield* newPassphrase(ctx, 'Enter new passphrase (empty for no passphrase): '));
  if (pass === null || !write(ctx, path, privateFile(kp, pass), PRIVATE_MODE)) return 1;
  ctx.out('Your identification has been saved with the new passphrase.\n');
  return 0;
}

// ------------------------------------------------------------ known_hosts

function knownHostsFile(ctx: Ctx, o: Opts): string {
  return ctx.resolve(o.values.get('f') ?? `${home(ctx)}/.ssh/known_hosts`);
}

function findHost(ctx: Ctx, o: Opts, name: string): number {
  const path = knownHostsFile(ctx, o);
  const fs = ctx.sh.env.fs;
  const text = fs.tryLookup(path, ctx.cred) ? readText(ctx, path) : '';
  if (text === null) return 1;
  const found = knownHostsFind(text, name);
  for (const f of found) ctx.out(`# Host ${name} found: line ${f.line} \n${f.text}\n`);
  return found.length ? 0 : 1;
}

function removeHost(ctx: Ctx, o: Opts, name: string): number {
  const path = knownHostsFile(ctx, o);
  const fs = ctx.sh.env.fs;
  if (!fs.tryLookup(path, ctx.cred)) {
    ctx.err(`Cannot stat ${path}: No such file or directory\n`);
    return EXIT_USAGE;
  }
  const text = readText(ctx, path);
  if (text === null) return 1;
  const r = knownHostsRemove(text, name);
  if (!r.removed.length) {
    ctx.out(`Host ${name} not found in ${path}\n`);
    return 0;
  }
  const mode = fs.stat(path, ctx.cred).mode & 0o777;
  if (!write(ctx, `${path}.old`, text, mode) || !write(ctx, path, r.text, mode)) return 1;
  ctx.out(`${r.removed.map((n) => `# Host ${name} found: line ${n}`).join('\n')}\n${path} updated.\nOriginal contents retained as ${path}.old\n`);
  return 0;
}

const HOST_KEY_TYPES: readonly KeyType[] = ['rsa', 'ecdsa', 'ed25519'];

/** -A: creates the host keys missing from /etc/ssh (as Ubuntu's postinst does). */
function hostKeys(ctx: Ctx): number {
  const fs = ctx.sh.env.fs;
  const missing = HOST_KEY_TYPES.filter((t) => !fs.tryLookup(`/etc/ssh/ssh_host_${t}_key`, ctx.cred));
  if (!missing.length) return 0;
  ctx.out(`ssh-keygen: generating new host keys: ${missing.map((t) => LABEL[t]).join(' ')} \n`);
  for (const t of missing) {
    const kp = generateKey(t, DEFAULT_BITS[t], `root@${ctx.sh.env.hostname}`);
    const path = `/etc/ssh/ssh_host_${t}_key`;
    if (!write(ctx, path, privateFile(kp, ''), PRIVATE_MODE) || !write(ctx, `${path}.pub`, `${publicLine(kp)}\n`, PUBLIC_MODE)) return 1;
  }
  return 0;
}

export function* sshKeygen(ctx: Ctx): Gen<number> {
  const o = parseOpts(ctx.argv.slice(1));
  if (typeof o === 'string') { ctx.err(`${o}\n`); return 1; }
  const host = o.values.get('F') ?? o.values.get('R');
  if (o.values.has('F') && host !== undefined) return findHost(ctx, o, host);
  if (o.values.has('R') && host !== undefined) return removeHost(ctx, o, host);
  if (o.flags.has('A')) return hostKeys(ctx);
  if (o.flags.has('l')) return yield* listFingerprint(ctx, o);
  if (o.flags.has('y')) return yield* printPublic(ctx, o);
  if (o.flags.has('p')) return yield* changePassphrase(ctx, o);
  return yield* generate(ctx, o);
}
