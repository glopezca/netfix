/** Ubuntu terminal: a GNU bash 5.3 session on the host's system, plus the ssh client of BaseShell. */
import { BaseShell } from './base.ts';
import type { Completion } from './base.ts';
import { splitArgs } from './net-tools.ts';
import { hostSystem } from './host-system.ts';
import { BashSession } from '../bash/shell.ts';
import type { EditSpec, UserInfo } from '../bash/types.ts';
import type { Frame, KeyInput } from '../editors/buffer.ts';
import type { Host } from '../devices/host.ts';

const FALLBACK_UID = 1999;

/** Splits terminal text into lines (a final line without newline is kept). */
export function textLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export class LinuxShell extends BaseShell {
  protected readonly osName = 'Linux';
  private readonly remoteSession: boolean;
  private session: BashSession;
  exitCode = 0;

  constructor(host: Host, user: string, remote = false) {
    super(host, user);
    this.remoteSession = remote;
    this.session = this.newSession();
  }

  private account(): UserInfo {
    const found = hostSystem(this.host).env.users().find((u) => u.name === this.user);
    return found ?? { name: this.user, uid: FALLBACK_UID, gid: FALLBACK_UID, home: '/', shell: '/bin/bash', groups: [FALLBACK_UID] };
  }

  private newSession(): BashSession {
    return new BashSession(hostSystem(this.host).env, this.account(), { login: this.remoteSession });
  }

  /** The interpreter (tests and the documentation tab use it). */
  bash(): BashSession {
    return this.session;
  }

  protected localPrompt(): string {
    return this.session.prompt();
  }

  override secret(): boolean {
    return this.sshActive() ? super.secret() : this.session.secret();
  }

  protected notFound(cmd: string): string[] {
    return [`${cmd}: command not found`];
  }

  protected runLocal(_cmd: string, _args: string[], line: string): string[] {
    return this.runLocalLine(line);
  }

  protected override runLocalLine(line: string): string[] {
    hostSystem(this.host);
    return this.after(this.session.input(line));
  }

  /** Output of the session, then whatever it paused on (an ssh connection) or its end. */
  private after(text: string): string[] {
    const out = textLines(text);
    const pending = this.session.pending();
    if (pending?.kind === 'ssh') out.push(...this.startSsh(pending.args));
    if (this.session.closed) {
      this.exitCode = this.session.exitCode;
      if (this.remoteSession) this.closed = true;
      else this.session = this.newSession();
    }
    return out;
  }

  protected override sshEnded(status: number): string[] {
    return this.after(this.session.resume(String(status)));
  }

  protected override localInterrupt(): string[] {
    return this.after(this.session.interrupt());
  }

  protected override localEof(): string[] {
    return this.after(this.session.eof());
  }

  complete(line: string): Completion | null {
    return this.sshActive() ? null : this.session.complete(line);
  }

  protected override localEditRequest(): EditSpec | null {
    return this.session.editRequest();
  }

  protected override localSaveEdit(path: string, content: string): string | null {
    const p = this.session.pending();
    return p?.kind === 'edit' ? p.save(path, content) : 'No hay ningún editor abierto';
  }

  protected override localScreenFrame(width: number, height: number): Frame | null {
    return this.session.screen()?.frame(width, height) ?? null;
  }

  protected override localScreenKey(key: KeyInput): string[] {
    const app = this.session.screen();
    if (!app) return [];
    app.key(key);
    return app.closed ? this.after(this.session.resume('0')) : [];
  }

  protected override localCloseEdit(): string[] {
    return this.session.pending()?.kind === 'edit' ? this.after(this.session.resume('0')) : [];
  }
}

export { splitArgs };
