/**
 * Syntax highlighting of configuration files as vim shows them: the filetype vim detects from the path and the
 * highlight groups of its syntax files (Comment, Constant, String, Number, Identifier, Statement, PreProc, Type,
 * Special, and ErrorMsg as Error). Pure: the interface paints the groups with vim's default colours. A small rule set
 * per filetype, not a port of vim's syntax engine: enough for the configuration files and logs the interface shows.
 */

export type SynGroup = 'Comment' | 'Constant' | 'String' | 'Number' | 'Identifier' | 'Statement' | 'PreProc' | 'Type' | 'Special' | 'Error';
export type Filetype = 'sshdconfig' | 'json' | 'named' | 'bindzone' | 'apache' | 'pfmain' | 'dovecot' | 'sysctl' | 'nftables' | 'dosini' | 'messages' | 'sh' | 'conf';

export interface SynSpan {
  readonly text: string;
  /** null: normal text. */
  readonly group: SynGroup | null;
}

interface Rule {
  readonly re: RegExp;
  readonly group: SynGroup;
  /** Only as the first word of the line. */
  readonly bol?: boolean;
}

interface Syntax {
  readonly rules: readonly Rule[];
  /** C-style block comments that may span lines. */
  readonly block?: boolean;
}

/** A sticky regular expression (it must match exactly where the scan is). */
const re = (source: string, flags = ''): RegExp => new RegExp(source, `y${flags}`);
/** Whole words of a list (longest first, so «allow-query» wins over «allow»). */
const words = (list: string, flags = ''): RegExp => re(`(?:${list.split(/\s+/).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.$]/g, '\\$&')).join('|')})(?![\\w.-])`, flags);
/** Like vim's 'synmaxcol': columns beyond this are not highlighted (a hostile one-line file stays fast). */
export const SYNMAXCOL = 1000;

const HASH: Rule = { re: re('#.*'), group: 'Comment' };
const SLASHES: Rule = { re: re('//.*'), group: 'Comment' };
const STRING: Rule = { re: re('"(?:[^"\\\\]|\\\\.)*"?'), group: 'String' };
/** Numbers, IPv4 addresses and prefixes (10, 8.8.8.8, 192.168.1.0/24). */
const NUMBER: Rule = { re: re('\\d+(?:\\.\\d+){0,3}(?:/\\d+)?(?![\\w.])'), group: 'Number' };
const BOOL = (extra = ''): Rule => ({ re: words(`yes no on off true false ${extra}`.trim(), 'i'), group: 'Constant' });

const NAMED_WORDS = 'options zone type file directory forwarders forward allow-query allow-recursion allow-transfer '
  + 'allow-update recursion listen-on listen-on-v6 acl view key masters primaries also-notify notify include logging '
  + 'channel category severity response-policy dnssec-validation querylog auth-nxdomain controls server '
  + 'master slave primary secondary hint only first max-cache-ttl max-ncache-ttl version minimal-responses';

/** Keywords and builtins that vim's sh.vim highlights as Statement (longest first, as words() does). */
const SH_WORDS = 'function continue readonly declare export select return source printf break local while until shift unset elif else then done case esac exit echo read test for set if fi do in cd'.split(' ');

const SYNTAX: Readonly<Record<Filetype, Syntax>> = {
  sshdconfig: { rules: [HASH, { re: re('[A-Za-z]\\w*'), group: 'Statement', bol: true }, BOOL('prohibit-password without-password forced-commands-only any none'), NUMBER] },
  json: {
    block: true,
    rules: [SLASHES, HASH, { re: re('"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)'), group: 'Statement' }, STRING, { re: words('true false null'), group: 'Constant' },
      { re: re('-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?(?![\\w.])'), group: 'Number' }],
  },
  named: { block: true, rules: [SLASHES, HASH, STRING, { re: words(NAMED_WORDS), group: 'Statement' }, BOOL('none any localhost localnets auto'), NUMBER] },
  bindzone: {
    rules: [{ re: re(';.*'), group: 'Comment' }, { re: re('\\$(?:TTL|ORIGIN|INCLUDE|GENERATE)(?![\\w])'), group: 'PreProc' },
      { re: words('IN CH HS'), group: 'Statement' }, { re: words('SOA NS A AAAA MX CNAME TXT PTR SRV CAA DNAME SPF NAPTR DS DNSKEY'), group: 'Type' },
      // (?=(…))\\1 is an atomic group: no backtracking over the labels of a long name.
      { re: re('(?=((?:[\\w-]+\\.)+))\\1(?![\\w-])'), group: 'Identifier' }, { re: re('@'), group: 'Special' }, STRING, NUMBER],
  },
  apache: {
    rules: [HASH, { re: re('</?[A-Za-z]+'), group: 'Type' }, { re: re('>'), group: 'Type' }, { re: re('[A-Za-z]\\w*'), group: 'Identifier', bol: true },
      { re: re('\\$\\{\\w+\\}'), group: 'Special' }, STRING, BOOL('all none granted denied')],
  },
  pfmain: { rules: [HASH, { re: re('\\w+(?=\\s*=)'), group: 'Statement', bol: true }, { re: re('\\$(?:\\{\\w+\\}|\\w+)'), group: 'Identifier' }, BOOL()] },
  dovecot: {
    rules: [HASH, { re: re('(?=([a-z_]+))\\1(?=[^={]*\\{)'), group: 'Type', bol: true }, { re: re('[\\w-]+(?=\\s*=)'), group: 'Statement', bol: true },
      STRING, BOOL(), NUMBER],
  },
  sysctl: { rules: [HASH, { re: re(';.*'), group: 'Comment' }, { re: re('[\\w./-]+(?=\\s*=)'), group: 'Identifier', bol: true }, NUMBER] },
  nftables: {
    rules: [HASH, STRING, { re: words('inet ip ip6 arp bridge netdev'), group: 'Type' },
      { re: words('table chain type hook priority policy accept drop reject counter log prefix ct state established related '
        + 'invalid new iifname oifname iif oif saddr daddr tcp udp icmp icmpv6 dport sport flush ruleset define masquerade snat dnat '
        + 'to jump goto return comment filter nat route input output forward prerouting postrouting limit rate set map elements '
        + 'meta l4proto th echo-request echo-reply'), group: 'Statement' },
      { re: re('\\$\\w+'), group: 'Identifier' }, { re: re('@\\w+'), group: 'Special' }, NUMBER],
  },
  dosini: { rules: [HASH, { re: re(';.*'), group: 'Comment' }, { re: re('\\[[^\\]]*\\]'), group: 'Special', bol: true }, { re: re('[\\w.-]+(?=\\s*=)'), group: 'Identifier', bol: true }, NUMBER] },
  // vim's syntax/messages.vim (syslog, journalctl): date, time, host, program and PID; a line with an error word is
  // ErrorMsg from its text on. The time and the program also match the web GUI's «HH:MM:SS unit: text».
  messages: {
    rules: [
      { re: re(String.raw`[A-Z][a-z]{2} [ \d]\d(?= \d\d:)`), group: 'Constant', bol: true },
      { re: re(String.raw`(?<=^(?:[A-Z][a-z]{2} [ \d]\d )?)\d\d:\d\d:\d\d(?:\.\d+)?`), group: 'Type' },
      { re: re(String.raw`(?<=^[A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d(?:\.\d+)? )[\w.-]+(?= [\w./@-]+(?:\[\d+\])?: )`), group: 'Identifier' },
      { re: re(String.raw`(?<=^(?:[A-Z][a-z]{2} [ \d]\d )?\d\d:\d\d:\d\d(?:\.\d+)? (?:[\w.-]+ )?)[\w./@-]+(?=(?:\[\d+\])?: )`), group: 'Statement' },
      { re: re(String.raw`\[\d+\](?=: )`), group: 'Constant' },
      { re: re(String.raw`(?<=: )(?=.*\b(?:fatal|errors?|failed|failure)\b).*`, 'i'), group: 'Error' },
      { re: re(String.raw`\d{1,3}(?:\.\d{1,3}){3}(?![\w.])`), group: 'Constant' },
    ],
  },
  // vim's syntax/sh.vim: $var and ${…} (shDeref → PreProc) before #, so `$#` is not a comment; keywords and builtins
  // (Conditional, Repeat, shStatement → Statement), test operators like -d, quotes (String) and numbers.
  sh: {
    rules: [
      { re: re(String.raw`\$(?:\{[^}]*\}|[A-Za-z_]\w*|[0-9#@*?$!-])`), group: 'PreProc' },
      // A comment starts only at the beginning of a word (foo#bar is one word).
      { re: re(String.raw`(?<![^\s;&|()])#.*`), group: 'Comment' },
      { re: re(String.raw`'[^']*'?`), group: 'String' }, STRING,
      // Keywords and builtins as whole words, not inside paths or hyphenated words (/usr/bin/test, my-test).
      { re: re(String.raw`(?<![\w./-])(?:${SH_WORDS.join('|')})(?![\w.-])`), group: 'Statement' },
      // Test operators of test, [ and [[ (shTestOpr), after a blank or a bracket: not the options of ls -la.
      { re: re(String.raw`(?<=[\s[(])-(?:eq|ne|lt|le|gt|ge|ef|nt|ot|[abcdefghknoprstuvwxzGLNOS])(?![\w-])`), group: 'Statement' }, NUMBER,
    ],
  },
  conf: { rules: [HASH, STRING, NUMBER] },
};

/** vim's filetype for a configuration file (from its path, as filetype.vim does). */
export function filetypeOf(path: string): Filetype {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (path.startsWith('/etc/ssh/sshd_config')) return 'sshdconfig';
  if (path.startsWith('/etc/kea/') || name.endsWith('.json')) return 'json';
  if (path.startsWith('/etc/bind/')) return name.startsWith('named.conf') ? 'named' : 'bindzone';
  if (path.startsWith('/etc/apache2/')) return 'apache';
  if (name === 'main.cf') return 'pfmain';
  if (path.startsWith('/etc/dovecot/')) return 'dovecot';
  if (name === 'sysctl.conf' || path.startsWith('/etc/sysctl.d/')) return 'sysctl';
  if (name === 'nftables.conf' || name.endsWith('.nft')) return 'nftables';
  if (path.startsWith('/etc/wireguard/') || name.endsWith('.ini')) return 'dosini';
  if (path.startsWith('/var/log/')) return 'messages';
  if (/\.(?:sh|bash)$/.test(name) || ['.bashrc', '.bash_profile', '.bash_logout', '.bash_aliases', '.profile', 'bash.bashrc'].includes(name) || path === '/etc/profile') return 'sh';
  return 'conf';
}

const WORD = /[A-Za-z0-9_]+/y;

/** Appends a span, joining it to the previous one when it has the same group. */
function push(out: SynSpan[], text: string, group: SynGroup | null): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.group === group) out[out.length - 1] = { text: last.text + text, group };
  else out.push({ text, group });
}

function ruleAt(syntax: Syntax, line: string, i: number, bol: boolean): { text: string; group: SynGroup } | null {
  for (const r of syntax.rules) {
    if (r.bol && !bol) continue;
    r.re.lastIndex = i;
    const m = r.re.exec(line);
    if (m && m[0]) return { text: m[0], group: r.group };
  }
  return null;
}

/** One line; `open` says whether a block comment is still open from the previous lines. Returns the new state. */
function line(syntax: Syntax, text: string, open: boolean, out: SynSpan[]): boolean {
  let i = 0;
  let inBlock = open;
  /** Only blanks so far (kept as the scan goes: slicing the line at every token would be quadratic). */
  let bol = true;
  while (i < text.length) {
    if (inBlock || (syntax.block && text.startsWith('/*', i))) {
      const end = text.indexOf('*/', inBlock ? i : i + 2);
      const stop = end < 0 ? text.length : end + 2;
      push(out, text.slice(i, stop), 'Comment');
      inBlock = end < 0;
      i = stop;
      bol = false;
      continue;
    }
    const hit = ruleAt(syntax, text, i, bol);
    // Normal text: a whole word at once, so no rule matches inside a word («no» in «nothing»).
    WORD.lastIndex = i;
    const token = hit ?? { text: WORD.exec(text)?.[0] ?? text[i] ?? '', group: null };
    push(out, token.text, token.group);
    if (bol && token.text.trim() !== '') bol = false;
    i += token.text.length;
  }
  return inBlock;
}

/** The spans of each line of `text` (the lines of `text.split('\n')`, every character kept). */
export function highlight(text: string, filetype: Filetype): SynSpan[][] {
  const syntax = SYNTAX[filetype];
  let open = false;
  return text.split('\n').map((l) => {
    const out: SynSpan[] = [];
    open = line(syntax, l.slice(0, SYNMAXCOL), open, out);
    push(out, l.slice(SYNMAXCOL), null);
    return out;
  });
}
