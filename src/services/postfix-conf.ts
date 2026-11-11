/**
 * /etc/postfix/main.cf as Postfix 3.10 reads it: `name = value` lines, `#` comments, a line that starts with
 * whitespace continues the one before; `$name` and `${name}` expand to other parameters. postconf only parses
 * (a line without '=' is fatal); `postfix check` and the start also check the values the model takes (mydomain,
 * myhostname). Unknown names are only warned about, as postconf does.
 */
export const MAIN_CF = '/etc/postfix/main.cf';

/** Defaults of the parameters Netfix knows (postconf -d), and the names postconf does not warn about. */
export const POSTFIX_DEFAULTS: Readonly<Record<string, string>> = {
  alias_database: 'hash:/etc/aliases', alias_maps: 'hash:/etc/aliases', append_dot_mydomain: 'no', biff: 'yes',
  compatibility_level: '0', home_mailbox: '', inet_interfaces: 'all', inet_protocols: 'all', mailbox_size_limit: '51200000',
  message_size_limit: '10240000', mydestination: '$myhostname, localhost.$mydomain, localhost', mydomain: 'localdomain',
  myhostname: 'localhost.localdomain', mynetworks: '127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128', myorigin: '$myhostname',
  readme_directory: 'no', recipient_delimiter: '', relayhost: '', smtpd_banner: '$myhostname ESMTP $mail_name',
  mail_name: 'Postfix', maillog_file: '', smtpd_relay_restrictions: 'permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination',
};

/** Families of parameters that exist in Postfix but Netfix does not list one by one. */
const KNOWN_PREFIX = /^(?:smtpd?|lmtp|tls|virtual|local|transport|relay|milter|smtputf8|header|body|disable|default)_/;
const MAX_EXPAND = 10;
const MAX_VALUE = 4096;
const NAME = /^[A-Za-z0-9_]+$/;
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export interface MainCf {
  /** The parameters of the file, in order (a later line wins). */
  readonly params: ReadonlyMap<string, string>;
  /** postconf's fatal error, without the program name. */
  readonly error?: string;
  readonly warnings: readonly string[];
}

function logical(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  text.split('\n').forEach((raw, i) => {
    if (/^\s*(?:#|$)/.test(raw)) return;
    const last = out.at(-1);
    if (/^\s/.test(raw) && last) last.text += ` ${raw.trim()}`;
    else out.push({ line: i + 1, text: raw.trim() });
  });
  return out;
}

/** What postconf reads from main.cf. */
export function parseMainCf(text: string, path = MAIN_CF): MainCf {
  const params = new Map<string, string>();
  for (const l of logical(text)) {
    const eq = l.text.indexOf('=');
    const name = (eq < 0 ? l.text : l.text.slice(0, eq)).trim();
    if (eq < 0 || !NAME.test(name)) return { params, warnings: [], error: `${path}, line ${l.line}: missing '=' after attribute name: "${name.slice(0, 64)}"` };
    params.set(name, l.text.slice(eq + 1).trim());
  }
  const warnings = [...params].filter(([k]) => !(k in POSTFIX_DEFAULTS) && !KNOWN_PREFIX.test(k)).map(([k, v]) => `${path}: unused parameter: ${k}=${v.slice(0, 64)}`);
  return { params, warnings };
}

/** A parameter's value with `$name` expanded (the file's, else the default), as Postfix uses it. */
export function postfixValue(params: ReadonlyMap<string, string>, name: string): string | undefined {
  const raw = params.get(name) ?? POSTFIX_DEFAULTS[name];
  if (raw === undefined) return undefined;
  let v = raw;
  // `a = $a$a` doubles at each pass: stop at a bound rather than grow without end.
  for (let i = 0; i < MAX_EXPAND && v.includes('$') && v.length <= MAX_VALUE; i++) {
    // The bound holds inside a pass too: one pass of `$a` × 2048 must not build a huge string.
    let size = 0;
    v = v.replace(/\$\{?([A-Za-z0-9_]+)\}?/g, (_, n: string) => {
      const sub = size > MAX_VALUE ? '' : (params.get(n) ?? POSTFIX_DEFAULTS[n] ?? '').slice(0, MAX_VALUE);
      size += sub.length;
      return sub;
    });
  }
  return v.slice(0, MAX_VALUE);
}

export interface PostfixCheck {
  readonly error?: string;
  readonly warnings: readonly string[];
  /** The mail domain of the model ('' for Postfix's localdomain). */
  readonly domain: string;
}

/**
 * `postfix check` and the start: the file parses and its names are valid domains. mydomain, when not set, is
 * myhostname without its first label (Postfix's default).
 */
export function checkMainCf(text: string, path = MAIN_CF): PostfixCheck {
  const cf = parseMainCf(text, path);
  if (cf.error !== undefined) return { error: cf.error, warnings: [], domain: '' };
  const host = postfixValue(cf.params, 'myhostname') ?? '';
  const domain = cf.params.has('mydomain') ? postfixValue(cf.params, 'mydomain') ?? '' : host.split('.').slice(1).join('.') || 'localdomain';
  for (const [name, value] of [['myhostname', host], ['mydomain', domain]] as const) {
    if (!DOMAIN.test(value)) return { error: `file ${path}: parameter ${name}: bad parameter value: ${value.slice(0, 64)}`, warnings: cf.warnings, domain: '' };
  }
  return { warnings: cf.warnings, domain: domain.toLowerCase() === 'localdomain' ? '' : domain.toLowerCase() };
}
