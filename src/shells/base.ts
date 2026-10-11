/** Shell skeleton shared by Linux and Windows: prompt, password input and SSH client sessions. */
import type { Host } from '../devices/host.ts';
import { resolveHost, tcpCall, SSH_WAIT_MS } from './net-tools.ts';
import type { AppPayload } from '../net/packets.ts';

export interface ShellSession {
  prompt(): string;
  run(line: string): string[];
  /** True while the shell expects a password (input must be hidden). */
  secret(): boolean;
  readonly closed: boolean;
}

export const SSH_PORT = 22;
const MAX_SSH_ATTEMPTS = 3;

type SshOutput = Extract<AppPayload, { app: 'SSH'; kind: 'output' }>;

type State =
  | { kind: 'local' }
  | { kind: 'password'; user: string; target: string; ip: number; attempts: number }
  | { kind: 'remote'; target: string; ip: number; session: string; prompt: string; secret: boolean };

export abstract class BaseShell implements ShellSession {
  readonly host: Host;
  readonly user: string;
  closed = false;
  private state: State = { kind: 'local' };

  constructor(host: Host, user: string) {
    this.host = host;
    this.user = user;
  }

  protected abstract localPrompt(): string;
  protected abstract runLocal(cmd: string, args: string[], line: string): string[];
  protected abstract notFound(cmd: string): string[];
  /** Client OS name sent in the SSH handshake (shown by the server's logs). */
  protected abstract readonly osName: string;

  prompt(): string {
    if (this.state.kind === 'password') return `${this.state.user}@${this.state.target}'s password: `;
    if (this.state.kind === 'remote') return this.state.prompt;
    return this.localPrompt();
  }

  secret(): boolean {
    return this.state.kind === 'password' || (this.state.kind === 'remote' && this.state.secret);
  }

  run(line: string): string[] {
    if (this.state.kind === 'password') return this.sendPassword(line);
    if (this.state.kind === 'remote') return this.remoteCommand(line);
    const args = line.trim().split(/\s+/).filter(Boolean);
    const cmd = args.shift();
    if (!cmd) return [];
    if (cmd.toLowerCase() === 'ssh') return this.startSsh(args);
    return this.runLocal(cmd, args, line.trim());
  }

  // ------------------------------------------------------------ ssh client

  private startSsh(args: string[]): string[] {
    const lIdx = args.indexOf('-l');
    const spec = args.find((a, i) => !a.startsWith('-') && !(lIdx >= 0 && i === lIdx + 1));
    if (!spec) return ['usage: ssh [-l login_name] [user@]hostname'];
    const at = spec.lastIndexOf('@');
    const user = at >= 0 ? spec.slice(0, at) : (lIdx >= 0 ? args[lIdx + 1] : undefined) ?? this.user;
    const target = at >= 0 ? spec.slice(at + 1) : spec;
    const resolved = resolveHost(this.host, target);
    if (resolved.kind === 'error') return [`ssh: Could not resolve hostname ${target}: Name or service not known`];
    const probe = tcpCall(this.host, resolved.ip, SSH_PORT, { app: 'SSH', kind: 'auth', user: '', password: '', clientOs: this.osName });
    if (probe.kind === 'refused') return [`ssh: connect to host ${target} port 22: Connection refused`];
    if (probe.kind !== 'ok') return [`ssh: connect to host ${target} port 22: ${probe.kind === 'noroute' ? 'Network is unreachable' : 'Connection timed out'}`];
    this.state = { kind: 'password', user, target, ip: resolved.ip, attempts: 0 };
    return [];
  }

  private sendPassword(password: string): string[] {
    if (this.state.kind !== 'password') return [];
    const st = this.state;
    const r = tcpCall(this.host, st.ip, SSH_PORT, { app: 'SSH', kind: 'auth', user: st.user, password, clientOs: this.osName });
    const out = r.kind === 'ok' && r.reply.app === 'SSH' && r.reply.kind === 'output' ? r.reply : undefined;
    if (!out) {
      this.state = { kind: 'local' };
      return [`Connection to ${st.target} closed by remote host.`];
    }
    if (!out.ok || !out.session) {
      const attempts = st.attempts + 1;
      if (attempts >= MAX_SSH_ATTEMPTS) {
        this.state = { kind: 'local' };
        return [`${st.user}@${st.target}: Permission denied (publickey,password).`];
      }
      this.state = { ...st, attempts };
      return ['Permission denied, please try again.'];
    }
    this.state = { kind: 'remote', target: st.target, ip: st.ip, session: out.session, prompt: out.prompt ?? '$ ', secret: false };
    return [...out.lines];
  }

  private remoteCommand(line: string): string[] {
    if (this.state.kind !== 'remote') return [];
    const st = this.state;
    const r = tcpCall(this.host, st.ip, SSH_PORT, { app: 'SSH', kind: 'command', session: st.session, line }, SSH_WAIT_MS);
    const out: SshOutput | undefined = r.kind === 'ok' && r.reply.app === 'SSH' && r.reply.kind === 'output' ? r.reply : undefined;
    if (!out || out.closed) {
      this.state = { kind: 'local' };
      return [...(out?.lines ?? []), `Connection to ${st.target} closed.`];
    }
    this.state = { ...st, prompt: out.prompt ?? st.prompt, secret: out.secret ?? false };
    return [...out.lines];
  }

  /** True while connected to a remote host (used by the UI to label the terminal). */
  remoteTarget(): string | undefined {
    return this.state.kind === 'remote' ? this.state.target : undefined;
  }
}
