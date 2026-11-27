/**
 * Engine of the PC's graphical file transfer app (FileZilla-like): quick connect over SFTP with the host
 * key and passphrase questions answered by the UI, a local and a remote pane, transfers and a message log.
 */
import type { Host } from '../devices/host.ts';
import type { SftpEntry, SftpResult } from '../net/packets.ts';
import type { Cred, Vfs } from '../bash/vfs.ts';
import { FsError } from '../bash/vfs.ts';
import type { UserInfo } from '../bash/types.ts';
import { SshLogin } from '../shells/ssh-client.ts';
import { runSteps, type Steps } from '../net/live-wait.ts';
import { linuxSshStore } from '../shells/ssh-stores.ts';
import { baseName, joinPath, SftpSession } from './sftp-client.ts';

export interface ConnectParams {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Private key path in ~/.ssh ('' = the default keys). */
  readonly identity?: string;
}

/** Questions the UI answers with its own dialogs. */
export interface Asker {
  hostKey(host: string, fingerprint: string): boolean;
  passphrase(path: string): string | null;
}

export interface LogLine {
  readonly kind: 'status' | 'command' | 'error';
  readonly text: string;
}

const MAX_LOG = 200;

export class FileTransfer {
  private readonly host: Host;
  private readonly fs: Vfs;
  private readonly acct: UserInfo;
  private readonly cred: Cred;
  session: SftpSession | null = null;
  target = '';
  localDir: string;
  log: LogLine[] = [];

  constructor(host: Host, fs: Vfs, acct: UserInfo) {
    this.host = host;
    this.fs = fs;
    this.acct = acct;
    this.cred = { uid: acct.uid, gid: acct.gid, groups: acct.groups };
    this.localDir = acct.home;
  }

  private add(kind: LogLine['kind'], text: string): void {
    this.log = [...this.log.slice(-(MAX_LOG - 1)), { kind, text }];
  }

  private *loginLoop(login: SshLogin, p: ConnectParams, ask: Asker): Steps<SftpSession | null> {
    let r = yield* login.beginSteps();
    let passwordSent = false;
    for (;;) {
      r.lines.filter((l) => l.trim()).forEach((l) => this.add(/denied|failed|closed|refused|timed out|Could not|incorrect|verification/i.test(l) ? 'error' : 'status', l));
      if (r.failed) return null;
      if (r.session) return new SftpSession(this.host, r.session.ip, p.port, r.session.id);
      const waiting = login.waiting();
      if (waiting === 'hostkey') r = yield* login.inputSteps(ask.hostKey(p.host, login.hostFingerprint()) ? 'yes' : 'no');
      else if (waiting === 'passphrase') r = yield* login.inputSteps(ask.passphrase(login.prompt()) ?? '');
      else if (waiting === 'password' && !passwordSent) { passwordSent = true; r = yield* login.inputSteps(p.password); }
      else { this.add('error', 'Error: Authentication failed.'); return null; }
    }
  }

  connect(p: ConnectParams, ask: Asker): boolean {
    return runSteps(this.host.hooks, this.connectSteps(p, ask));
  }

  /** As steps (0.94.0): the SFTP app waits live for a server outside the page (live-wait.ts drive). */
  *connectSteps(p: ConnectParams, ask: Asker): Steps<boolean> {
    this.disconnect();
    this.add('status', `Status: Connecting to ${p.host}:${p.port}...`);
    const store = linuxSshStore(this.fs, this.acct);
    const login = new SshLogin(this.host, 'Linux', store, {
      user: p.user || this.acct.name, target: p.host, port: p.port, identities: p.identity ? [p.identity] : [],
      strict: 'ask', password: true, pubkey: true, batch: false, subsystem: 'sftp',
    });
    const s = yield* this.loginLoop(login, p, ask);
    if (!s) {
      this.add('error', 'Error: Could not connect to server');
      return false;
    }
    yield* s.startSteps();
    this.session = s;
    this.target = `${p.user || this.acct.name}@${p.host}`;
    this.add('status', `Status: Connected to ${p.host}`);
    this.add('status', `Status: Directory listing of "${s.cwd}" successful`);
    return true;
  }

  disconnect(): void {
    if (this.session) this.add('status', 'Status: Disconnected from server');
    this.session = null;
  }

  // ------------------------------------------------------------ panes

  localList(): SftpEntry[] {
    try {
      return this.fs.readdir(this.localDir, this.cred).flatMap((name) => {
        try {
          const st = this.fs.stat(joinPath(this.localDir, name), this.cred, false);
          const kind = st.kind === 'file' || st.kind === 'dir' || st.kind === 'link' ? st.kind : 'other';
          return [{ name, kind, size: st.size, mode: st.mode, mtime: st.mtime, owner: String(st.uid), group: String(st.gid) }];
        } catch { return []; }
      });
    } catch {
      this.add('error', `Error: Directory ${this.localDir}: permission denied`);
      return [];
    }
  }

  remoteList(): readonly SftpEntry[] {
    return runSteps(this.host.hooks, this.remoteListSteps());
  }

  *remoteListSteps(): Steps<readonly SftpEntry[]> {
    if (!this.session) return [];
    const r = yield* this.session.requestSteps({ op: 'list', path: this.session.cwd });
    if (r.status !== 'ok') this.fail(`Directory ${this.session.cwd}`, r);
    return r.entries ?? [];
  }

  localCd(name: string): void {
    const dir = joinPath(this.localDir, name);
    if (this.fs.tryLookup(dir, this.cred)?.kind === 'dir') this.localDir = dir;
  }

  remoteCd(name: string): void {
    runSteps(this.host.hooks, this.remoteCdSteps(name));
  }

  *remoteCdSteps(name: string): Steps<void> {
    if (!this.session) return;
    const r = yield* this.session.cdSteps(name);
    if (r.status !== 'ok') this.fail(`cd ${name}`, r);
    else this.add('status', `Status: Directory listing of "${this.session.cwd}" successful`);
  }

  private fail(what: string, r: SftpResult): void {
    this.add('error', `Error: ${what}: ${r.status === 'permission-denied' ? 'permission denied' : r.status === 'no-such-file' ? 'no such file or directory' : r.message ?? 'failure'}`);
  }

  upload(name: string): boolean {
    return runSteps(this.host.hooks, this.uploadSteps(name));
  }

  *uploadSteps(name: string): Steps<boolean> {
    if (!this.session) return false;
    const src = joinPath(this.localDir, name);
    let data: string;
    try {
      data = this.fs.readFile(src, this.cred);
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      this.add('error', `Error: ${src}: ${e.code === 'EACCES' ? 'permission denied' : 'cannot read'}`);
      return false;
    }
    const dst = joinPath(this.session.cwd, baseName(src));
    this.add('command', `Command: put "${src}" "${dst}"`);
    const r = (yield* this.session.requestSteps({ op: 'write', path: dst, data }));
    if (r.status !== 'ok') { this.fail(`put ${dst}`, r); return false; }
    this.add('status', `Status: File transfer successful, transferred ${data.length} bytes`);
    return true;
  }

  download(name: string): boolean {
    return runSteps(this.host.hooks, this.downloadSteps(name));
  }

  *downloadSteps(name: string): Steps<boolean> {
    if (!this.session) return false;
    const src = joinPath(this.session.cwd, name);
    this.add('command', `Command: get "${src}" "${joinPath(this.localDir, name)}"`);
    const r = (yield* this.session.requestSteps({ op: 'read', path: src }));
    if (r.status !== 'ok') { this.fail(`get ${src}`, r); return false; }
    try {
      this.fs.writeFile(joinPath(this.localDir, name), r.data ?? '', this.cred);
    } catch {
      this.add('error', `Error: ${joinPath(this.localDir, name)}: permission denied`);
      return false;
    }
    this.add('status', `Status: File transfer successful, transferred ${(r.data ?? '').length} bytes`);
    return true;
  }

  /** mkdir / delete / rename on the remote side. */
  remote(op: 'mkdir' | 'delete' | 'rename', name: string, to?: string): boolean {
    return runSteps(this.host.hooks, this.remoteSteps(op, name, to));
  }

  *remoteSteps(op: 'mkdir' | 'delete' | 'rename', name: string, to?: string): Steps<boolean> {
    if (!this.session) return false;
    const path = joinPath(this.session.cwd, name);
    const entry = (yield* this.session.requestSteps({ op: 'stat', path })).entry;
    const r = op === 'mkdir' ? (yield* this.session.requestSteps({ op: 'mkdir', path }))
      : op === 'rename' ? (yield* this.session.requestSteps({ op: 'rename', path, to: joinPath(this.session.cwd, to ?? name) }))
        : (yield* this.session.requestSteps({ op: entry?.kind === 'dir' ? 'rmdir' : 'remove', path }));
    this.add('command', `Command: ${op === 'delete' ? (entry?.kind === 'dir' ? 'rmdir' : 'rm') : op} "${path}"${to ? ` "${to}"` : ''}`);
    if (r.status !== 'ok') { this.fail(`${op} ${path}`, r); return false; }
    return true;
  }
}
