/**
 * The OpenSSH client's login: options, host key check against known_hosts, public key authentication
 * with ~/.ssh/id_* (passphrase, permissions) and then password, with OpenSSH's messages.
 */
import type { Host } from '../devices/host.ts';
import type { AppPayload } from '../net/packets.ts';
import { resolveHost, tcpCall } from './net-tools.ts';
import { toBase64 } from '../core/sha256.ts';
import { formatIp } from '../core/ip.ts';
import { parsePublicLine, parsePrivateFile, isEncrypted, sameBlob, fingerprint, signChallenge, verifySignature, publicLine, cryptoRandom, LABEL } from '../net/ssh-keys.ts';
import type { KeyPair, PublicKey } from '../net/ssh-keys.ts';
import { hostProofMessage, userAuthMessage } from '../services/ssh-handshake.ts';
import { hostKeyChanged, mitmPasswordDisabled, unprotectedKey } from './ssh-messages.ts';
import { knownHostsFind } from './known-hosts.ts';

export const SSH_PORT = 22;
const MAX_PASSWORD_TRIES = 3;
const MAX_PASSPHRASE_TRIES = 3;
const PRIVATE_KEY_BAD_MODES = 0o077;
const NONCE_BYTES = 16;

/** Where the client keeps known_hosts and its keys (the user's ~/.ssh). */
export interface SshClientStore {
  /** Default known_hosts path (~/.ssh/known_hosts), as shown in messages. */
  readonly knownHostsPath: string;
  knownHosts(path: string): string;
  addKnownHost(path: string, line: string): void;
  /** Absolute paths of ~/.ssh/id_ed25519, id_ecdsa and id_rsa that exist. */
  defaultIdentities(): string[];
  readIdentity(path: string): { text: string; mode: number } | 'missing' | 'denied';
  /** Absolute path: ~ is the home, relative paths start at the working directory. */
  resolve(path: string): string;
}

export interface SshOptions {
  readonly user: string;
  readonly target: string;
  readonly port: number;
  readonly command?: string;
  readonly identities: readonly string[];
  readonly strict: 'ask' | 'yes' | 'no' | 'accept-new';
  readonly password: boolean;
  readonly pubkey: boolean;
  readonly batch: boolean;
  readonly knownHostsFile?: string;
  /** sftp/scp: ask for the sftp subsystem instead of a shell. */
  readonly subsystem?: 'sftp';
}

export const SSH_USAGE = 'usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-i identity_file] [-l login_name] [-o option] [-p port] destination [command [argument ...]]';
export const SSH_WITH_VALUE: ReadonlySet<string> = new Set(['-i', '-l', '-o', '-p', '-F', '-E', '-c', '-m', '-b', '-J', '-L', '-R', '-D', '-W', '-S', '-O', '-Q', '-B', '-e', '-w']);

type Draft = { -readonly [K in keyof SshOptions]?: SshOptions[K] } & { identities: string[] };

function yes(v: string): boolean {
  return /^(yes|true)$/i.test(v);
}

function applyOption(o: Draft, text: string): string | null {
  const m = /^(\w+)\s*[= ]\s*(.+)$/.exec(text.trim());
  if (!m) return `command-line line 0: missing argument.`;
  const key = (m[1] ?? '').toLowerCase();
  const value = (m[2] ?? '').trim();
  if (key === 'stricthostkeychecking') o.strict = /^(yes|true)$/i.test(value) ? 'yes' : /^(no|off|false)$/i.test(value) ? 'no' : value.toLowerCase() === 'accept-new' ? 'accept-new' : 'ask';
  else if (key === 'passwordauthentication') o.password = yes(value);
  else if (key === 'pubkeyauthentication') o.pubkey = yes(value);
  else if (key === 'batchmode') o.batch = yes(value);
  else if (key === 'userknownhostsfile') o.knownHostsFile = value;
  else if (key === 'identityfile') o.identities.push(value);
  else if (key === 'user') o.user = value;
  else if (key === 'port') o.port = Number(value);
  return null;
}

/** ssh's command line → options, or the error/usage text. */
export function parseSshArgs(args: readonly string[], defaultUser: string): SshOptions | string {
  const o: Draft = { identities: [] };
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (!a.startsWith('-') || a === '-') break;
    const flag = a.slice(0, 2);
    const value = a.length > 2 ? a.slice(2) : SSH_WITH_VALUE.has(flag) ? args[++i] : undefined;
    if (SSH_WITH_VALUE.has(flag) && value === undefined) return `option requires an argument -- ${flag.slice(1)}\n${SSH_USAGE}`;
    if (flag === '-i') o.identities.push(value ?? '');
    else if (flag === '-l') o.user = value;
    else if (flag === '-p') o.port = Number(value);
    else if (flag === '-o') { const err = applyOption(o, value ?? ''); if (err) return err; }
  }
  const dest = args[i];
  if (!dest) return SSH_USAGE;
  const at = dest.lastIndexOf('@');
  const command = args.slice(i + 1).join(' ');
  const port = o.port ?? SSH_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return `Bad port '${String(o.port)}'`;
  return {
    user: at >= 0 ? dest.slice(0, at) : o.user ?? defaultUser, target: at >= 0 ? dest.slice(at + 1) : dest, port,
    command: command || undefined, identities: o.identities, strict: o.strict ?? 'ask', password: o.password ?? true,
    pubkey: o.pubkey ?? true, batch: o.batch ?? false, knownHostsFile: o.knownHostsFile,
  };
}

export type LoginResult =
  | { readonly lines: string[]; readonly session?: undefined; readonly failed?: undefined }
  | { readonly lines: string[]; readonly session: { id: string; prompt: string; banner: string[]; ip: number }; readonly failed?: undefined }
  | { readonly lines: string[]; readonly failed: true; readonly session?: undefined };

type SshOut = Extract<AppPayload, { app: 'SSH'; kind: 'output' }>;
type Step =
  | { kind: 'hostkey' }
  | { kind: 'passphrase'; path: string; text: string; tries: number }
  | { kind: 'password'; tries: number }
  | { kind: 'idle' };

export class SshLogin {
  readonly opts: SshOptions;
  private readonly host: Host;
  private readonly osName: string;
  private readonly store: SshClientStore;
  private step: Step = { kind: 'idle' };
  private ip = 0;
  private hostKey: PublicKey | null = null;
  private challenge = '';
  /** Host key changed but StrictHostKeyChecking=no: OpenSSH goes on with keys only. */
  private passwordBlocked = false;
  private methods: readonly string[] = [];
  private queue: string[] = [];

  constructor(host: Host, osName: string, store: SshClientStore, opts: SshOptions) {
    this.host = host;
    this.osName = osName;
    this.store = store;
    this.opts = opts;
  }

  prompt(): string {
    const s = this.step;
    if (s.kind === 'hostkey') return 'Are you sure you want to continue connecting (yes/no/[fingerprint])? ';
    if (s.kind === 'passphrase') return `Enter passphrase for key '${s.path}': `;
    return `${this.opts.user}@${this.opts.target}'s password: `;
  }

  secret(): boolean {
    return this.step.kind === 'passphrase' || this.step.kind === 'password';
  }

  /** What the login waits for (graphical clients ask with their own dialogs). */
  waiting(): 'hostkey' | 'passphrase' | 'password' | 'nothing' {
    return this.step.kind === 'idle' ? 'nothing' : this.step.kind;
  }

  /** SHA256 fingerprint of the server's host key (for a graphical "unknown host" dialog). */
  hostFingerprint(): string {
    return this.hostKey ? fingerprint(this.hostKey.blob) : '';
  }

  private call(payload: Omit<Extract<AppPayload, { app: 'SSH'; kind: 'auth' }>, 'app' | 'kind' | 'clientOs' | 'challenge'>): SshOut | undefined {
    const r = tcpCall(this.host, this.ip, this.opts.port, { app: 'SSH', kind: 'auth', clientOs: this.osName, challenge: this.challenge, subsystem: this.opts.subsystem, ...payload });
    return r.kind === 'ok' && r.reply.app === 'SSH' && r.reply.kind === 'output' ? r.reply : undefined;
  }

  private fail(lines: string[]): LoginResult {
    return { lines, failed: true };
  }

  /** Like OpenSSH, missing -i files are reported before connecting. */
  begin(): LoginResult {
    const explicit = this.opts.identities.map((p) => this.store.resolve(p));
    const missing = this.opts.identities.filter((p) => this.store.readIdentity(this.store.resolve(p)) === 'missing');
    this.queue = explicit.filter((p) => this.store.readIdentity(p) !== 'missing');
    const warnings = missing.map((p) => `Warning: Identity file ${p} not accessible: No such file or directory.`);
    const r = this.connect();
    return { ...r, lines: [...warnings, ...r.lines] } as LoginResult;
  }

  private connect(): LoginResult {
    const { target, port } = this.opts;
    const resolved = resolveHost(this.host, target);
    if (resolved.kind === 'error') return this.fail([`ssh: Could not resolve hostname ${target}: Name or service not known`]);
    this.ip = resolved.ip;
    const nonce = toBase64(cryptoRandom(NONCE_BYTES));
    const probe = tcpCall(this.host, this.ip, port, { app: 'SSH', kind: 'auth', method: 'none', nonce, user: this.opts.user, password: '', clientOs: this.osName });
    if (probe.kind === 'refused') return this.fail([`ssh: connect to host ${target} port ${port}: Connection refused`]);
    if (probe.kind !== 'ok') return this.fail([`ssh: connect to host ${target} port ${port}: ${probe.kind === 'noroute' ? 'Network is unreachable' : 'Connection timed out'}`]);
    const out = probe.reply.app === 'SSH' && probe.reply.kind === 'output' ? probe.reply : undefined;
    this.hostKey = out?.hostKey ? parsePublicLine(out.hostKey) : null;
    if (!out || !this.hostKey) return this.fail([out?.lines[0] ?? `kex_exchange_identification: Connection closed by remote host`, `Connection closed by ${formatIp(this.ip)} port ${port}`]);
    this.challenge = out.challenge ?? '';
    // The server proves it holds the private host key: otherwise anyone could present a copied public key.
    if (!verifySignature(this.hostKey.blob, hostProofMessage(nonce, this.challenge), out.hostSignature ?? '')) {
      return this.fail([`ssh_dispatch_run_fatal: Connection to ${formatIp(this.ip)} port ${port}: incorrect signature`]);
    }
    this.methods = out.methods ?? [];
    return this.checkHostKey();
  }

  // ------------------------------------------------------------ host key

  private knownName(): string {
    return this.opts.port === SSH_PORT ? this.opts.target.toLowerCase() : `[${this.opts.target.toLowerCase()}]:${this.opts.port}`;
  }

  private knownHostsPath(): string {
    return this.opts.knownHostsFile ? this.store.resolve(this.opts.knownHostsFile) : this.store.knownHostsPath;
  }

  private known(): { line: number; key: PublicKey }[] {
    if (this.opts.knownHostsFile === '/dev/null') return [];
    return knownHostsFind(this.store.knownHosts(this.knownHostsPath()), this.knownName()).flatMap((f) => {
      const key = parsePublicLine(f.text.split(/\s+/).slice(1).join(' '));
      return key ? [{ line: f.line, key }] : [];
    });
  }

  private checkHostKey(): LoginResult {
    const key = this.hostKey;
    if (!key) return this.fail(['Host key verification failed.']);
    const same = this.known().filter((k) => k.key.type === key.type);
    if (same.some((k) => sameBlob(k.key.blob, key.blob))) return this.authenticate([]);
    const changed = same[0];
    if (changed) {
      const warning = hostKeyChanged(LABEL[key.type], fingerprint(key.blob), this.knownHostsPath(), changed.line, this.opts.target);
      if (this.opts.strict !== 'no') return this.fail(warning);
      this.passwordBlocked = true;
      return this.authenticate([...warning.slice(0, -2), ...mitmPasswordDisabled()]);
    }
    const fp = fingerprint(key.blob);
    if (this.opts.strict === 'no' || this.opts.strict === 'accept-new') return this.authenticate(this.remember());
    if (this.opts.strict === 'yes' || this.opts.batch) return this.fail([`No ${LABEL[key.type]} host key is known for ${this.opts.target} and you have requested strict checking.`, 'Host key verification failed.']);
    this.step = { kind: 'hostkey' };
    const shown = this.opts.target === formatIp(this.ip) ? this.opts.target : `${this.opts.target} (${formatIp(this.ip)})`;
    return { lines: [`The authenticity of host '${shown}' can't be established.`, `${LABEL[key.type]} key fingerprint is ${fp}.`, 'This key is not known by any other names.'] };
  }

  private remember(): string[] {
    const key = this.hostKey;
    if (!key || this.opts.knownHostsFile === '/dev/null') return key ? [`Warning: Permanently added '${this.opts.target}' (${LABEL[key.type]}) to the list of known hosts.`] : [];
    this.store.addKnownHost(this.knownHostsPath(), `${this.knownName()} ${publicLine({ ...key, comment: '' })}`);
    return [`Warning: Permanently added '${this.opts.target}' (${LABEL[key.type]}) to the list of known hosts.`];
  }

  private answerHostKey(line: string): LoginResult {
    const a = line.trim();
    const fp = this.hostKey ? fingerprint(this.hostKey.blob) : '';
    if (a === 'yes' || (a !== '' && a === fp)) {
      this.step = { kind: 'idle' };
      return this.authenticate(this.remember());
    }
    if (a === 'no') return this.fail(['Host key verification failed.']);
    return { lines: ["Please type 'yes', 'no' or the fingerprint: "] };
  }

  // ------------------------------------------------------------ authentication

  private authenticate(lines: string[]): LoginResult {
    const pubkey = this.opts.pubkey && this.methods.includes('publickey');
    this.queue = pubkey ? [...new Set([...this.queue, ...this.store.defaultIdentities()])] : [];
    return this.nextIdentity(lines);
  }

  private nextIdentity(lines: string[]): LoginResult {
    for (let path = this.queue.shift(); path !== undefined; path = this.queue.shift()) {
      const file = this.store.readIdentity(path);
      if (typeof file === 'string') continue;
      if ((file.mode & PRIVATE_KEY_BAD_MODES) !== 0) {
        lines.push(...unprotectedKey(file.mode, path));
        continue;
      }
      if (isEncrypted(file.text)) {
        if (this.opts.batch) continue;
        this.step = { kind: 'passphrase', path, text: file.text, tries: 0 };
        return { lines };
      }
      const kp = parsePrivateFile(file.text, '');
      if (typeof kp === 'string') {
        lines.push(`Load key "${path}": invalid format`);
        continue;
      }
      const r = this.tryKey(kp, lines);
      if (r) return r;
    }
    return this.passwordStep(lines);
  }

  private tryKey(kp: KeyPair, lines: string[]): LoginResult | null {
    const key = publicLine(kp);
    const out = this.call({ method: 'publickey', user: this.opts.user, password: '', key, signature: signChallenge(kp, userAuthMessage(this.challenge, this.hostKey?.blob ?? new Uint8Array(), this.opts.user, key)) });
    if (out?.ok && out.session) return this.opened(out, lines);
    if (out?.closed) return this.fail([...lines, ...out.lines]);
    return null;
  }

  private answerPassphrase(line: string): LoginResult {
    const s = this.step;
    if (s.kind !== 'passphrase') return { lines: [] };
    if (line === '') {
      this.step = { kind: 'idle' };
      return this.nextIdentity([]);
    }
    const kp = parsePrivateFile(s.text, line);
    if (typeof kp === 'string') {
      if (s.tries + 1 >= MAX_PASSPHRASE_TRIES) {
        this.step = { kind: 'idle' };
        return this.nextIdentity([]);
      }
      this.step = { ...s, tries: s.tries + 1 };
      return { lines: [] };
    }
    this.step = { kind: 'idle' };
    return this.tryKey(kp, []) ?? this.nextIdentity([]);
  }

  private passwordStep(lines: string[]): LoginResult {
    if (this.opts.password && !this.passwordBlocked && !this.opts.batch && this.methods.includes('password')) {
      this.step = { kind: 'password', tries: 0 };
      return { lines };
    }
    return this.fail([...lines, this.denied()]);
  }

  private denied(): string {
    return `${this.opts.user}@${this.opts.target}: Permission denied (${this.methods.join(',') || 'none'}).`;
  }

  private answerPassword(line: string): LoginResult {
    const s = this.step;
    if (s.kind !== 'password') return { lines: [] };
    const out = this.call({ method: 'password', user: this.opts.user, password: line });
    if (!out) return this.fail([`Connection to ${this.opts.target} closed by remote host.`]);
    if (out.ok && out.session) return this.opened(out, []);
    if (out.closed) return this.fail([...out.lines]);
    if (s.tries + 1 >= MAX_PASSWORD_TRIES) return this.fail([this.denied()]);
    this.step = { kind: 'password', tries: s.tries + 1 };
    return { lines: ['Permission denied, please try again.'] };
  }

  private opened(out: SshOut, lines: string[]): LoginResult {
    this.step = { kind: 'idle' };
    return { lines, session: { id: out.session ?? '', prompt: out.prompt ?? '$ ', banner: [...out.lines], ip: this.ip } };
  }

  input(line: string): LoginResult {
    if (this.step.kind === 'hostkey') return this.answerHostKey(line);
    if (this.step.kind === 'passphrase') return this.answerPassphrase(line);
    if (this.step.kind === 'password') return this.answerPassword(line);
    return { lines: [] };
  }
}
