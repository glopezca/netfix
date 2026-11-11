/**
 * /etc/dovecot/dovecot.conf as Dovecot 2.4 (Ubuntu's dovecot-core 2.4.1) reads it: `dovecot_config_version` first,
 * `name = value` settings, `name [arg] {` … `}` sections, `#` comments and `!include` lines (Netfix has no conf.d, so
 * they add nothing). Top-level names are checked; settings inside a section are not (shortcut: Netfix models none).
 */
export const DOVECOT_CONF = '/etc/dovecot/dovecot.conf';
export const DOVECOT_VERSION = '2.4.1-4 (7d8c0e5759)';

/** The top-level settings and sections Netfix knows of Dovecot 2.4. */
const KNOWN = new Set([
  'dovecot_config_version', 'dovecot_storage_version', 'protocols', 'listen', 'mail_driver', 'mail_path', 'mail_home',
  'mail_inbox_path', 'mail_uid', 'mail_gid', 'mail_privileged_group', 'mail_plugins', 'first_valid_uid', 'last_valid_uid',
  'auth_mechanisms', 'auth_allow_cleartext', 'auth_username_format', 'auth_verbose', 'auth_debug', 'mail_debug',
  'ssl', 'ssl_server_cert_file', 'ssl_server_key_file', 'ssl_min_protocol', 'login_greeting', 'log_path', 'info_log_path',
  'debug_log_path', 'log_debug', 'base_dir', 'instance_name', 'hostname', 'postmaster_address', 'verbose_proctitle',
  'shutdown_clients', 'namespace', 'passdb', 'userdb', 'service', 'protocol', 'ssl_server', 'mail_attribute',
]);
const PROTOCOLS = new Set(['imap', 'pop3', 'lmtp', 'submission', 'none']);

export interface DovecotConf {
  /** doveconf's fatal error, without `doveconf: Fatal: `. */
  readonly error?: string;
  /** The lines doveconf -n prints (normalised indentation). */
  readonly lines: readonly string[];
  /** The protocols setting (empty when the file sets none). */
  readonly protocols: readonly string[];
}

const at = (path: string, line: number, msg: string): string => `Error in configuration file ${path} line ${line}: ${msg}`;

function protocolError(path: string, value: string): string | undefined {
  const bad = value.split(/\s+/).filter((p) => p !== '' && !PROTOCOLS.has(p.replace(/^!/, '')));
  return bad.length ? `Error in configuration file ${path}: protocols: Unknown protocol: ${bad[0]?.slice(0, 64) ?? ''}` : undefined;
}

/** One line of the file: undefined when good, else the error. */
function lineError(path: string, n: number, text: string, depth: number, seen: number): string | undefined {
  // Plain prefixes only: a line can be MAX_FILE long, so no backtracking pattern runs over it.
  const name = text.endsWith('{') ? /^[A-Za-z0-9_]+(?=\s|\{)/.exec(text)?.[0] : /^([A-Za-z0-9_]+)\s*=/.exec(text)?.[1];
  if (name === undefined) return at(path, n, "Expecting '='");
  if (seen === 0 && name !== 'dovecot_config_version') return at(path, n, 'The first setting must be dovecot_config_version');
  if (depth === 0 && !KNOWN.has(name)) return at(path, n, `Unknown setting: ${name.slice(0, 64)}`);
  return undefined;
}

/** What doveconf reads (doveconf -n, the start and `doveadm reload`). */
export function parseDovecotConf(text: string, path = DOVECOT_CONF): DovecotConf {
  const lines: string[] = [];
  let depth = 0;
  let protocols = '';
  let open = 0;
  for (const [i, raw] of text.split('\n').entries()) {
    const t = raw.replace(/(^|\s)#.*$/, '').trim();
    if (t === '' || t.startsWith('!include')) continue;
    if (t === '}') {
      if (depth === 0) return { error: at(path, i + 1, "Unexpected '}'"), lines, protocols: [] };
      depth--;
      lines.push(`${'  '.repeat(depth)}}`);
      continue;
    }
    const err = lineError(path, i + 1, t, depth, lines.length);
    if (err !== undefined) return { error: err, lines, protocols: [] };
    // indexOf, not /\s*=\s*/: that regex is quadratic on a long run of spaces without '='.
    const eq = t.indexOf('=');
    lines.push(`${'  '.repeat(depth)}${eq < 0 ? t : `${t.slice(0, eq).trimEnd()} = ${t.slice(eq + 1).trimStart()}`}`);
    if (t.endsWith('{')) { depth++; open = i + 1; }
    else if (depth === 0 && /^protocols\s*=/.test(t)) protocols = t.slice(t.indexOf('=') + 1).trim();
  }
  if (depth > 0) return { error: at(path, open, "Missing '}'"), lines, protocols: [] };
  if (!lines.length) return { error: `Error in configuration file ${path}: dovecot_config_version setting is missing`, lines, protocols: [] };
  const perr = protocolError(path, protocols);
  if (perr !== undefined) return { error: perr, lines, protocols: [] };
  return { lines, protocols: protocols.split(/\s+/).filter((p) => p !== '' && p !== 'none') };
}
