/** OpenSSH-like server: password authentication and remote shell sessions. */
import type { AppPayload } from '../net/packets.ts';
import type { Peer } from '../net/tcp.ts';
import type { Server } from '../devices/server.ts';
import type { ShellSession } from '../shells/base.ts';
import { createShell } from '../shells/factory.ts';
import { formatIp } from '../core/ip.ts';

type SshOutput = Extract<AppPayload, { app: 'SSH'; kind: 'output' }>;

const MAX_SESSIONS = 16;
const IDLE_LIMIT_MS = 30 * 60_000;

export class SshService {
  private readonly server: Server;
  private readonly sessions = new Map<string, { user: string; shell: ShellSession; ip: number; lastUsed: number }>();
  private counter = 0;

  constructor(server: Server) {
    this.server = server;
  }

  activeSessions(): { id: string; user: string }[] {
    return [...this.sessions.entries()].map(([id, s]) => ({ id, user: s.user }));
  }

  closeAll(): void {
    this.sessions.clear();
  }

  handle(req: AppPayload, peer: Peer): AppPayload | null {
    if (req.app !== 'SSH') return null;
    if (req.kind === 'auth') return this.auth(req, peer);
    if (req.kind === 'command') return this.command(req.session, req.line, peer);
    return null;
  }

  private auth(req: Extract<AppPayload, { app: 'SSH'; kind: 'auth' }>, peer: Peer): SshOutput {
    const from = `${formatIp(peer.ip)} port ${peer.port}`;
    if (req.user === '') return { app: 'SSH', kind: 'output', ok: false, lines: [] };
    const account = this.server.services.ssh.users.find((u) => u.name === req.user);
    if (!account || account.password !== req.password) {
      this.server.log('ssh', `Failed password for ${account ? '' : 'invalid user '}${req.user} from ${from} ssh2`);
      return { app: 'SSH', kind: 'output', ok: false, lines: [] };
    }
    this.expireIdle();
    if (this.sessions.size >= MAX_SESSIONS) return { app: 'SSH', kind: 'output', ok: false, lines: ['Too many sessions'] };
    const id = `s${++this.counter}-${peer.port}`;
    const shell = createShell(this.server, this.server.os, req.user, true);
    this.sessions.set(id, { user: req.user, shell, ip: peer.ip, lastUsed: this.server.clock.now() });
    this.server.log('ssh', `Accepted password for ${req.user} from ${from} ssh2`);
    this.server.log('ssh', `pam_unix(sshd:session): session opened for user ${req.user}`);
    return { app: 'SSH', kind: 'output', ok: true, session: id, prompt: shell.prompt(), lines: this.banner(req.user) };
  }

  private expireIdle(): void {
    const now = this.server.clock.now();
    for (const [id, s] of this.sessions) if (now - s.lastUsed > IDLE_LIMIT_MS) this.sessions.delete(id);
  }

  private command(id: string, line: string, peer: Peer): SshOutput {
    const found = this.sessions.get(id);
    const s = found && found.ip === peer.ip ? found : undefined;
    if (s) s.lastUsed = this.server.clock.now();
    if (!s) return { app: 'SSH', kind: 'output', ok: false, closed: true, lines: ['Connection closed by remote host.'] };
    const lines = s.shell.run(line);
    if (s.shell.closed) {
      this.sessions.delete(id);
      this.server.log('ssh', `pam_unix(sshd:session): session closed for user ${s.user}`);
      return { app: 'SSH', kind: 'output', ok: true, closed: true, lines };
    }
    return { app: 'SSH', kind: 'output', ok: true, lines, prompt: s.shell.prompt(), secret: s.shell.secret() };
  }

  private banner(user: string): string[] {
    if (this.server.os === 'windows') return ['Microsoft Windows [Versión 10.0.20348.2700]', '(c) Microsoft Corporation. Todos los derechos reservados.', ''];
    return [
      'Welcome to Ubuntu 26.04 LTS (GNU/Linux 6.17.0-generic x86_64)',
      '',
      ` * Sesión SSH de ${user} en ${this.server.name} (simulada por netsim)`,
      '',
    ];
  }
}
