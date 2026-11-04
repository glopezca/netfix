/**
 * The SMB client of a Windows terminal: `net view \\SERVER` (its visible disk shares), `net use` (drive letters mapped
 * to \\server\share, with a user and password or as the guest) and the paths the file commands reach through them:
 * Z:\dir\file on a mapped drive, or \\server\share\dir\file directly. The mappings belong to the device, as Windows
 * remembers them for the session of its user, so every terminal of the PC sees them.
 */
import type { Host } from '../devices/host.ts';
import { ANONYMOUS, smbCall, smbPath } from '../clients/smb-client.ts';
import type { SmbClientStatus, SmbLogin } from '../clients/smb-client.ts';
import { resolveHost } from './net-tools.ts';

/** A drive letter (or a connection without one, Local '') to a share. */
interface Mapping {
  readonly local: string;
  readonly server: string;
  readonly share: string;
  readonly ip: number;
  readonly login: SmbLogin;
}

/** Where a remote path leads: the server, share and session, and the path inside the share (\dir\file). */
export interface SmbTarget {
  readonly host: Host;
  readonly ip: number;
  readonly login: SmbLogin;
  readonly share: string;
  /** How cmd.exe names the share root: Z: or \\srv\share. */
  readonly root: string;
  readonly path: string;
}

/** net use asking for the password of /user:NAME (typed without echo). */
export interface PasswordQuestion {
  readonly prompt: string;
  readonly answer: (password: string) => string[];
}

const RULE = '-'.repeat(79);
const DONE = ['The command completed successfully.', ''];
const NETWORK = 'Microsoft Windows Network';
const NOT_FOUND_PATH = 'The network path was not found.';
const LETTERS = 'ZYXWVUTSRQPONMLKJIHGFED';

const mappings = new WeakMap<Host, Mapping[]>();
const mapped = (host: Host): Mapping[] => mappings.get(host) ?? [];

const systemError = (code: number, text: string): string[] => [`System error ${code} has occurred.`, '', text, ''];

/** net use's wording of what the server (or the network) answered. */
function connectError(status: SmbClientStatus): string[] {
  switch (status) {
    case 'NT_STATUS_LOGON_FAILURE': return systemError(1326, 'The user name or password is incorrect.');
    case 'NT_STATUS_ACCOUNT_DISABLED': return systemError(1331, "This user can't sign in because this account is currently disabled.");
    case 'NT_STATUS_ACCESS_DENIED': return systemError(5, 'Access is denied.');
    case 'NT_STATUS_BAD_NETWORK_NAME': return systemError(67, 'The network name cannot be found.');
    case 'NT_STATUS_CONNECTION_REFUSED': case 'NT_STATUS_IO_TIMEOUT': case 'NT_STATUS_HOST_UNREACHABLE': return systemError(53, NOT_FOUND_PATH);
    default: return systemError(59, 'An unexpected network error occurred.');
  }
}

/** \\server\share[\rest] → its parts (null when it is not a UNC path to a share). */
function parseUnc(text: string): { server: string; share: string; rest: string } | null {
  const m = /^\\\\([^\\/]+)[\\/]([^\\/]+)(.*)$/.exec(text);
  return m ? { server: m[1] ?? '', share: m[2] ?? '', rest: m[3] ?? '' } : null;
}

const sameShare = (m: Mapping, server: string, share: string): boolean => m.server.toLowerCase() === server.toLowerCase() && m.share.toLowerCase() === share.toLowerCase();

/** The session Windows reuses towards a server: the one of a connection to that share, then to that server. */
function loginFor(host: Host, server: string, share: string): SmbLogin {
  const all = mapped(host);
  return (all.find((m) => sameShare(m, server, share)) ?? all.find((m) => m.server.toLowerCase() === server.toLowerCase()))?.login ?? ANONYMOUS;
}

/**
 * The share behind a path of the file commands: a mapped drive (Z:\…) or a UNC path (\\srv\share\…). null for a
 * local path or a drive letter nothing is mapped to (the local commands say there is no such drive); a string is the
 * message of a server that cannot be found.
 */
export function smbTarget(host: Host, input: string): SmbTarget | string | null {
  const drive = /^([a-z]):(.*)$/i.exec(input);
  if (drive) {
    const local = `${(drive[1] ?? '').toUpperCase()}:`;
    const m = mapped(host).find((x) => x.local === local);
    return m ? { host, ip: m.ip, login: m.login, share: m.share, root: local, path: smbPath(drive[2] ?? '') } : null;
  }
  const unc = parseUnc(input);
  if (!unc) return input.startsWith('\\\\') ? NOT_FOUND_PATH : null;
  const r = resolveHost(host, unc.server, 'windows');
  if (r.kind !== 'ip') return NOT_FOUND_PATH;
  return { host, ip: r.ip, login: loginFor(host, unc.server, unc.share), share: unc.share, root: `\\\\${unc.server}\\${unc.share}`, path: smbPath(unc.rest) };
}

function listing(host: Host): string[] {
  const all = mapped(host);
  if (!all.length) return ['New connections will be remembered.', '', 'There are no entries in the list.', ''];
  const row = (m: Mapping): string => {
    const remote = `\\\\${m.server}\\${m.share}`;
    const head = `${'OK'.padEnd(13)}${m.local.padEnd(10)}`;
    return remote.length < 26 ? `${head}${remote.padEnd(26)}${NETWORK}` : `${head}${remote}\n${' '.repeat(49)}${NETWORK}`;
  };
  return ['New connections will be remembered.', '', '', `${'Status'.padEnd(13)}${'Local'.padEnd(10)}${'Remote'.padEnd(26)}Network`, '', RULE, ...all.map(row), ...DONE];
}

function remove(host: Host, local: string): string[] {
  const all = mapped(host);
  const key = local.toUpperCase();
  const gone = all.filter((m) => m.local === key || (!m.local && `\\\\${m.server}\\${m.share}`.toLowerCase() === local.toLowerCase()));
  if (!gone.length) return ['The network connection could not be found.', '', 'More help is available by typing NET HELPMSG 2250.', ''];
  mappings.set(host, all.filter((m) => !gone.includes(m)));
  return [`${local} was deleted successfully.`, ''];
}

/** Tree connect with that login; the drive is recorded when the server accepts it. */
function connect(host: Host, local: string, server: string, share: string, login: SmbLogin): string[] {
  const r = resolveHost(host, server, 'windows');
  if (r.kind !== 'ip') return systemError(53, NOT_FOUND_PATH);
  const tree = smbCall(host, r.ip, login, share, { op: 'tree' });
  if (tree.status !== 'NT_STATUS_OK') return connectError(tree.status);
  const kept = mapped(host).filter((m) => !(local ? m.local === local : !m.local && sameShare(m, server, share)));
  mappings.set(host, [...kept, { local, server, share, ip: r.ip, login }]);
  return DONE;
}

interface UseArgs {
  readonly words: readonly string[];
  readonly user: string | undefined;
  readonly remove: boolean;
}

function useArgs(args: readonly string[]): UseArgs {
  const user = args.find((a) => /^\/u(ser)?:/i.test(a))?.replace(/^\/u(ser)?:/i, '').replace(/^.*\\/, '');
  return { words: args.filter((a) => !a.startsWith('/')), user, remove: args.some((a) => /^\/d(elete)?$/i.test(a)) };
}

/** `net use [X: | *] [\\server\share [password | *]] [/user:name] [/delete]`. */
export function netUse(host: Host, args: readonly string[]): string[] | PasswordQuestion {
  const o = useArgs(args);
  const [first, second, third] = o.words;
  if (!first) return listing(host);
  if (o.remove) return remove(host, first);
  const letter = /^[a-z]:$/i.test(first) ? first.toUpperCase() : first === '*' ? '*' : '';
  const unc = parseUnc(letter ? second ?? '' : first);
  const password = letter ? third : second;
  if (!unc || unc.rest.replace(/\\$/, '')) return ['The syntax of this command is:', '', 'NET USE', '[devicename | *] [\\\\computername\\sharename[\\volume] [password | *]]', '        [/USER:[domainname\\]username]', '        [/DELETE]', ''];
  const used = mapped(host).map((m) => m.local);
  const local = letter === '*' ? [...LETTERS].map((l) => `${l}:`).find((l) => !used.includes(l)) ?? '' : letter;
  if (letter === '*' && !local) return systemError(85, 'The local device name is already in use.');
  if (local === 'C:' || (letter !== '*' && local && used.includes(local))) return systemError(85, 'The local device name is already in use.');
  const done = (login: SmbLogin): string[] => {
    const out = connect(host, local, unc.server, unc.share, login);
    return letter === '*' && out === DONE ? [`Drive ${local} is now connected to \\\\${unc.server}\\${unc.share}.`, '', ...DONE] : out;
  };
  if (o.user === undefined) return done(ANONYMOUS);
  const user = o.user;
  if (password === undefined || password === '*') return { prompt: `Enter the password for '${user}' to connect to '${unc.server}': `, answer: (p) => ['', ...done({ user, password: p })] };
  return done({ user, password });
}

/** `net view \\NAME`: the server's comment and its visible disk shares (hidden ones end in $), Used as a mapped drive. */
export function netView(host: Host, unc: string | undefined): string[] {
  const name = (unc ?? '').replace(/^\\\\/, '').replace(/\\.*$/, '');
  if (!name) return ['The syntax of this command is:', '', 'NET VIEW', '[\\\\computername [/CACHE] | [/ALL] | /DOMAIN[:domainname]]'];
  const r = resolveHost(host, name, 'windows');
  if (r.kind !== 'ip') return systemError(53, NOT_FOUND_PATH);
  const reply = smbCall(host, r.ip, loginFor(host, name, ''), 'IPC$', { op: 'shares' });
  if (reply.status !== 'NT_STATUS_OK') return connectError(reply.status);
  const disks = (reply.shares ?? []).filter((s) => s.type === 'Disk' && !s.name.endsWith('$')).sort((a, b) => a.name.localeCompare(b.name));
  if (!disks.length) return ['There are no entries in the list.', ''];
  const usedAs = (share: string): string => mapped(host).find((m) => m.local && sameShare(m, name, share))?.local ?? '';
  const rows = disks.map((s) => `${s.name.padEnd(12)}${'Disk'.padEnd(6)}${usedAs(s.name).padEnd(9)}${s.comment}`.trimEnd());
  return [`Shared resources at \\\\${name}`, '', reply.comment ?? '', '', 'Share name  Type  Used as  Comment', '', RULE, ...rows, ...DONE];
}
