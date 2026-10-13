/** Shell skeleton shared by Linux and Windows: prompt, password input and SSH client sessions (with remote editors). */
import type { Host } from '../devices/host.ts';
import { tcpCall, SSH_WAIT_MS } from './net-tools.ts';
import { SshLogin, parseSshArgs } from './ssh-client.ts';
import type { SshClientStore, LoginResult } from './ssh-client.ts';
import type { AppPayload } from '../net/packets.ts';
import type { EditSpec } from '../bash/types.ts';
import type { Frame, KeyInput } from '../editors/buffer.ts';

export interface Completion {
  readonly line: string;
  readonly candidates: readonly string[];
}

export interface ShellSession {
  prompt(): string;
  run(line: string): string[];
  /** True while the shell expects a password (input must be hidden). */
  secret(): boolean;
  readonly closed: boolean;
  /** Exit status once closed (the ssh client returns it). */
  readonly exitCode?: number;
  /** Ctrl+C */
  interrupt?(): string[];
  /** Ctrl+D */
  eof?(): string[];
  complete?(line: string): Completion | null;
  /** The file a program (nano/vim) wants to edit full screen, local or through SSH. */
  editRequest?(): EditSpec | null;
  /** Writes the editor buffer; returns an error message or null. */
  saveEdit?(path: string, content: string): string | null;
  /** The editor was closed: the program that opened it continues. */
  closeEdit?(): string[];
  /** Frame of the full-screen program running (mc), or null. */
  screenFrame?(width: number, height: number): Frame | null;
  /** A key for the full-screen program; returns the shell output when the program ends. */
  screenKey?(key: KeyInput): string[];
}

export const DEFAULT_SCREEN = { width: 80, height: 24 } as const;

export const SSH_PORT = 22;
/** Exit status of ssh when the connection fails. */
export const SSH_FAILED = 255;

type SshOutput = Extract<AppPayload, { app: 'SSH'; kind: 'output' }>;
type SshRequest = Extract<AppPayload, { app: 'SSH'; kind: 'command' | 'key' | 'edit' | 'screen' }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type State =
  | { kind: 'local' }
  | { kind: 'login'; login: SshLogin }
  | { kind: 'remote'; target: string; ip: number; port: number; session: string; prompt: string; secret: boolean; edit: EditSpec | null; screen: Frame | null; size: { width: number; height: number };
      /** `ssh host command`: no banner and no "Connection closed" line. */
      quiet: boolean };

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
  /** Called when an ssh session started by the local shell ends (status 0, or 255 when it failed). */
  protected sshEnded(_status: number): string[] {
    return [];
  }

  /** The user's ~/.ssh (known_hosts and keys). */
  protected abstract sshStore(cwd?: string): SshClientStore;

  prompt(): string {
    if (this.state.kind === 'login') return this.state.login.prompt();
    if (this.state.kind === 'remote') return this.state.prompt;
    return this.localPrompt();
  }

  secret(): boolean {
    return (this.state.kind === 'login' && this.state.login.secret()) || (this.state.kind === 'remote' && this.state.secret);
  }

  run(line: string): string[] {
    if (this.state.kind === 'login') return this.loginStep(this.state.login, this.state.login.input(line));
    if (this.state.kind === 'remote') return this.remoteRequest({ kind: 'command', line });
    return this.runLocalLine(line);
  }

  /** A line typed in the local shell (Windows: one command; Linux: bash). */
  protected runLocalLine(line: string): string[] {
    const args = line.trim().split(/\s+/).filter(Boolean);
    const cmd = args.shift();
    if (!cmd) return [];
    if (cmd.toLowerCase() === 'ssh') return this.startSsh(args);
    return this.runLocal(cmd, args, line.trim());
  }

  protected sshActive(): boolean {
    return this.state.kind !== 'local';
  }

  interrupt(): string[] {
    if (this.state.kind === 'remote') return this.remoteRequest({ kind: 'key', key: 'int' });
    if (this.state.kind === 'login') return this.endSsh([], SSH_FAILED);
    return this.localInterrupt();
  }

  eof(): string[] {
    if (this.state.kind === 'remote') return this.remoteRequest({ kind: 'key', key: 'eof' });
    if (this.state.kind === 'login') return this.endSsh([], SSH_FAILED);
    return this.localEof();
  }

  protected localInterrupt(): string[] {
    return [];
  }

  protected localEof(): string[] {
    return [];
  }

  editRequest(): EditSpec | null {
    return this.state.kind === 'remote' ? this.state.edit : this.localEditRequest();
  }

  saveEdit(path: string, content: string): string | null {
    if (this.state.kind !== 'remote') return this.localSaveEdit(path, content);
    const st = this.state;
    const r = tcpCall(this.host, st.ip, st.port, { app: 'SSH', kind: 'edit', session: st.session, action: 'save', path, content });
    const out = r.kind === 'ok' && r.reply.app === 'SSH' && r.reply.kind === 'output' ? r.reply : undefined;
    return out ? out.saveError ?? null : 'Connection lost';
  }

  closeEdit(): string[] {
    if (this.state.kind === 'remote') return this.remoteRequest({ kind: 'edit', action: 'close' });
    return this.localCloseEdit();
  }

  screenFrame(width: number, height: number): Frame | null {
    if (this.state.kind !== 'remote') return this.localScreenFrame(width, height);
    const st = this.state;
    if (st.screen && (st.size.width !== width || st.size.height !== height)) {
      this.state = { ...st, size: { width, height } };
      this.remoteRequest({ kind: 'screen', width, height });
    }
    return this.state.kind === 'remote' ? this.state.screen : null;
  }

  screenKey(key: KeyInput): string[] {
    if (this.state.kind !== 'remote') return this.localScreenKey(key);
    return this.remoteRequest({ kind: 'screen', key, ...this.state.size });
  }

  protected localScreenFrame(_width: number, _height: number): Frame | null {
    return null;
  }

  protected localScreenKey(_key: KeyInput): string[] {
    return [];
  }

  protected localEditRequest(): EditSpec | null {
    return null;
  }

  protected localSaveEdit(_path: string, _content: string): string | null {
    return 'No hay ningún editor abierto';
  }

  protected localCloseEdit(): string[] {
    return [];
  }

  // ------------------------------------------------------------ ssh client

  protected startSsh(args: readonly string[], cwd?: string): string[] {
    const opts = parseSshArgs(args, this.user);
    if (typeof opts === 'string') return this.endSsh(opts.split('\n'), SSH_FAILED);
    const login = new SshLogin(this.host, this.osName, this.sshStore(cwd), opts);
    this.state = { kind: 'login', login };
    return this.loginStep(login, login.begin());
  }

  private endSsh(lines: string[], status: number): string[] {
    this.state = { kind: 'local' };
    return [...lines, ...this.sshEnded(status)];
  }

  /** Output of a login step; once authenticated, an interactive session or the remote command. */
  private loginStep(login: SshLogin, r: LoginResult): string[] {
    if (r.failed) return this.endSsh(r.lines, SSH_FAILED);
    if (!r.session) return r.lines;
    const { target, port, command } = login.opts;
    const quiet = command !== undefined;
    this.state = { kind: 'remote', target, ip: r.session.ip, port, session: r.session.id, prompt: r.session.prompt, secret: false, edit: null, screen: null, size: { ...DEFAULT_SCREEN }, quiet };
    if (!quiet) return [...r.lines, ...r.session.banner];
    const out = [...r.lines, ...this.remoteRequest({ kind: 'command', line: command })];
    if (this.state.kind !== 'remote') return out;
    // `ssh host command` runs no login shell: the remote "logout" is not shown.
    const end = this.remoteRequest({ kind: 'command', line: 'exit $?' });
    return [...out, ...(end[0] === 'logout' ? end.slice(1) : end)];
  }

  private remoteRequest(req: DistributiveOmit<SshRequest, 'app' | 'session'>): string[] {
    if (this.state.kind !== 'remote') return [];
    const st = this.state;
    const r = tcpCall(this.host, st.ip, st.port, { ...req, app: 'SSH', session: st.session } as SshRequest, SSH_WAIT_MS);
    const out: SshOutput | undefined = r.kind === 'ok' && r.reply.app === 'SSH' && r.reply.kind === 'output' ? r.reply : undefined;
    const closing = st.quiet && out ? [] : [`Connection to ${st.target} closed.`];
    if (!out || out.closed) return this.endSsh([...(out?.lines ?? []), ...closing], out ? out.status ?? 0 : SSH_FAILED);
    this.state = { ...st, prompt: out.prompt ?? st.prompt, secret: out.secret ?? false, edit: out.edit ?? null, screen: out.screen ?? null };
    return [...out.lines];
  }

  /** True while connected to a remote host (used by the UI to label the terminal). */
  remoteTarget(): string | undefined {
    return this.state.kind === 'remote' ? this.state.target : undefined;
  }
}
