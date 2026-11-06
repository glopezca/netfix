/**
 * net share of a Windows terminal: the shares of the device (net/win-shares.ts, the same as its Servicios → SMB panel),
 * listed with IPC$, published as NAME=C:\folder with what Everyone may do (/GRANT:Everyone,READ|FULL; READ when not
 * said) and a /REMARK, shown one by one, and deleted by name or by folder. With File and Printer Sharing off, the
 * Server service is not there to ask. CHANGE, /USERS and /CACHE are not modelled: only read or full control.
 */
import type { Host } from '../devices/host.ts';
import { findWinShare, winShareActive, winShares } from '../net/win-shares.ts';
import type { ShareAccess, WinShare } from '../net/win-shares.ts';
import { publishWinShare, unpublishWinShare } from '../services/smb-windows.ts';
import type { PublishError } from '../services/smb-windows.ts';

const RULE = '-'.repeat(79);
const DONE = 'The command completed successfully.';
const NAME_COL = 13;
const REMARK_COL = 45;

const SYNTAX = [
  'The syntax of this command is:', '', 'NET SHARE', 'sharename',
  '          sharename=drive:path [/GRANT:user,[READ | CHANGE | FULL]]',
  '                               [/USERS:number | /UNLIMITED]',
  '                               [/REMARK:"text"]',
  '                               [/CACHE:Manual | Documents| Programs | BranchCache | None]',
  '          sharename [/USERS:number | /UNLIMITED]',
  '                    [/REMARK:"text"]',
  '                    [/CACHE:Manual | Documents | Programs | BranchCache | None]',
  '          {sharename | devicename | drive:path} /DELETE',
  '          sharename \\\\computername /DELETE', '',
];

/** A net.exe error (NERR_*), or a Win32 error told as a system error. */
const helpMsg = (text: string, code: number): string[] => [text, '', `More help is available by typing NET HELPMSG ${code}.`, ''];
const systemError = (code: number, text: string): string[] => [`System error ${code} has occurred.`, '', text, ''];
const NOT_SHARED = helpMsg('This shared resource does not exist.', 2310);

function publishError(err: PublishError): string[] {
  switch (err) {
    case 'exists': case 'reserved': return helpMsg('The name has already been shared.', 2118);
    case 'folder': return helpMsg('The device or directory does not exist.', 2116);
    case 'name': case 'path': return systemError(123, 'The filename, directory name, or volume label syntax is incorrect.');
    default: return systemError(87, 'The parameter is incorrect.');
  }
}

/** One share of the list: a name of 13 or more goes on a line of its own, and so does the remark after a long path. */
function row(name: string, resource: string, remark: string): string[] {
  const lines = name.length >= NAME_COL ? [name] : [];
  const start = `${name.length >= NAME_COL ? '' : name}`.padEnd(NAME_COL) + resource;
  if (remark && start.length >= REMARK_COL) return [...lines, start, `${''.padEnd(REMARK_COL)}${remark}`];
  return [...lines, `${start.padEnd(REMARK_COL)}${remark}`.trimEnd()];
}

function list(host: Host): string[] {
  const rows = winShares(host).flatMap((s) => row(s.name, s.path, s.remark));
  return ['', `${'Share name'.padEnd(NAME_COL)}${'Resource'.padEnd(REMARK_COL - NAME_COL)}Remark`, '', RULE, ...row('IPC$', '', 'Remote IPC'), ...rows, DONE, ''];
}

function details(host: Host, name: string): string[] {
  const field = (label: string, value: string): string => `${label.padEnd(18)}${value}`.trimEnd();
  if (name.toUpperCase() === 'IPC$') {
    return [field('Share name', 'IPC$'), field('Path', ''), field('Remark', 'Remote IPC'), field('Maximum users', 'No limit'), 'Users', '', DONE, ''];
  }
  const s = findWinShare(host, name);
  if (!s) return NOT_SHARED;
  return [
    field('Share name', s.name), field('Path', s.path), field('Remark', s.remark), field('Maximum users', 'No limit'), 'Users',
    field('Caching', 'Manual caching of documents'), field('Permission', `Everyone, ${s.access === 'full' ? 'FULL' : 'READ'}`), '', DONE, '',
  ];
}

/** /DELETE of a share by name, or of every share of a folder (C:\folder). */
function remove(host: Host, target: string): string[] {
  const folder = /^[a-z]:\\/i.test(target) ? target.replace(/\\+$/, '').toLowerCase() : undefined;
  const names = folder === undefined
    ? [target]
    : winShares(host).filter((s) => s.path.toLowerCase() === folder).map((s) => s.name);
  const removed = names.filter((n) => unpublishWinShare(host, n));
  return removed.length ? [`${target} was deleted successfully.`, ''] : NOT_SHARED;
}

interface Options {
  readonly access: ShareAccess;
  readonly remark: string;
  readonly user: string;
}

/** The options after NAME=PATH; null for a syntax error. */
function options(args: readonly string[]): Options | null {
  let o: Options = { access: 'read', remark: '', user: 'everyone' };
  for (const a of args) {
    const m = /^\/(grant|remark|users|unlimited|cache)(?::(.*))?$/is.exec(a);
    const key = (m?.[1] ?? '').toLowerCase();
    const value = m?.[2] ?? '';
    if (!m) return null;
    if (key === 'remark') o = { ...o, remark: value };
    else if (key === 'grant') {
      const g = /^([^,]+),(read|full)$/i.exec(value);
      if (!g) return null;
      o = { ...o, user: (g[1] ?? '').toLowerCase(), access: (g[2] ?? '').toLowerCase() === 'full' ? 'full' : 'read' };
    } else if (key === 'users' && !/^\d+$/.test(value)) return null;
  }
  return o;
}

function share(host: Host, spec: string, rest: readonly string[]): string[] {
  const eq = spec.indexOf('=');
  const o = options(rest);
  if (!o) return SYNTAX;
  if (o.user !== 'everyone') return systemError(1332, 'No mapping between account names and security IDs was done.');
  const s: WinShare = { name: spec.slice(0, eq), path: spec.slice(eq + 1), remark: o.remark, access: o.access };
  const err = publishWinShare(host, s);
  return err ? publishError(err) : [`${s.name} was shared successfully.`, ''];
}

const DELETE = /^\/d(?:e(?:l(?:e(?:t(?:e)?)?)?)?)?$/i;

/** `net share …` (the words after share). */
export function netShare(host: Host, args: readonly string[]): string[] {
  if (!winShareActive(host)) return helpMsg('The Server service is not started.', 2114);
  const [first, ...rest] = args;
  if (first === undefined) return list(host);
  if (first.startsWith('/')) return SYNTAX;
  if (rest.some((a) => DELETE.test(a))) return rest.length === 1 ? remove(host, first) : SYNTAX;
  if (first.includes('=')) return share(host, first, rest);
  return rest.length ? SYNTAX : details(host, first);
}
