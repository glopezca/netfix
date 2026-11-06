/**
 * /etc/samba/smb.conf: Ubuntu's default (shortened) and what smbd reads of it, its shares with their path, comment and
 * access (browseable, read only/writable, guest ok, valid users). An unknown parameter is ignored with a warning, as
 * testparm reports it; the Samba panel adds and removes share sections by editing the text. [global] may make nmbd a
 * WINS server (`wins support`) or point it at one (`wins server`), not both.
 */
import { parseIp } from '../core/ip.ts';

export const SMB_CONF = '/etc/samba/smb.conf';

export const DEFAULT_SMB_CONF = `#
# Sample configuration file for the Samba suite for Debian GNU/Linux.
#
# Any line which starts with a ; (semi-colon) or a # (hash)
# is a comment and is ignored. In this example we will use a #
# for commentary and a ; for parts of the config file that you
# may wish to enable
#
# NOTE: Whenever you modify this file you should run the command
# "testparm" to check that you have not made any basic syntactic
# errors.

#======================= Global Settings =======================

[global]

## Browsing/Identification ###

# Change this to the workgroup/NT-domain name your Samba server will part of
   workgroup = WORKGROUP

# server string is the equivalent of the NT Description field
   server string = %h server (Samba, Ubuntu)

#### Debugging/Accounting ####

# This tells Samba to use a separate log file for each machine
# that connects
   log file = /var/log/samba/log.%m

# Cap the size of the individual log files (in KiB).
   max log size = 1000

   logging = file

####### Authentication #######

   server role = standalone server

   obey pam restrictions = yes

# This option controls how unsuccessful authentication attempts are mapped
# to anonymous connections
   map to guest = bad user

############ Misc ############

# Allow users who've been granted usershare privileges to create
# public shares, not just authenticated ones
   usershare allow guests = yes

#======================= Share Definitions =======================

[printers]
   comment = All Printers
   browseable = no
   path = /var/tmp
   printable = yes
   guest ok = no
   read only = yes
   create mask = 0700

# Windows clients look for this share name as a source of downloadable
# printer drivers
[print$]
   comment = Printer Drivers
   path = /var/lib/samba/printers
   browseable = yes
   read only = yes
   guest ok = no
`;

export interface SmbShare {
  readonly name: string;
  readonly path: string;
  readonly comment: string;
  readonly browseable: boolean;
  readonly readOnly: boolean;
  readonly guestOk: boolean;
  /** Only these users may connect (undefined: any user smbd knows). */
  readonly validUsers?: readonly string[];
  readonly printable: boolean;
}

export interface SmbConf {
  readonly workgroup: string;
  readonly serverString: string;
  /** «map to guest = bad user»: an unknown user name connects as the guest account. */
  readonly mapToGuest: boolean;
  /** «wins support = yes»: nmbd is the WINS server. */
  readonly winsSupport: boolean;
  /** «wins server»: the WINS servers nmbd registers with and asks (IPs only; names are dropped). */
  readonly winsServers: readonly number[];
  readonly shares: readonly SmbShare[];
  /** Parameters smbd does not know, as testparm names them. */
  readonly unknown: readonly string[];
}

/** The parameters this Samba understands (anything else is ignored with a warning). */
const KNOWN = new Set([
  'workgroup', 'server string', 'netbios name', 'log file', 'max log size', 'logging', 'panic action', 'server role',
  'obey pam restrictions', 'unix password sync', 'passwd program', 'passwd chat', 'pam password change', 'map to guest',
  'usershare allow guests', 'interfaces', 'bind interfaces only', 'security', 'guest account', 'wins support', 'wins server',
  'comment', 'path', 'browseable', 'browsable', 'read only', 'writable', 'writeable', 'write ok', 'guest ok', 'public',
  'valid users', 'printable', 'create mask', 'create mode', 'directory mask', 'directory mode', 'force user', 'force group',
]);

export interface SmbSection {
  readonly name: string;
  /** Known parameters in the order of the file (lower case, single spaces). */
  readonly params: ReadonlyMap<string, string>;
}
type Section = SmbSection;

/** The sections as testparm dumps them, and the unknown parameters it warns about. */
export function smbSections(text: string): { readonly sections: readonly SmbSection[]; readonly unknown: readonly string[] } {
  const unknown: string[] = [];
  return { sections: sections(text, unknown), unknown };
}

function sections(text: string, unknown: string[]): Section[] {
  const out: { name: string; params: Map<string, string> }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) { out.push({ name: (head[1] ?? '').trim(), params: new Map() }); continue; }
    const eq = line.indexOf('=');
    const current = out[out.length - 1];
    if (eq < 0 || !current) continue;
    const key = line.slice(0, eq).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!KNOWN.has(key)) { unknown.push(key); continue; }
    current.params.set(key, line.slice(eq + 1).trim());
  }
  return out;
}

const yes = (v: string | undefined, fallback: boolean): boolean => (v === undefined ? fallback : /^(yes|true|1)$/i.test(v));

/** At most this many WINS servers are kept from the list (the file is not trusted). */
const MAX_WINS_SERVERS = 8;

/** Only this much of the «wins server» value is read (the file is not trusted). */
const MAX_WINS_TEXT = 1024;

/** «wins server = a, b c»: the IPs of the list, in order and without repeats. */
function winsList(value: string | undefined): number[] {
  const ips = (value ?? '').slice(0, MAX_WINS_TEXT).split(/[\s,]+/).map(parseIp).filter((ip): ip is number => ip !== null);
  return [...new Set(ips)].slice(0, MAX_WINS_SERVERS);
}

const globalParams = (all: readonly Section[]): ReadonlyMap<string, string> => all.find((s) => s.name.toLowerCase() === 'global')?.params ?? new Map<string, string>();

/** Both at once (any «wins server» text, a name too, as Samba checks it): testparm reports it and nmbd will not start. */
export function winsConflict(all: readonly SmbSection[]): boolean {
  const g = globalParams(all);
  return yes(g.get('wins support'), false) && (g.get('wins server') ?? '').trim() !== '';
}

function share(s: Section): SmbShare {
  const p = (k: string): string | undefined => s.params.get(k);
  const writable = p('writable') ?? p('writeable') ?? p('write ok');
  const users = p('valid users')?.split(/[\s,]+/).filter(Boolean);
  return {
    name: s.name,
    path: p('path') ?? '',
    comment: p('comment') ?? '',
    browseable: yes(p('browseable') ?? p('browsable'), true),
    readOnly: writable !== undefined ? !yes(writable, false) : yes(p('read only'), true),
    guestOk: yes(p('guest ok') ?? p('public'), false),
    ...(users?.length ? { validUsers: users } : {}),
    printable: yes(p('printable'), false),
  };
}

export function parseSmbConf(text: string): SmbConf {
  const unknown: string[] = [];
  const all = sections(text, unknown);
  const global = globalParams(all);
  return {
    workgroup: (global.get('workgroup') ?? 'WORKGROUP').toUpperCase(),
    serverString: global.get('server string') ?? 'Samba 4.22.3-Ubuntu',
    mapToGuest: /^bad user$/i.test(global.get('map to guest') ?? ''),
    winsSupport: yes(global.get('wins support'), false),
    winsServers: winsList(global.get('wins server')),
    shares: all.filter((s) => s.name.toLowerCase() !== 'global').map(share),
    unknown,
  };
}

/** The share by name, as Windows and smbclient look it up (case does not matter; printers are not disks). */
export function findShare(conf: SmbConf, name: string): SmbShare | undefined {
  return conf.shares.find((s) => s.name.toLowerCase() === name.toLowerCase() && !s.printable);
}

/** «%h server (Samba, Ubuntu)» with the host name in it. */
export function serverComment(conf: SmbConf, host: string): string {
  return conf.serverString.replace(/%h/g, host.toLowerCase()).replace(/%v/g, '4.22.3-Ubuntu');
}

export interface NewShare {
  readonly name: string;
  readonly path: string;
  readonly comment: string;
  readonly readOnly: boolean;
  readonly guestOk: boolean;
}

/** A valid share name: what Windows accepts in \\server\name (no brackets or slashes; not «global» or «homes»). */
export function validShareName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.$-]{0,79}$/.test(name) && !['global', 'homes', 'printers'].includes(name.toLowerCase());
}

/** The text with the share added at the end (as an administrator writes it). */
export function addShare(text: string, s: NewShare): string {
  const body = [`[${s.name}]`, `   comment = ${s.comment}`, `   path = ${s.path}`, '   browseable = yes', `   read only = ${s.readOnly ? 'yes' : 'no'}`, `   guest ok = ${s.guestOk ? 'yes' : 'no'}`];
  return `${text.replace(/\n*$/, '\n')}\n${body.join('\n')}\n`;
}

/** The text without that share's section (its header and parameters, up to the next section). */
export function removeShare(text: string, name: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    const head = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (head) skipping = (head[1] ?? '').trim().toLowerCase() === name.toLowerCase();
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
