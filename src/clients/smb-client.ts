/**
 * The SMB client side shared by smbclient (GNU/Linux) and net use / dir \\server\share (Windows): one request per TCP
 * connection to port 445, with the session's user and the NT hash of its password (NTLM never sends the password).
 */
import type { Host } from '../devices/host.ts';
import type { SmbOp, SmbReply, SmbStatus } from '../net/smb-types.ts';
import { tcpCall } from '../shells/net-tools.ts';
import { ntHash } from '../services/smb-passdb.ts';

export const SMB_PORT = 445;

/** What the client reports when there is no SMB answer at all. */
export type SmbClientStatus = SmbStatus | 'NT_STATUS_CONNECTION_REFUSED' | 'NT_STATUS_IO_TIMEOUT' | 'NT_STATUS_HOST_UNREACHABLE';

export interface SmbResult extends Omit<SmbReply, 'status'> {
  readonly status: SmbClientStatus;
}

/** Who the client is towards one server: '' = anonymous (smbclient -N; the guest). */
export interface SmbLogin {
  readonly user: string;
  readonly password: string;
}

export const ANONYMOUS: SmbLogin = { user: '', password: '' };

const transport = (kind: string): SmbClientStatus =>
  (kind === 'refused' ? 'NT_STATUS_CONNECTION_REFUSED' : kind === 'timeout' ? 'NT_STATUS_IO_TIMEOUT' : 'NT_STATUS_HOST_UNREACHABLE');

export function smbCall(host: Host, ip: number, login: SmbLogin, share: string, req: SmbOp): SmbResult {
  const smb = { user: login.user, hash: login.user ? ntHash(login.password) : '', share, req };
  const r = tcpCall(host, ip, SMB_PORT, { app: 'SMB', kind: 'smb-request', smb });
  if (r.kind !== 'ok') return { status: transport(r.kind) };
  return r.reply.app === 'SMB' && r.reply.kind === 'smb-reply' ? r.reply.smb : { status: 'NT_STATUS_UNSUCCESSFUL' };
}

/** A path as the server sees it, with Windows' backslashes and a leading one (\dir\file). */
export function smbPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return `\\${parts.join('\\')}`;
}
