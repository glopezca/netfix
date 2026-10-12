/**
 * Pull lexer for bash. Words keep their raw text (quotes and substitutions included);
 * the parser decides reserved words. Unterminated constructs raise IncompleteInput so the
 * interactive shell can ask for more lines (PS2).
 */
import type { HereDoc } from './ast.ts';

export class IncompleteInput extends Error {
  constructor(what: string) {
    super(`incomplete: ${what}`);
  }
}

export class BashSyntaxError extends Error {
  readonly token: string;
  readonly line: number;
  constructor(token: string, message?: string, line = 0) {
    super(message ?? `syntax error near unexpected token \`${token}'`);
    this.token = token;
    this.line = line;
  }
}

export type Token =
  | { readonly kind: 'word'; readonly raw: string; readonly start: number; readonly end: number; readonly line: number }
  | { readonly kind: 'op'; readonly op: string; readonly start: number; readonly end: number; readonly line: number; readonly fd?: number; readonly varFd?: string; readonly text?: string }
  | { readonly kind: 'newline'; readonly start: number; readonly end: number; readonly line: number }
  | { readonly kind: 'eof'; readonly start: number; readonly end: number; readonly line: number };

const OPERATORS = ['&&', '||', ';;&', ';;', ';&', '|&', '&>>', '&>', '<<<', '<<-', '<<', '>>', '>|', '<>', '<&', '>&', '<', '>', '|', '&', ';', '(', ')'];
const META = new Set([' ', '\t', '\n', ';', '&', '|', '<', '>', '(', ')']);
const EXTGLOB = new Set(['@', '!', '*', '+', '?']);
const ASSIGN_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/;

interface PendingDoc {
  readonly delim: string;
  readonly strip: boolean;
  readonly doc: HereDoc;
}

/** Index after the closing quote of a '…' string starting at i (i = after the opening quote). */
export function skipSingle(src: string, i: number): number {
  const end = src.indexOf("'", i);
  if (end < 0) throw new IncompleteInput("'");
  return end + 1;
}

/** $'…' allows \' inside. */
function skipAnsi(src: string, i: number): number {
  for (let j = i; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === "'") return j + 1;
  }
  throw new IncompleteInput("$'");
}

export function skipDouble(src: string, i: number): number {
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === '"') return j + 1;
    // $'…' and $"…" are not special inside double quotes
    else if (c === '$' && src[j + 1] !== "'" && src[j + 1] !== '"') j = skipDollar(src, j) - 1;
    else if (c === '`') j = skipBacktick(src, j + 1) - 1;
  }
  throw new IncompleteInput('"');
}

export function skipBacktick(src: string, i: number): number {
  for (let j = i; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '`') return j + 1;
  }
  throw new IncompleteInput('`');
}

/** i is right after an opening parenthesis; returns the index after the matching one. */
export function skipParen(src: string, i: number): number {
  let depth = 1;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === "'") j = skipSingle(src, j + 1) - 1;
    else if (c === '"') j = skipDouble(src, j + 1) - 1;
    else if (c === '`') j = skipBacktick(src, j + 1) - 1;
    else if (c === '$') j = skipDollar(src, j) - 1;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j + 1;
  }
  throw new IncompleteInput(')');
}

/** i is right after `${`; returns the index after the matching `}`. */
function skipBrace(src: string, i: number): number {
  let depth = 1;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === "'") j = skipSingle(src, j + 1) - 1;
    else if (c === '"') j = skipDouble(src, j + 1) - 1;
    else if (c === '`') j = skipBacktick(src, j + 1) - 1;
    else if (c === '$' && src[j + 1] !== '{') j = skipDollar(src, j) - 1;
    else if (c === '$' || c === '{') { depth++; if (c === '$') j++; }
    else if (c === '}' && --depth === 0) return j + 1;
  }
  throw new IncompleteInput('}');
}

/** i points at `$`; returns the index after the expansion it starts. */
export function skipDollar(src: string, i: number): number {
  const n = src[i + 1];
  if (n === '(') return skipParen(src, i + 2);
  if (n === '{') return skipBrace(src, i + 2);
  if (n === "'") return skipAnsi(src, i + 2);
  if (n === '"') return skipDouble(src, i + 2);
  return i + 1;
}

/** Index after `((…))` (i after the two opening parentheses) or -1 if not arithmetic. */
function skipArith(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "'") j = skipSingle(src, j + 1) - 1;
    else if (c === '"') j = skipDouble(src, j + 1) - 1;
    else if (c === '$') j = skipDollar(src, j) - 1;
    else if (c === '(') depth++;
    else if (c === ')') {
      if (depth > 0) depth--;
      else return src[j + 1] === ')' ? j + 2 : -1;
    } else if (c === '\n' && depth === 0 && src.slice(i, j).includes(';;')) return -1;
  }
  throw new IncompleteInput('))');
}

/** Removes quotes from a here-document delimiter; reports whether it was quoted. */
export function heredocDelimiter(raw: string): { delim: string; quoted: boolean } {
  const quoted = /['"\\]/.test(raw);
  return { delim: raw.replace(/\\(.)/g, '$1').replace(/['"]/g, ''), quoted };
}

export class Lexer {
  readonly src: string;
  private pos = 0;
  private line = 1;
  private readonly buffer: Token[] = [];
  private readonly pending: PendingDoc[] = [];
  /** Interactive input: an unterminated here-document asks for more lines. */
  private readonly interactive: boolean;

  constructor(src: string, interactive = false) {
    this.src = src;
    this.interactive = interactive;
  }

  peek(n = 0): Token {
    while (this.buffer.length <= n) this.buffer.push(this.read());
    return this.buffer[n] as Token;
  }

  next(): Token {
    return this.buffer.length ? (this.buffer.shift() as Token) : this.read();
  }

  /** Current position (only meaningful when nothing is buffered). */
  offset(): number {
    return this.buffer[0]?.start ?? this.pos;
  }

  addHereDoc(delimRaw: string, strip: boolean, doc: HereDoc): void {
    this.pending.push({ delim: heredocDelimiter(delimRaw).delim, strip, doc });
  }

  /** Right-hand side of `=~`: a word where ( ) | are literal. */
  regexWord(): string {
    if (this.buffer.length) throw new Error('regexWord with lookahead');
    this.skipBlanks();
    const start = this.pos;
    let depth = 0;
    let j = this.pos;
    for (; j < this.src.length; j++) {
      const c = this.src[j] ?? '';
      if (c === '\\') j++;
      else if (c === "'") j = skipSingle(this.src, j + 1) - 1;
      else if (c === '"') j = skipDouble(this.src, j + 1) - 1;
      else if (c === '$') j = skipDollar(this.src, j) - 1;
      else if (c === '(') depth++;
      else if (c === ')' && depth > 0) depth--;
      else if (depth === 0 && (c === ' ' || c === '\t' || c === '\n')) break;
    }
    this.pos = j;
    return this.src.slice(start, j);
  }

  private skipBlanks(): void {
    for (;;) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t') this.pos++;
      else if (c === '\\' && this.src[this.pos + 1] === '\n') { this.pos += 2; this.line++; }
      else if (c === '\\' && this.pos + 1 === this.src.length) throw new IncompleteInput('\\');
      else if (c === '#') { while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.pos++; }
      else return;
    }
  }

  private read(): Token {
    this.skipBlanks();
    const start = this.pos;
    const line = this.line;
    if (this.pos >= this.src.length) return this.endOfInput(start, line);
    const c = this.src[this.pos] ?? '';
    if (c === '\n') {
      this.pos++;
      this.line++;
      this.readHereDocs();
      return { kind: 'newline', start, end: start + 1, line };
    }
    if (c === '(' && this.src[this.pos + 1] === '(') {
      const end = skipArith(this.src, this.pos + 2);
      if (end > 0) {
        this.pos = end;
        return { kind: 'op', op: '((', start, end, line, text: this.src.slice(start + 2, end - 2) };
      }
    }
    const io = this.ioPrefix();
    if (io) return io;
    if ((c === '<' || c === '>') && this.src[this.pos + 1] === '(') return this.word(start, line);
    const op = OPERATORS.find((o) => this.src.startsWith(o, this.pos));
    if (op) {
      this.pos += op.length;
      return { kind: 'op', op, start, end: this.pos, line };
    }
    return this.word(start, line);
  }

  private endOfInput(start: number, line: number): Token {
    if (this.pending.length) this.readHereDocs();
    return { kind: 'eof', start, end: start, line };
  }

  /** `2>`, `10<&`, `{fd}>`: a descriptor glued to a redirection operator. */
  private ioPrefix(): Token | null {
    const m = /^(\d+|\{[A-Za-z_][A-Za-z0-9_]*\})(?=[<>])/.exec(this.src.slice(this.pos, this.pos + 40));
    if (!m) return null;
    const after = this.pos + m[0].length;
    const op = OPERATORS.find((o) => /^[<>&]/.test(o) && !o.startsWith('&') && this.src.startsWith(o, after));
    if (!op || (this.src[after + op.length] === '(' && op.length === 1)) return null;
    const start = this.pos;
    this.pos = after + op.length;
    const tag = m[1] ?? '';
    const end = this.pos;
    return tag.startsWith('{') ? { kind: 'op', op, start, end, line: this.line, varFd: tag.slice(1, -1) } : { kind: 'op', op, start, end, line: this.line, fd: Number(tag) };
  }

  private word(start: number, line: number): Token {
    let j = this.pos;
    while (j < this.src.length) {
      const c = this.src[j] ?? '';
      if (c === '\\') {
        if (j + 1 >= this.src.length) throw new IncompleteInput('\\');
        if (this.src[j + 1] === '\n') this.line++;
        j += 2;
      } else if (c === "'") j = skipSingle(this.src, j + 1);
      else if (c === '"') j = this.countLines(j, skipDouble(this.src, j + 1));
      else if (c === '`') j = this.countLines(j, skipBacktick(this.src, j + 1));
      else if (c === '$') j = this.countLines(j, Math.max(j + 1, skipDollar(this.src, j)));
      else if ((c === '<' || c === '>') && this.src[j + 1] === '(' && j === start) j = this.countLines(j, skipParen(this.src, j + 2));
      else if (EXTGLOB.has(c) && this.src[j + 1] === '(') j = this.countLines(j, skipParen(this.src, j + 2));
      else if (c === '(' && ASSIGN_PREFIX.test(this.src.slice(start, j))) j = this.countLines(j, skipParen(this.src, j + 1));
      else if (META.has(c)) break;
      else j++;
    }
    this.pos = Math.min(j, this.src.length);
    return { kind: 'word', raw: this.src.slice(start, this.pos), start, end: this.pos, line };
  }

  private countLines(from: number, to: number): number {
    for (let k = from; k < to; k++) if (this.src[k] === '\n') this.line++;
    return to;
  }

  private readHereDocs(): void {
    while (this.pending.length) {
      const p = this.pending.shift() as PendingDoc;
      const lines: string[] = [];
      let found = false;
      while (this.pos < this.src.length) {
        const nl = this.src.indexOf('\n', this.pos);
        const end = nl < 0 ? this.src.length : nl;
        let text = this.src.slice(this.pos, end);
        this.pos = nl < 0 ? this.src.length : nl + 1;
        this.line++;
        if (p.strip) text = text.replace(/^\t+/, '');
        if (text === p.delim) {
          found = true;
          break;
        }
        lines.push(text);
      }
      if (!found && this.interactive) throw new IncompleteInput('here-document');
      p.doc.body = lines.length ? `${lines.join('\n')}\n` : '';
    }
  }
}
