/** vim command-line (ex) commands: :w :q :wq :x :e! :set :N :s :%s :d :noh :help… with vim's messages. */
import type { TextBuffer } from './buffer.ts';
import { byteLength } from './buffer.ts';

/** What the ex commands need from the editor. */
export interface ExTarget {
  readonly buf: TextBuffer;
  path: string;
  readOnly: boolean;
  isNew: boolean;
  number: boolean;
  closed: boolean;
  readonly original: string;
  save(path: string, content: string): string | null;
  message(text: string, error?: boolean): void;
}

const MAX_SUBSTITUTIONS = 100_000;

export function fileInfo(t: Pick<ExTarget, 'buf' | 'path'>, extra = ''): string {
  const text = t.buf.text();
  return `"${t.path}"${extra} ${t.buf.lines.length}L, ${byteLength(text)}B`;
}

function write(t: ExTarget, target: string | undefined, force: boolean): boolean {
  const path = target || t.path;
  if (!path) { t.message('E32: No file name', true); return false; }
  if (t.readOnly && !force && path === t.path) { t.message("E45: 'readonly' option is set (add ! to override)", true); return false; }
  const error = t.save(path, t.buf.text());
  if (error) { t.message(`"${path}" E212: Can't open file for writing`, true); return false; }
  const wasNew = t.isNew || path !== t.path;
  if (!t.path) t.path = path;
  if (path === t.path) { t.buf.modified = false; t.isNew = false; }
  t.message(`${fileInfo({ buf: t.buf, path }, wasNew ? ' [New]' : '')} written`);
  return true;
}

function quit(t: ExTarget, force: boolean): void {
  if (t.buf.modified && !force) { t.message('E37: No write since last change (add ! to override)', true); return; }
  t.closed = true;
}

function setOption(t: ExTarget, args: string): void {
  for (const opt of args.split(/\s+/).filter(Boolean)) {
    if (opt === 'nu' || opt === 'number') t.number = true;
    else if (opt === 'nonu' || opt === 'nonumber') t.number = false;
    else if (opt === 'ro' || opt === 'readonly') t.readOnly = true;
    else if (opt === 'noro' || opt === 'noreadonly') t.readOnly = false;
    else if (/^(no)?(hlsearch|hls|ic|ignorecase|ai|autoindent|paste|list|wrap|ruler|showmode|syntax=\w+|ts=\d+|sw=\d+|et|expandtab)$/.test(opt)) continue;
    else { t.message(`E518: Unknown option: ${opt}`, true); return; }
  }
}

/** :[range]s/pattern/replacement/[g] with JavaScript regular expressions close to vim's magic syntax. */
function substitute(t: ExTarget, all: boolean, body: string): void {
  const delim = body[0] ?? '/';
  const parts = body.slice(1).split(delim);
  const [pattern = '', replacement = '', flags = ''] = parts;
  let re: RegExp;
  try {
    re = new RegExp(pattern.replace(/\\</g, '\\b').replace(/\\>/g, '\\b').replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\|/g, '|'), flags.includes('g') ? 'g' : '');
  } catch {
    t.message(`E486: Pattern not found: ${pattern}`, true);
    return;
  }
  const b = t.buf;
  const rows = all ? b.lines.map((_, i) => i) : [b.row];
  const rep = replacement.replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&');
  const single = new RegExp(re.source);
  let count = 0;
  let changed = 0;
  let lastRow = -1;
  b.checkpoint();
  for (const r of rows) {
    const line = b.lines[r] ?? '';
    const next = line.replace(re, (match: string) => { count++; return match.replace(single, rep); });
    if (next !== line) { b.setLine(r, next); lastRow = r; changed++; }
    if (count > MAX_SUBSTITUTIONS) break;
  }
  if (lastRow < 0) { t.message(`E486: Pattern not found: ${pattern}`, true); return; }
  b.row = lastRow;
  b.col = 0;
  if (changed > 2) t.message(`${count} substitution${count === 1 ? '' : 's'} on ${changed} lines`);
}

/** Runs one command typed after `:`. */
export function runEx(t: ExTarget, input: string): void {
  const cmd = input.trim().replace(/^:+/, '');
  if (cmd === '') return;
  if (/^\d+$/.test(cmd) || cmd === '$') {
    t.buf.row = cmd === '$' ? t.buf.lines.length - 1 : Number(cmd) - 1;
    t.buf.clamp();
    t.buf.col = /\S/.exec(t.buf.line)?.index ?? 0;
    return;
  }
  const sub = /^(%)?s(ubstitute)?([^\w\s].*)$/.exec(cmd);
  if (sub) { substitute(t, sub[1] === '%', sub[3] ?? ''); return; }
  const m = /^([a-zA-Z]+)(!?)\s*(.*)$/.exec(cmd);
  const name = m?.[1] ?? cmd;
  const force = m?.[2] === '!';
  const arg = m?.[3]?.trim() ?? '';
  switch (name) {
    case 'w': case 'write': write(t, arg || undefined, force); return;
    case 'q': case 'quit': quit(t, force); return;
    case 'wq': case 'x': case 'xit': case 'exit':
      if ((name !== 'wq' && !t.buf.modified && arg === '') || write(t, arg || undefined, force)) t.closed = true;
      return;
    case 'qa': case 'qall': quit(t, force); return;
    case 'wqa': case 'xa': if (write(t, undefined, force)) t.closed = true; return;
    case 'e': case 'edit':
      if (!force && t.buf.modified) { t.message('E37: No write since last change (add ! to override)', true); return; }
      t.buf.checkpoint();
      t.buf.lines = t.original.split('\n').slice(0, t.original.endsWith('\n') ? -1 : undefined);
      if (!t.buf.lines.length) t.buf.lines = [''];
      t.buf.modified = false;
      t.buf.clamp(false);
      t.message(fileInfo(t));
      return;
    case 'set': case 'se': setOption(t, arg); return;
    case 'noh': case 'nohlsearch': return;
    case 'd': case 'delete': t.buf.checkpoint(); t.buf.removeLines(1); return;
    case 'h': case 'help': t.message('E149: Sorry, no help for netsim (usa la pestaña Documentación)', true); return;
    default: t.message(`E492: Not an editor command: ${cmd}`, true);
  }
}
