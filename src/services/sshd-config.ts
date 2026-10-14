/**
 * /etc/ssh/sshd_config of a Ubuntu Server (OpenSSH 10): the file is real and editable; `systemctl
 * reload|restart ssh` reads it. Like sshd, the first value of a keyword wins (AllowUsers, DenyUsers,
 * AllowGroups and DenyGroups accumulate) and `Include` expands globs. Security directives that Netfix
 * does not implement (Match, ForceCommand, ChrootDirectory…) are rejected instead of silently ignored.
 */
import { matchPattern } from '../bash/glob.ts';

export const SSHD_CONFIG = '/etc/ssh/sshd_config';
export const SSHD_CONFIG_DIR = '/etc/ssh/sshd_config.d';

export type PermitRootLogin = 'yes' | 'no' | 'prohibit-password' | 'forced-commands-only';

export interface SshdSettings {
  readonly permitRootLogin: PermitRootLogin;
  readonly passwordAuth: boolean;
  readonly pubkeyAuth: boolean;
  readonly strictModes: boolean;
  readonly permitEmptyPasswords: boolean;
  /** Paths relative to the home directory unless absolute; %h and %u are expanded. */
  readonly authorizedKeysFiles: readonly string[];
  /** Patterns "user" or "user@host" (* and ? wildcards). */
  readonly allowUsers: readonly string[];
  readonly denyUsers: readonly string[];
  readonly allowGroups: readonly string[];
  readonly denyGroups: readonly string[];
  readonly maxAuthTries: number;
  /** `Subsystem sftp …` is configured (sftp and scp work). */
  readonly sftp: boolean;
}

export const DEFAULT_SSHD: SshdSettings = {
  permitRootLogin: 'prohibit-password', passwordAuth: true, pubkeyAuth: true, strictModes: true, permitEmptyPasswords: false,
  authorizedKeysFiles: ['.ssh/authorized_keys', '.ssh/authorized_keys2'], allowUsers: [], denyUsers: [], allowGroups: [], denyGroups: [], maxAuthTries: 6, sftp: true,
};

export const DEFAULT_SSHD_CONFIG = `
# This is the sshd server system-wide configuration file.  See
# sshd_config(5) for more information.

# The strategy used for options in the default sshd_config shipped with
# OpenSSH is to specify options with their default value where
# possible, but leave them commented.  Uncommented options override the
# default value.

Include /etc/ssh/sshd_config.d/*.conf

#Port 22
#ListenAddress 0.0.0.0

#PermitRootLogin prohibit-password
#StrictModes yes
#MaxAuthTries 6

#PubkeyAuthentication yes

# Expect .ssh/authorized_keys2 to be disregarded by default in future.
#AuthorizedKeysFile	.ssh/authorized_keys .ssh/authorized_keys2

# To disable tunneled clear text passwords, change to "no" here!
#PasswordAuthentication yes
#PermitEmptyPasswords no

KbdInteractiveAuthentication no
UsePAM yes

X11Forwarding yes
PrintMotd no

# Allow client to pass locale environment variables
AcceptEnv LANG LC_* COLORTERM NO_COLOR

# override default of no subsystems
Subsystem	sftp	/usr/lib/openssh/sftp-server
`.trimStart();

/** Keywords accepted without effect in the simulation: none of them can grant or restrict access. */
const ACCEPTED = new Set([
  'port', 'listenaddress', 'addressfamily', 'hostkey', 'logingracetime', 'maxsessions', 'kbdinteractiveauthentication',
  'challengeresponseauthentication', 'usepam', 'x11forwarding', 'printmotd', 'printlastlog', 'acceptenv', 'subsystem', 'usedns', 'banner',
  'clientaliveinterval', 'clientalivecountmax', 'tcpkeepalive', 'allowtcpforwarding', 'gatewayports', 'permittunnel', 'syslogfacility',
  'loglevel', 'hostbasedauthentication', 'ignorerhosts', 'kerberosauthentication', 'gssapiauthentication', 'pubkeyacceptedalgorithms',
  'compression', 'permituserenvironment', 'allowagentforwarding', 'x11uselocalhost', 'maxstartups', 'pidfile', 'debianbanner',
]);

/** Real sshd keywords that would change who may log in or what runs: refused, so a lab never trusts a no-op. */
const UNSUPPORTED = new Set(['match', 'forcecommand', 'chrootdirectory', 'authorizedprincipalsfile', 'authorizedkeyscommand', 'trustedusercakeys', 'revokedkeys', 'authenticationmethods']);
/** Keywords whose values add up over several lines. */
const CUMULATIVE = new Set(['allowusers', 'denyusers', 'allowgroups', 'denygroups']);
const ROOT_LOGIN = new Map<string, PermitRootLogin>([['yes', 'yes'], ['no', 'no'], ['prohibit-password', 'prohibit-password'], ['without-password', 'prohibit-password'], ['forced-commands-only', 'forced-commands-only']]);

const MAX_INCLUDE_DEPTH = 4;
/** Files read in one parse, all levels together (protects the browser tab from Include fan-out). */
const MAX_FILES_TOTAL = 64;
/** Patterns on one Include line. */
const MAX_INCLUDE_PATTERNS = 16;

export interface ConfigSource {
  read(path: string): string | null;
  list(dir: string): readonly string[];
}

type Values = Map<string, string[]>;

interface ParseState {
  readonly values: Values;
  readonly seen: Set<string>;
}

function yesNo(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const t = v.toLowerCase();
  return t === 'yes' ? true : t === 'no' ? false : null;
}

function include(src: ConfigSource, pattern: string): string[] {
  const path = pattern.startsWith('/') ? pattern : `/etc/ssh/${pattern}`;
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash) || '/';
  const base = path.slice(slash + 1);
  return src.list(dir).filter((n) => matchPattern(base, n)).sort().map((n) => `${dir}/${n}`);
}

/** Keyword and argument of a line without its trailing comment; null for blank and comment lines. */
function splitLine(raw: string): { word: string; arg: string } | null {
  const line = raw.replace(/\s+#.*$/, '').trim();
  if (!line || line.startsWith('#')) return null;
  const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
  return { word: m?.[1] ?? line, arg: (m?.[2] ?? '').trim() };
}

function checkValue(key: string, arg: string, where: string): string | null {
  if (BOOLEAN.has(key) && yesNo(arg) === null) return `${where}: unsupported option "${arg}".`;
  if (key === 'permitrootlogin' && !ROOT_LOGIN.has(arg.toLowerCase())) return `${where}: unsupported option "${arg}".`;
  return null;
}

/** Reads one file into the state; returns an error in sshd's words, or null. */
function readFile(src: ConfigSource, path: string, st: ParseState, depth: number): string | null {
  const text = src.read(path);
  if (text === null) return depth === 0 ? `${path}: No such file or directory` : null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const parsed = splitLine(lines[i] ?? '');
    if (!parsed) continue;
    const key = parsed.word.toLowerCase();
    const where = `${path} line ${i + 1}`;
    if (key === 'include') {
      const err = includeFiles(src, parsed.arg, st, depth, where);
      if (err) return err;
      continue;
    }
    if (UNSUPPORTED.has(key)) return `${where}: Unsupported option ${parsed.word} (no disponible en Netfix)`;
    if (!parsed.arg) return `${where}: Missing argument.`;
    if (!ACCEPTED.has(key) && !KNOWN.has(key)) return `${path}: line ${i + 1}: Bad configuration option: ${parsed.word}`;
    const bad = checkValue(key, parsed.arg, where);
    if (bad) return bad;
    const words = parsed.arg.split(/\s+/);
    if (CUMULATIVE.has(key)) st.values.set(key, [...(st.values.get(key) ?? []), ...words]);
    else if (!st.values.has(key)) st.values.set(key, words);
  }
  return null;
}

function includeFiles(src: ConfigSource, arg: string, st: ParseState, depth: number, where: string): string | null {
  const tooMany = `${where}: Too many recursive configuration includes`;
  const patterns = [...new Set(arg.split(/\s+/))];
  if (depth >= MAX_INCLUDE_DEPTH || patterns.length > MAX_INCLUDE_PATTERNS) return tooMany;
  for (const pattern of patterns) {
    for (const f of include(src, pattern)) {
      if (st.seen.has(f)) continue;
      if (st.seen.size >= MAX_FILES_TOTAL) return tooMany;
      st.seen.add(f);
      const r = readFile(src, f, st, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

const BOOLEAN = new Set(['passwordauthentication', 'pubkeyauthentication', 'strictmodes', 'permitemptypasswords']);
const KNOWN = new Set([...BOOLEAN, ...CUMULATIVE, 'authorizedkeysfile', 'maxauthtries', 'permitrootlogin']);

export function parseSshdConfig(src: ConfigSource): { ok: true; settings: SshdSettings } | { ok: false; error: string } {
  const values: Values = new Map();
  const r = readFile(src, SSHD_CONFIG, { values, seen: new Set([SSHD_CONFIG]) }, 0);
  if (r) return { ok: false, error: r };
  const bool = (k: string, d: boolean): boolean => yesNo(values.get(k)?.[0]) ?? d;
  const tries = Number(values.get('maxauthtries')?.[0] ?? DEFAULT_SSHD.maxAuthTries);
  if (!Number.isInteger(tries) || tries < 1) return { ok: false, error: `${SSHD_CONFIG}: invalid MaxAuthTries` };
  return {
    ok: true,
    settings: {
      permitRootLogin: ROOT_LOGIN.get((values.get('permitrootlogin')?.[0] ?? '').toLowerCase()) ?? DEFAULT_SSHD.permitRootLogin,
      passwordAuth: bool('passwordauthentication', DEFAULT_SSHD.passwordAuth),
      pubkeyAuth: bool('pubkeyauthentication', DEFAULT_SSHD.pubkeyAuth),
      strictModes: bool('strictmodes', DEFAULT_SSHD.strictModes),
      permitEmptyPasswords: bool('permitemptypasswords', DEFAULT_SSHD.permitEmptyPasswords),
      authorizedKeysFiles: (values.get('authorizedkeysfile') ?? DEFAULT_SSHD.authorizedKeysFiles).filter((f) => f.toLowerCase() !== 'none'),
      allowUsers: values.get('allowusers') ?? [],
      denyUsers: values.get('denyusers') ?? [],
      allowGroups: values.get('allowgroups') ?? [],
      denyGroups: values.get('denygroups') ?? [],
      maxAuthTries: tries,
      sftp: (values.get('subsystem')?.[0] ?? '').toLowerCase() === 'sftp',
    },
  };
}

/**
 * Sets `Keyword value` in the main file the way an administrator would: replaces the first active line,
 * or uncomments the default "#Keyword …" line, or appends it.
 */
export function setDirective(text: string, keyword: string, value: string): string {
  const lines = text.split('\n');
  const active = lines.findIndex((l) => new RegExp(`^\\s*${keyword}\\b`, 'i').test(l));
  const commented = lines.findIndex((l) => new RegExp(`^\\s*#\\s*${keyword}\\b`, 'i').test(l));
  const line = `${keyword} ${value}`;
  if (active >= 0) lines[active] = line;
  else if (commented >= 0) lines.splice(commented + 1, 0, line);
  else lines.push(line);
  return lines.join('\n');
}
