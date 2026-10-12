/**
 * Apache 2.4 configuration reader: apache2.conf with Include/IncludeOptional, <IfModule>, <IfDefine>,
 * <VirtualHost>, <Directory>, Listen, ServerName/Alias, DocumentRoot, Alias, Redirect, DirectoryIndex,
 * ErrorDocument, Options and Require, with Apache's error messages (AH00526…).
 */
import { APACHE_ROOT, ENVVARS } from './defaults.ts';
import { directiveModule, argError } from './directives.ts';
import type { ApacheConfig, ConfReader, DirBlock, VHost } from './model.ts';
import { emptyVhost } from './model.ts';

export type { ApacheConfig, ConfReader, DirBlock, VHost } from './model.ts';

export type ParseResult = { readonly ok: true; readonly config: ApacheConfig } | { readonly ok: false; readonly error: string };

/** Modules compiled into Ubuntu's apache2 binary. */
const STATIC_MODULES = ['core', 'so', 'watchdog', 'http', 'log_config', 'logio', 'version', 'unixd', 'mpm'];
const MAX_INCLUDES = 300;
const SECTIONS = new Set(['virtualhost', 'directory', 'directorymatch', 'files', 'filesmatch', 'location', 'locationmatch', 'ifmodule', 'ifdefine', 'ifversion', 'proxy', 'limit', 'limitexcept', 'requireall', 'requireany', 'requirenone', 'if', 'else', 'elseif']);

interface Frame {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly skip: boolean;
  readonly dir?: DirBlock;
}

class SyntaxError extends Error {
  readonly file: string;
  readonly line: number;
  constructor(file: string, line: number, message: string) {
    super(message);
    this.file = file;
    this.line = line;
  }
}

/** "mod_ssl.c", "ssl_module", "!mod_x.c" → "ssl" / "x". */
export function moduleName(arg: string): string {
  return arg.replace(/^!/, '').replace(/^mod_/, '').replace(/\.c$/, '').replace(/_module$/, '');
}

/** Splits a directive line into words, keeping quoted strings together. */
export function words(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? '');
  return out;
}

class Reader {
  readonly config: ApacheConfig = { listens: [], modules: new Set(STATIC_MODULES), vhosts: [], main: emptyVhost('', 0), directories: [], directoryIndex: ['index.html'], warnings: [], defines: new Set(), serverTokens: 'OS', serverSignature: true };
  private readonly io: ConfReader;
  private includes = 0;
  private vhost: VHost | null = null;

  constructor(io: ConfReader) {
    this.io = io;
  }

  private expand(text: string, file: string, line: number): string {
    return text.replace(/\$\{(\w+)\}/g, (m, name: string) => {
      const v = ENVVARS[name] ?? (this.config.defines.has(name) ? '' : undefined);
      if (v === undefined) {
        this.config.warnings.push(`AH00111: Config variable \${${name}} is not defined`);
        void file; void line;
        return m;
      }
      return v;
    });
  }

  readFile(path: string, optional: boolean): void {
    const text = this.io.read(path);
    if (text === null) {
      if (optional) return;
      throw new SyntaxError(path, 0, `Could not open configuration file ${path}: No such file or directory`);
    }
    if (++this.includes > MAX_INCLUDES) throw new SyntaxError(path, 0, 'AH00532: Too many levels of Include');
    const stack: Frame[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let raw = lines[i] ?? '';
      const first = i + 1;
      while (raw.endsWith('\\') && i + 1 < lines.length) raw = `${raw.slice(0, -1)} ${lines[++i] ?? ''}`;
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      this.line(this.expand(trimmed, path, first), path, first, stack);
    }
    const open = stack[stack.length - 1];
    if (open) throw new SyntaxError(open.file, open.line, `${open.file}:${open.line}: <${open.name}> was not closed.`);
  }

  private line(text: string, file: string, line: number, stack: Frame[]): void {
    const top = stack[stack.length - 1];
    if (text.startsWith('</')) {
      const name = text.slice(2).replace(/>\s*$/, '').trim();
      if (!top) throw new SyntaxError(file, line, `</${name}> without matching <${name}> section`);
      if (top.name.toLowerCase() !== name.toLowerCase()) throw new SyntaxError(file, line, `Expected </${top.name}> but saw </${name}>`);
      stack.pop();
      if (name.toLowerCase() === 'virtualhost' && !top.skip) this.vhost = null;
      return;
    }
    if (text.startsWith('<')) {
      const body = text.slice(1).replace(/>\s*$/, '');
      const [name = '', ...args] = words(body);
      if (!SECTIONS.has(name.toLowerCase())) throw new SyntaxError(file, line, `Invalid command '<${name}', perhaps misspelled or defined by a module not included in the server configuration`);
      stack.push(this.openSection(name, args, file, line, top?.skip ?? false));
      return;
    }
    if (top?.skip) return;
    const [name = '', ...args] = words(text);
    this.directive(name, args, file, line, top);
  }

  private openSection(name: string, args: string[], file: string, line: number, skipping: boolean): Frame {
    const lower = name.toLowerCase();
    if (skipping) return { name, file, line, skip: true };
    if (args.length === 0 && lower !== 'else') throw new SyntaxError(file, line, `<${name}> directive requires additional arguments`);
    if (lower === 'ifmodule') {
      const loaded = this.config.modules.has(moduleName(args[0] ?? ''));
      return { name, file, line, skip: (args[0] ?? '').startsWith('!') ? loaded : !loaded };
    }
    if (lower === 'ifdefine') {
      const def = this.config.defines.has((args[0] ?? '').replace(/^!/, ''));
      return { name, file, line, skip: (args[0] ?? '').startsWith('!') ? def : !def };
    }
    if (lower === 'virtualhost') {
      if (this.vhost) throw new SyntaxError(file, line, '<VirtualHost> cannot occur within <VirtualHost> section');
      const [addr = '*', port = '*'] = (args[0] ?? '*').split(':');
      this.vhost = emptyVhost(file, line, addr, port === '*' ? 0 : Number(port));
      this.config.vhosts.push(this.vhost);
      return { name, file, line, skip: false };
    }
    if (lower === 'directory' || lower === 'directorymatch') {
      const dir: DirBlock = { path: (args[0] ?? '').replace(/\/+$/, '') || '/', regex: lower === 'directorymatch' || args[0] === '~', options: {} };
      (this.vhost?.directories ?? this.config.directories).push(dir);
      return { name, file, line, skip: false, dir };
    }
    return { name, file, line, skip: false };
  }

  private directive(name: string, args: string[], file: string, line: number, top: Frame | undefined): void {
    const lower = name.toLowerCase();
    const mod = directiveModule(lower);
    if (mod === undefined || !this.config.modules.has(mod)) {
      throw new SyntaxError(file, line, `Invalid command '${name}', perhaps misspelled or defined by a module not included in the server configuration`);
    }
    const bad = argError(lower, args);
    if (bad) throw new SyntaxError(file, line, bad);
    const scope = this.vhost ?? this.config.main;
    switch (lower) {
      case 'loadmodule': this.config.modules.add(moduleName(args[0] ?? '')); break;
      case 'include': case 'includeoptional': this.include(args[0] ?? '', lower === 'includeoptional', file, line); break;
      case 'define': this.config.defines.add(args[0] ?? ''); break;
      case 'listen': this.listen(args, file, line); break;
      case 'servername': if (this.vhost) this.vhost.serverName = (args[0] ?? '').toLowerCase().replace(/:\d+$/, ''); else this.config.serverName = args[0]; break;
      case 'serveralias': if (this.vhost) this.vhost.serverAliases.push(...args.map((a) => a.toLowerCase())); break;
      case 'documentroot': scope.documentRoot = (args[0] ?? '').replace(/\/+$/, '') || '/'; break;
      case 'alias': scope.aliases.push({ url: args[0] ?? '', path: args[1] ?? '' }); break;
      case 'redirect': case 'redirectpermanent': case 'redirecttemp': this.redirect(lower, args, scope); break;
      case 'directoryindex': if (top?.dir) top.dir.directoryIndex = args; else if (this.vhost) this.vhost.directoryIndex = args; else this.config.directoryIndex = args; break;
      case 'errordocument': scope.errorDocs[Number(args[0])] = args.slice(1).join(' '); break;
      case 'options': if (top?.dir) applyOptions(top.dir, args); break;
      case 'require': if (top?.dir) top.dir.access = args.join(' ').toLowerCase() === 'all denied' ? 'denied' : 'granted'; break;
      case 'deny': if (top?.dir && args.join(' ').toLowerCase() === 'from all') top.dir.access = 'denied'; break;
      case 'servertokens': this.config.serverTokens = args[0] ?? 'OS'; break;
      case 'serversignature': this.config.serverSignature = (args[0] ?? '').toLowerCase() !== 'off'; break;
      default: break;
    }
  }

  private include(pattern: string, optional: boolean, file: string, line: number): void {
    const abs = pattern.startsWith('/') ? pattern : `${APACHE_ROOT}/${pattern}`;
    const files = /[*?[]/.test(abs) ? this.io.glob(abs) : [abs];
    if (!files.length && !optional && !/[*?[]/.test(abs)) throw new SyntaxError(file, line, `Could not open configuration file ${abs}: No such file or directory`);
    for (const f of files) {
      try {
        this.readFile(f, optional);
      } catch (e) {
        if (e instanceof SyntaxError && e.line === 0) throw new SyntaxError(file, line, e.message);
        throw e;
      }
    }
  }

  private listen(args: string[], file: string, line: number): void {
    const spec = args[0] ?? '';
    const m = /^(?:(\[[^\]]+\]|[\d.]+|\*):)?(\d{1,5})$/.exec(spec);
    const port = Number(m?.[2]);
    if (!m || port < 1 || port > 65535) throw new SyntaxError(file, line, 'Invalid address or port');
    if (!this.config.listens.some((l) => l.port === port)) this.config.listens.push({ addr: m[1], port });
  }

  private redirect(kind: string, args: string[], scope: VHost): void {
    const status = kind === 'redirectpermanent' ? 301 : kind === 'redirecttemp' ? 302 : args.length === 3 ? statusOf(args[0] ?? '') : 302;
    const [url = '', target = ''] = args.length === 3 ? args.slice(1) : args;
    scope.redirects.push({ url, target, status });
  }
}

function statusOf(word: string): number {
  const w = word.toLowerCase();
  return w === 'permanent' ? 301 : w === 'temp' ? 302 : w === 'seeother' ? 303 : w === 'gone' ? 410 : Number(word) || 302;
}

function applyOptions(dir: DirBlock, args: string[]): void {
  for (const a of args) {
    const name = a.replace(/^[+-]/, '').toLowerCase();
    if (name === 'none') dir.options.indexes = false;
    else if (name === 'all' || name === 'indexes') dir.options.indexes = !a.startsWith('-');
  }
}

/** Reads /etc/apache2/apache2.conf and everything it includes. */
export function loadApacheConfig(io: ConfReader): ParseResult {
  const r = new Reader(io);
  try {
    r.readFile(`${APACHE_ROOT}/apache2.conf`, false);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    const msg = e.line > 0 ? `AH00526: Syntax error on line ${e.line} of ${e.file}:\n${e.message}` : e.message;
    return { ok: false, error: msg };
  }
  if (!r.config.serverName) r.config.warnings.push("AH00558: apache2: Could not reliably determine the server's fully qualified domain name, using 127.0.1.1. Set the 'ServerName' directive globally to suppress this message");
  return { ok: true, config: r.config };
}
