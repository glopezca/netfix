/** Line-based syntax highlighting for batcat (colours of bat's default Monokai Extended theme). */

export type Language = 'bash' | 'apache' | 'html' | 'json' | 'yaml' | 'python' | 'dns' | 'ini' | 'markdown' | 'text';

const C = { comment: 242, string: 186, keyword: 203, number: 141, variable: 208, func: 149, key: 81, tag: 203, attr: 149 } as const;
type Color = (typeof C)[keyof typeof C];
type Rule = readonly [RegExp, Color];

const NUM: Rule = [/\b\d+(?:\.\d+)?\b/y, C.number];
const DQ: Rule = [/"(?:[^"\\]|\\.)*"?/y, C.string];
const SQ: Rule = [/'[^']*'?/y, C.string];

const RULES: Readonly<Record<Language, readonly Rule[]>> = {
  bash: [
    [/(?:^|(?<=\s))#.*/y, C.comment], DQ, SQ, [/\$(?:\{[^}]*\}|[\w@#?*!$-]+|\()/y, C.variable],
    [/\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|local|export|select|time|declare|readonly)\b/y, C.keyword],
    [/\b(?:echo|printf|cd|read|exit|source|test|set|shift|unset|trap|eval|exec|sudo)\b/y, C.func], NUM,
  ],
  apache: [
    [/^\s*#.*/y, C.comment], [/<\/?[\w:]+/y, C.tag], [/>/y, C.tag], [/(?<=^\s*(?:<\/?)?)[A-Za-z][\w]*/y, C.key], DQ, [/\$\{\w+\}/y, C.variable], NUM,
  ],
  html: [[/<!--.*?(?:-->|$)/y, C.comment], [/<\/?[\w:-]+/y, C.tag], [/\/?>/y, C.tag], [/[\w:-]+(?==)/y, C.attr], DQ, SQ, [/&\w+;/y, C.number]],
  json: [[/"(?:[^"\\]|\\.)*"(?=\s*:)/y, C.key], DQ, [/\b(?:true|false|null)\b/y, C.keyword], [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, C.number]],
  yaml: [[/(?:^|(?<=\s))#.*/y, C.comment], [/(?<=^\s*(?:- )?)[\w.-]+(?=:)/y, C.key], DQ, SQ, [/\b(?:true|false|yes|no|null)\b/y, C.keyword], NUM],
  python: [
    [/#.*/y, C.comment], DQ, SQ,
    [/\b(?:def|class|if|elif|else|for|while|return|import|from|as|with|try|except|finally|pass|in|not|and|or|None|True|False|lambda|yield|raise|global)\b/y, C.keyword],
    [/(?<=\b(?:def|class) )\w+/y, C.func], NUM,
  ],
  dns: [[/;.*/y, C.comment], [/^\$(?:ORIGIN|TTL|INCLUDE)\b/y, C.keyword], [/\b(?:IN|SOA|NS|A|AAAA|CNAME|MX|TXT|PTR|SRV)\b/y, C.key], DQ, NUM],
  ini: [[/^\s*[#;].*/y, C.comment], [/^\s*\[[^\]]*\]/y, C.tag], [/(?<=^\s*)[\w.-]+(?=\s*=)/y, C.key], DQ, NUM],
  markdown: [[/^#{1,6} .*/y, C.keyword], [/`[^`]*`/y, C.string], [/\*\*[^*]+\*\*/y, C.func], [/^\s*[-*+] /y, C.number]],
  text: [],
};

/** Colours one line: the first rule that matches at each position wins. */
function highlightLine(line: string, rules: readonly Rule[]): string {
  let out = '';
  let plain = '';
  let i = 0;
  while (i < line.length) {
    let hit: { text: string; color: Color } | undefined;
    for (const [re, color] of rules) {
      re.lastIndex = i;
      const m = re.exec(line);
      if (m && m[0].length > 0) { hit = { text: m[0], color }; break; }
    }
    if (!hit) { plain += line[i++]; continue; }
    out += `${plain}\x1b[38;5;${hit.color}m${hit.text}\x1b[0m`;
    plain = '';
    i += hit.text.length;
  }
  return out + plain;
}

export function highlight(text: string, lang: Language): string {
  const rules = RULES[lang];
  if (rules.length === 0) return text;
  return text.split('\n').map((l) => highlightLine(l, rules)).join('\n');
}

const BY_NAME: Readonly<Record<string, Language>> = {
  '.bashrc': 'bash', '.profile': 'bash', '.bash_aliases': 'bash', '.bash_logout': 'bash', 'envvars': 'bash', 'apache2.conf': 'apache',
};
const BY_EXT: Readonly<Record<string, Language>> = {
  sh: 'bash', bash: 'bash', zsh: 'bash', conf: 'apache', htaccess: 'apache', load: 'apache', html: 'html', htm: 'html', xml: 'html', svg: 'html',
  json: 'json', yaml: 'yaml', yml: 'yaml', py: 'python', zone: 'dns', ini: 'ini', cfg: 'ini', cf: 'ini', md: 'markdown', markdown: 'markdown',
};

export const LANGUAGE_LIST: readonly string[] = [
  'Apache Conf:conf,htaccess,load,apache2.conf', 'Bourne Again Shell (bash):sh,bash,zsh,.bashrc,.bash_aliases,.profile,envvars',
  'DNS Zone:zone,db.*', 'HTML:html,htm,xml,svg', 'INI:ini,cfg,cf', 'JSON:json', 'Markdown:md,markdown', 'Python:py', 'Plain Text:txt', 'YAML:yaml,yml',
];

/** Language of a file from its name, extension or shebang. */
export function languageFor(name: string, content: string): Language {
  const base = name.split('/').pop() ?? name;
  if (BY_NAME[base]) return BY_NAME[base];
  if (/^db\./.test(base)) return 'dns';
  const ext = /\.([\w]+)$/.exec(base)?.[1]?.toLowerCase();
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (/^#!.*\b(?:ba|z|da)?sh\b/.test(content)) return 'bash';
  if (/^#!.*python/.test(content)) return 'python';
  return 'text';
}

/** Names accepted by bat's --language. */
export function languageByName(name: string): Language | undefined {
  const n = name.toLowerCase();
  const alias: Readonly<Record<string, Language>> = { sh: 'bash', bash: 'bash', shell: 'bash', apache: 'apache', conf: 'apache', html: 'html', xml: 'html', json: 'json', yaml: 'yaml', yml: 'yaml', python: 'python', py: 'python', dns: 'dns', zone: 'dns', ini: 'ini', md: 'markdown', markdown: 'markdown', txt: 'text', text: 'text' };
  return alias[n];
}
