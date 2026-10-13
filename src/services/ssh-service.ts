/**
 * OpenSSH-like server: host key, /etc/ssh/sshd_config, password and public key authentication
 * (~/.ssh/authorized_keys with StrictModes) and remote shell sessions.
 */
import type { AppPayload } from '../net/packets.ts';
import type { Peer } from '../net/tcp.ts';
import type { Server } from '../devices/server.ts';
import type { ShellSession } from '../shells/base.ts';
import { createShell } from '../shells/factory.ts';
import { DEFAULT_SCREEN } from '../shells/base.ts';
import { hostUsers } from '../shells/host-system.ts';
import { hostFs } from '../devices/host-fs.ts';
import { formatIp } from '../core/ip.ts';
import { toBase64 } from '../core/sha256.ts';
import { publicLine, signChallenge, cryptoRandom } from '../net/ssh-keys.ts';
import type { KeyPair } from '../net/ssh-keys.ts';
import { DEFAULT_SSHD, parseSshdConfig } from './sshd-config.ts';
import type { SshdSettings } from './sshd-config.ts';
import { HOST_KEY_PATH, loadHostKey } from './ssh-hostkeys.ts';
import { accessDenied, checkPublicKey, groupNames, rootRefused } from './ssh-auth.ts';
import { PendingLogins, hostProofMessage, userAuthMessage } from './ssh-handshake.ts';

type SshOutput = Extract<AppPayload, { app: 'SSH'; kind: 'output' }>;
type SshAuth = Extract<AppPayload, { app: 'SSH'; kind: 'auth' }>;

const MAX_SESSIONS = 16;
const IDLE_LIMIT_MS = 30 * 60_000;
const SESSION_ID_BYTES = 12;

export class SshService {
  private readonly server: Server;
  private readonly sessions = new Map<string, { user: string; shell: ShellSession; ip: number; lastUsed: number }>();
  private counter = 0;
  settings: SshdSettings = DEFAULT_SSHD;
  private hostKey: KeyPair | null = null;
  private loaded = false;
  private readonly pending = new PendingLogins();

  constructor(server: Server) {
    this.server = server;
  }

  activeSessions(): { id: string; user: string }[] {
    return [...this.sessions.entries()].map(([id, s]) => ({ id, user: s.user }));
  }

  closeAll(): void {
    this.sessions.clear();
  }

  /** Reads sshd_config and the host key (sshd start, restart, reload, `sshd -t`); returns sshd's error or null. */
  reload(apply = true): string | null {
    const fs = hostFs(this.server);
    if (!fs) { this.loaded = true; return null; }
    const read = (p: string): string | null => (fs.tryLookup(p)?.kind === 'file' ? fs.readFile(p) : null);
    const parsed = parseSshdConfig({ read, list: (d) => (fs.tryLookup(d)?.kind === 'dir' ? fs.readdir(d) : []) });
    if (!parsed.ok) return parsed.error;
    const key = loadHostKey(read(HOST_KEY_PATH));
    if (!key) return 'sshd: no hostkeys available -- exiting.';
    if (apply) {
      this.settings = parsed.settings;
      this.hostKey = key;
      this.loaded = true;
    }
    return null;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.reload();
  }

  handle(req: AppPayload, peer: Peer): AppPayload | null {
    if (req.app !== 'SSH') return null;
    if (req.kind === 'auth') return this.auth(req, peer);
    if (req.kind === 'command' || req.kind === 'key' || req.kind === 'edit' || req.kind === 'screen') return this.command(req, peer);
    return null;
  }

  private methods(): string[] {
    return [this.settings.pubkeyAuth ? 'publickey' : '', this.settings.passwordAuth ? 'password' : ''].filter(Boolean);
  }

  private refuse(extra: Partial<SshOutput> = {}): SshOutput {
    return { app: 'SSH', kind: 'output', ok: false, lines: [], methods: this.methods(), ...extra };
  }

  private serverIp(): string {
    return formatIp(this.server.config.ip ?? 0);
  }

  /** Handshake: host key, methods, a fresh challenge and the proof that this server holds the host key. */
  private handshake(req: SshAuth, peer: Peer, hostKey: KeyPair): SshOutput {
    const challenge = this.pending.issue(peer.ip, this.server.clock.now());
    if (challenge === null) {
      this.server.log('ssh', `drop connection #64 from [${formatIp(peer.ip)}]:${peer.port} on [${this.serverIp()}]:22 past MaxStartups`);
      return this.refuse({ lines: ['kex_exchange_identification: read: Connection reset by peer'] });
    }
    const hostSignature = signChallenge(hostKey, hostProofMessage(req.nonce ?? '', challenge));
    return this.refuse({ hostKey: publicLine({ ...hostKey, comment: '' }), challenge, hostSignature });
  }

  private auth(req: SshAuth, peer: Peer): SshOutput {
    this.ensureLoaded();
    const from = `${formatIp(peer.ip)} port ${peer.port}`;
    if (!this.hostKey) return this.refuse({ lines: ['kex_exchange_identification: read: Connection reset by peer'] });
    const method = req.method ?? 'password';
    if (method === 'none') return this.handshake(req, peer, this.hostKey);
    const challenge = req.challenge ?? '';
    const conn = this.pending.check(challenge, peer.ip, this.server.clock.now());
    if (!conn.ok) {
      if (conn.reason === 'expired') this.server.log('ssh', `Timeout before authentication for ${from}`);
      return this.refuse({ closed: true, lines: [`Connection closed by ${this.serverIp()} port 22`] });
    }
    const ok = this.allowed(req.user, peer, from, method) ? (method === 'publickey' ? this.publickey(req, peer, from) : this.password(req, from)) : null;
    if (ok) {
      this.pending.close(challenge);
      return this.open(req.user, peer, from, ok);
    }
    return this.failed(challenge, req.user, from);
  }

  /** AllowUsers/DenyUsers/AllowGroups/DenyGroups and PermitRootLogin. */
  private allowed(name: string, peer: Peer, from: string, method: 'password' | 'publickey'): boolean {
    // Every name goes through the rules, also accounts without a Linux user (names like "Bob" or "john.doe").
    const user = hostUsers(this.server).find((u) => u.name === name);
    const fs = hostFs(this.server);
    const subject = user ? { ...user, groupNames: fs ? groupNames(fs, user.groups) : [] } : { name, uid: -1, home: '', groupNames: [] };
    const reason = accessDenied(this.settings, subject, peer.ip);
    if (reason) {
      this.server.log('ssh', reason);
      return false;
    }
    // PermitRootLogin only matters when root is an SSH account (otherwise it is an invalid user).
    if (this.server.services.ssh.users.some((u) => u.name === name) && rootRefused(this.settings, name, method)) {
      this.server.log('ssh', `ROOT LOGIN REFUSED FROM ${from}`);
      return false;
    }
    return true;
  }

  /** A failed attempt; MaxAuthTries ends the connection. */
  private failed(challenge: string, user: string, from: string): SshOutput {
    if (this.pending.fail(challenge) < this.settings.maxAuthTries) return this.refuse();
    this.pending.close(challenge);
    const invalid = this.server.services.ssh.users.some((u) => u.name === user) ? '' : 'invalid user ';
    this.server.log('ssh', `error: maximum authentication attempts exceeded for ${invalid}${user} from ${from} ssh2 [preauth]`);
    return this.refuse({ closed: true, lines: [`Received disconnect from ${this.serverIp()} port 22:2: Too many authentication failures`, `Disconnected from ${this.serverIp()} port 22`] });
  }

  private password(req: SshAuth, from: string): string | null {
    const account = this.server.services.ssh.users.find((u) => u.name === req.user);
    const emptyOk = this.settings.permitEmptyPasswords || req.password !== '';
    if (this.settings.passwordAuth && account && account.password === req.password && emptyOk) return 'password';
    this.server.log('ssh', `Failed password for ${account ? '' : 'invalid user '}${req.user} from ${from} ssh2`);
    return null;
  }

  private publickey(req: SshAuth, peer: Peer, from: string): string | null {
    const fs = hostFs(this.server);
    const user = hostUsers(this.server).find((u) => u.name === req.user);
    const account = this.server.services.ssh.users.find((u) => u.name === req.user);
    if (!this.settings.pubkeyAuth || !fs || !user || !account) return null;
    const key = req.key ?? '';
    const r = checkPublicKey(fs, this.settings, user, peer.ip, key, req.signature ?? '', userAuthMessage(req.challenge ?? '', this.hostKey?.blob ?? new Uint8Array(), req.user, key));
    if (r.log && !r.ok) this.server.log('ssh', `${r.log} [${from}]`);
    return r.ok ? `publickey ${r.log.replace(/^publickey for \S+: /, '').replace(/ \(.*\)$/, '')}` : null;
  }

  private open(user: string, peer: Peer, from: string, how: string): SshOutput {
    this.expireIdle();
    if (this.sessions.size >= MAX_SESSIONS) return this.refuse({ lines: ['Too many sessions'] });
    const id = `s${++this.counter}-${toBase64(cryptoRandom(SESSION_ID_BYTES), false).replace(/[+/]/g, 'x')}`;
    const shell = createShell(this.server, this.server.os, user, true);
    this.sessions.set(id, { user, shell, ip: peer.ip, lastUsed: this.server.clock.now() });
    const [method, ...detail] = how.split(' ');
    this.server.log('ssh', `Accepted ${method} for ${user} from ${from} ssh2${detail.length ? `: ${detail.join(' ')}` : ''}`);
    this.server.log('ssh', `pam_unix(sshd:session): session opened for user ${user}`);
    return { app: 'SSH', kind: 'output', ok: true, session: id, prompt: shell.prompt(), lines: this.banner(user) };
  }

  private expireIdle(): void {
    const now = this.server.clock.now();
    for (const [id, s] of this.sessions) if (now - s.lastUsed > IDLE_LIMIT_MS) this.sessions.delete(id);
  }

  private command(req: Extract<AppPayload, { app: 'SSH'; kind: 'command' | 'key' | 'edit' | 'screen' }>, peer: Peer): SshOutput {
    const found = this.sessions.get(req.session);
    const s = found && found.ip === peer.ip ? found : undefined;
    if (!s) return { app: 'SSH', kind: 'output', ok: false, closed: true, lines: ['Connection closed by remote host.'] };
    s.lastUsed = this.server.clock.now();
    const sh = s.shell;
    if (req.kind === 'edit' && req.action === 'save') {
      return { app: 'SSH', kind: 'output', ok: true, lines: [], prompt: sh.prompt(), edit: sh.editRequest?.() ?? undefined, saveError: sh.saveEdit ? sh.saveEdit(req.path ?? '', req.content ?? '') : 'No editor' };
    }
    const size = req.kind === 'screen' ? { width: req.width, height: req.height } : DEFAULT_SCREEN;
    const lines = req.kind === 'command' ? sh.run(req.line)
      : req.kind === 'edit' ? sh.closeEdit?.() ?? []
        : req.kind === 'screen' ? (req.key ? sh.screenKey?.(req.key) ?? [] : [])
          : (req.key === 'int' ? sh.interrupt?.() : sh.eof?.()) ?? [];
    if (sh.closed) {
      this.sessions.delete(req.session);
      this.server.log('ssh', `pam_unix(sshd:session): session closed for user ${s.user}`);
      return { app: 'SSH', kind: 'output', ok: true, closed: true, lines, status: sh.exitCode ?? 0 };
    }
    const screen = sh.screenFrame?.(size.width, size.height) ?? undefined;
    return { app: 'SSH', kind: 'output', ok: true, lines, prompt: sh.prompt(), secret: sh.secret(), edit: sh.editRequest?.() ?? undefined, screen };
  }

  private banner(user: string): string[] {
    if (this.server.os === 'windows') return ['Microsoft Windows [Versión 10.0.20348.2700]', '(c) Microsoft Corporation. Todos los derechos reservados.', ''];
    return [
      'Welcome to Ubuntu 26.04 LTS (GNU/Linux 6.17.0-generic x86_64)',
      '',
      ` * Sesión SSH de ${user} en ${this.server.name} (simulada por Netfix)`,
      '',
    ];
  }
}

