/**
 * Client side of an sftp session (used by sftp, scp and the PC's file transfer app): requests over the
 * authenticated SSH connection, the remote working directory and OpenSSH's path rules.
 */
import type { Host } from '../devices/host.ts';
import type { SftpOp, SftpResult } from '../net/packets.ts';
import { tcpCall, SSH_WAIT_MS } from '../shells/net-tools.ts';

const CLOSED: SftpResult = { status: 'failure', message: 'Connection closed' };

export function joinPath(dir: string, path: string): string {
  if (path.startsWith('/')) return normalizePath(path);
  return normalizePath(`${dir}/${path}`);
}

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

export const baseName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || '/';

export class SftpSession {
  private readonly host: Host;
  readonly ip: number;
  readonly port: number;
  private readonly id: string;
  /** Remote working directory (absolute). */
  cwd = '/';
  closed = false;

  constructor(host: Host, ip: number, port: number, id: string) {
    this.host = host;
    this.ip = ip;
    this.port = port;
    this.id = id;
  }

  /** Asks the server for the login directory (realpath "."), like OpenSSH right after connecting. */
  start(): SftpResult {
    const r = this.request({ op: 'realpath', path: '.' });
    if (r.status === 'ok' && r.path) this.cwd = r.path;
    return r;
  }

  abs(path: string): string {
    return joinPath(this.cwd, path || '.');
  }

  request(req: SftpOp): SftpResult {
    if (this.closed) return CLOSED;
    const r = tcpCall(this.host, this.ip, this.port, { app: 'SSH', kind: 'sftp', session: this.id, req }, SSH_WAIT_MS);
    const out = r.kind === 'ok' && r.reply.app === 'SSH' && r.reply.kind === 'output' ? r.reply : undefined;
    if (!out?.sftp) {
      this.closed = true;
      return CLOSED;
    }
    return out.sftp;
  }

  /** cd: the target must exist and be a directory. */
  cd(path: string): SftpResult {
    const target = this.abs(path);
    const r = this.request({ op: 'stat', path: target });
    if (r.status !== 'ok') return r;
    if (r.entry?.kind !== 'dir') return { status: 'failure', message: `"${target}" is not a directory` };
    this.cwd = target;
    return { status: 'ok', path: target };
  }
}
