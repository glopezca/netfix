/**
 * SMB2 condensed to one request per TCP connection (as the other Netfix applications are): every request carries the
 * session (user and NT hash, never the password: NTLM proves the hash) and the share it works on, and the server
 * answers with an NT status. Paths are relative to the share root, with Windows' backslashes.
 */

export type SmbStatus =
  | 'NT_STATUS_OK' | 'NT_STATUS_LOGON_FAILURE' | 'NT_STATUS_ACCOUNT_DISABLED' | 'NT_STATUS_ACCESS_DENIED'
  | 'NT_STATUS_BAD_NETWORK_NAME' | 'NT_STATUS_OBJECT_NAME_NOT_FOUND' | 'NT_STATUS_OBJECT_PATH_SYNTAX_BAD'
  | 'NT_STATUS_OBJECT_NAME_COLLISION' | 'NT_STATUS_FILE_IS_A_DIRECTORY' | 'NT_STATUS_NOT_A_DIRECTORY'
  | 'NT_STATUS_DIRECTORY_NOT_EMPTY' | 'NT_STATUS_DISK_FULL' | 'NT_STATUS_UNSUCCESSFUL';

export type SmbOp =
  /** NetShareEnum on IPC$ (smbclient -L, net view). */
  | { readonly op: 'shares' }
  /** Tree connect only: may this session use the share? (net use) */
  | { readonly op: 'tree' }
  | { readonly op: 'list'; readonly path: string }
  | { readonly op: 'stat'; readonly path: string }
  | { readonly op: 'read'; readonly path: string }
  | { readonly op: 'write'; readonly path: string; readonly data: string }
  | { readonly op: 'mkdir'; readonly path: string }
  | { readonly op: 'rmdir'; readonly path: string }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'rename'; readonly path: string; readonly to: string };

export interface SmbRequest {
  /** '' = anonymous (smbclient -N). */
  readonly user: string;
  /** The NT hash of the password ('' when anonymous). */
  readonly hash: string;
  readonly share: string;
  readonly req: SmbOp;
}

export interface SmbEntry {
  readonly name: string;
  readonly dir: boolean;
  readonly size: number;
  readonly mtime: number;
}

export interface SmbShareInfo {
  readonly name: string;
  readonly type: 'Disk' | 'IPC';
  readonly comment: string;
}

export interface SmbReply {
  readonly status: SmbStatus;
  /** shares: the browseable ones and IPC$, and the server's comment. */
  readonly shares?: readonly SmbShareInfo[];
  readonly comment?: string;
  readonly entries?: readonly SmbEntry[];
  readonly entry?: SmbEntry;
  readonly data?: string;
}
