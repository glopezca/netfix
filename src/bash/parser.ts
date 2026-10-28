/** Recursive-descent parser for bash: lists, pipelines, simple commands and redirections. */
import type { ArrayElement, Assignment, Command, List, ListItem, Pipeline, Redirect, RedirOp, SimpleCommand, Word } from './ast.ts';
import { Lexer, BashSyntaxError, IncompleteInput, skipDollar, skipDouble, skipSingle } from './lexer.ts';
import type { Token } from './lexer.ts';
import { parseCompound, COMPOUND_STARTS } from './parser-compound.ts';

export { BashSyntaxError, IncompleteInput };

const REDIR_OPS = new Set(['<', '>', '>>', '>|', '<>', '<<', '<<-', '<<<', '<&', '>&', '&>', '&>>']);
const LIST_END_OPS = new Set([')', ';;', ';&', ';;&']);
/** Reserved words that may not start a command. */
const MISPLACED = new Set(['then', 'else', 'elif', 'fi', 'do', 'done', 'esac', '}', 'in', ']]']);
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(\+)?=/s;
const DECLARATION = new Set(['declare', 'typeset', 'local', 'readonly', 'export']);

export function isWord(t: Token, text?: string): t is Extract<Token, { kind: 'word' }> {
  return t.kind === 'word' && (text === undefined || t.raw === text);
}

export function isOp(t: Token, op?: string): t is Extract<Token, { kind: 'op' }> {
  return t.kind === 'op' && (op === undefined || t.op === op);
}

function atListEnd(t: Token, stops: readonly string[]): boolean {
  return t.kind === 'eof' || (t.kind === 'word' && stops.includes(t.raw)) || (t.kind === 'op' && LIST_END_OPS.has(t.op));
}

function tokenText(t: Token): string {
  if (t.kind === 'word') return t.raw;
  if (t.kind === 'op') return t.op === '((' ? '((' : t.op;
  return t.kind === 'newline' ? 'newline' : 'end of file';
}

export class Parser {
  readonly lex: Lexer;
  readonly src: string;
  lastEnd = 0;

  constructor(src: string, interactive = false) {
    this.src = src;
    this.lex = new Lexer(src, interactive);
  }

  peek(n = 0): Token {
    return this.lex.peek(n);
  }

  next(): Token {
    const t = this.lex.next();
    if (t.kind !== 'eof') this.lastEnd = t.end;
    return t;
  }

  /** Unexpected token: incomplete at end of input, syntax error otherwise. */
  fail(t: Token): never {
    if (t.kind === 'eof') throw new IncompleteInput('end of file');
    throw new BashSyntaxError(tokenText(t), undefined, t.line);
  }

  expectWord(text: string): void {
    const t = this.peek();
    if (!isWord(t, text)) this.fail(t);
    this.next();
  }

  expectOp(op: string): void {
    const t = this.peek();
    if (!isOp(t, op)) this.fail(t);
    this.next();
  }

  skipNewlines(): void {
    while (this.peek().kind === 'newline') this.next();
  }

  /** Whole program: a list up to end of input. */
  parseProgram(): List {
    const list = this.parseList([]);
    const t = this.peek();
    if (t.kind !== 'eof') throw new BashSyntaxError(tokenText(t), undefined, t.line);
    return list;
  }

  /** Next complete command line (bash reads scripts this way); null at end of input. */
  parseLine(): List | null {
    this.skipNewlines();
    if (this.peek().kind === 'eof') return null;
    const items: ListItem[] = [];
    for (;;) {
      const start = this.peek().start;
      const cmd = this.parseAndOr();
      const source = this.src.slice(start, this.lastEnd);
      const sep = this.peek();
      const async = isOp(sep, '&');
      if (isOp(sep, ';') || async) this.next();
      else if (sep.kind !== 'newline' && sep.kind !== 'eof') throw new BashSyntaxError(tokenText(sep), undefined, sep.line);
      items.push({ cmd, async, source });
      const after = this.peek();
      if (after.kind === 'newline') { this.next(); break; }
      if (after.kind === 'eof') break;
    }
    return { kind: 'list', items };
  }

  /** Commands separated by ; & or newlines, until one of `stops` (reserved words) or a closing operator. */
  parseList(stops: readonly string[]): List {
    const items: ListItem[] = [];
    this.skipNewlines();
    for (;;) {
      const t = this.peek();
      if (atListEnd(t, stops)) break;
      const start = t.start;
      const cmd = this.parseAndOr();
      const source = this.src.slice(start, this.lastEnd);
      const sep = this.peek();
      let async = false;
      if (isOp(sep, ';') || isOp(sep, '&')) {
        async = sep.op === '&';
        this.next();
      } else if (sep.kind === 'newline') this.next();
      else if (!atListEnd(sep, stops)) this.fail(sep);
      items.push({ cmd, async, source });
      this.skipNewlines();
    }
    return { kind: 'list', items };
  }

  parseAndOr(): Command {
    const first = this.parsePipeline();
    const rest: { op: '&&' | '||'; cmd: Command }[] = [];
    for (;;) {
      const t = this.peek();
      if (!isOp(t, '&&') && !isOp(t, '||')) break;
      this.next();
      this.skipNewlines();
      rest.push({ op: t.op as '&&' | '||', cmd: this.parsePipeline() });
    }
    return rest.length ? { kind: 'and_or', first, rest } : first;
  }

  parsePipeline(): Command {
    let timed = false;
    let negate = false;
    if (isWord(this.peek(), 'time')) {
      this.next();
      timed = true;
      if (isWord(this.peek(), '-p')) this.next();
    }
    while (isWord(this.peek(), '!')) {
      this.next();
      negate = !negate;
    }
    const cmds = [this.parseCommand()];
    const stderrToPipe: boolean[] = [];
    for (;;) {
      const t = this.peek();
      if (!isOp(t, '|') && !isOp(t, '|&')) break;
      this.next();
      stderrToPipe.push(t.op === '|&');
      this.skipNewlines();
      cmds.push(this.parseCommand());
    }
    if (cmds.length === 1 && !negate && !timed) return cmds[0] as Command;
    const p: Pipeline = { kind: 'pipeline', cmds, stderrToPipe, negate, timed };
    return p;
  }

  parseCommand(): Command {
    const t = this.peek();
    if (isOp(t, '((') || isOp(t, '(') || (isWord(t) && COMPOUND_STARTS.has(t.raw))) return parseCompound(this);
    if (isWord(t) && MISPLACED.has(t.raw)) this.fail(t);
    if (isWord(t) && isOp(this.peek(1), '(') && isOp(this.peek(2), ')')) return parseCompound(this);
    return this.parseSimple();
  }

  isRedirect(t: Token): boolean {
    return isOp(t) && REDIR_OPS.has(t.op);
  }

  parseRedirects(): Redirect[] {
    const out: Redirect[] = [];
    while (this.isRedirect(this.peek())) out.push(this.parseRedirect());
    return out;
  }

  parseRedirect(): Redirect {
    const t = this.next();
    if (!isOp(t)) this.fail(t);
    const target = this.peek();
    if (!isWord(target)) this.fail(target);
    this.next();
    const op = t.op as RedirOp;
    const base = { fd: t.fd, varFd: t.varFd, op, target: { raw: target.raw } };
    if (op !== '<<' && op !== '<<-') return base;
    const heredoc = { body: '', quoted: /['"\\]/.test(target.raw) };
    this.lex.addHereDoc(target.raw, op === '<<-', heredoc);
    return { ...base, heredoc };
  }

  private parseSimple(): SimpleCommand {
    const first = this.peek();
    const line = first.line;
    let wordAt = -1;
    const assigns: Assignment[] = [];
    const words: Word[] = [];
    const redirs: Redirect[] = [];
    for (;;) {
      const t = this.peek();
      if (this.isRedirect(t)) redirs.push(this.parseRedirect());
      else if (isWord(t)) {
        this.next();
        const assign = ASSIGNMENT.test(t.raw) ? parseAssignment(t.raw) : undefined;
        if (assign && words.length === 0) assigns.push(assign);
        else if (words.length === 0) { wordAt = t.start - first.start; words.push({ raw: t.raw }); }
        else words.push(assign && DECLARATION.has(words[0]?.raw ?? '') ? { raw: t.raw, assign } as Word : { raw: t.raw });
      } else break;
    }
    if (!assigns.length && !words.length && !redirs.length) this.fail(this.peek());
    return { kind: 'simple', assigns, words, redirs, line, source: this.src.slice(first.start, this.lastEnd), wordAt };
  }
}

/** `name=value`, `name[i]=value`, `name+=value`, `name=(a b [k]=v)`. */
export function parseAssignment(raw: string): Assignment | undefined {
  const m = ASSIGNMENT.exec(raw);
  if (!m) return undefined;
  const value = raw.slice(m[0].length);
  const base = { name: m[1] ?? '', index: m[2], append: m[3] === '+' };
  if (value.startsWith('(') && value.endsWith(')') && m[2] === undefined) return { ...base, array: parseArrayElements(value.slice(1, -1)) };
  return { ...base, value: { raw: value } };
}

/** Index of the `]` closing the subscript that opens at `i` (quotes, $(…) and nested [ ] skipped), or -1. */
function subscriptEnd(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === "'") j = skipSingle(src, j + 1) - 1;
    else if (c === '"') j = skipDouble(src, j + 1) - 1;
    else if (c === '$') j = skipDollar(src, j) - 1;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return j;
  }
  return -1;
}

/**
 * The elements of `name=(…)`. As in bash, a `[subscript]=` keeps its blanks (`([a b]=1)`, `([1 + 1]=two)`): it ends at
 * the matching `]`, not at the first blank.
 */
function parseArrayElements(inner: string): ArrayElement[] {
  const out: ArrayElement[] = [];
  let offset = 0;
  for (;;) {
    const t = new Lexer(inner.slice(offset)).next();
    if (t.kind === 'eof') return out;
    if (t.kind === 'newline') { offset += t.end; continue; }
    if (t.kind !== 'word') throw new BashSyntaxError(tokenText(t));
    const close = t.raw.startsWith('[') ? subscriptEnd(inner, offset + t.start) : -1;
    if (close >= 0 && inner[close + 1] === '=') {
      const v = new Lexer(inner.slice(close + 2)).next();
      const value = v.kind === 'word' && v.start === 0 ? v.raw : '';
      out.push({ key: inner.slice(offset + t.start + 1, close), value: { raw: value } });
      offset = close + 2 + value.length;
      continue;
    }
    const m = /^\[([^\]]*)\]=(.*)$/s.exec(t.raw);
    out.push(m ? { key: m[1], value: { raw: m[2] ?? '' } } : { value: { raw: t.raw } });
    offset += t.end;
  }
}

/** Parses a complete program (scripts, -c strings, eval, functions). */
export function parse(src: string, interactive = false): List {
  return new Parser(src, interactive).parseProgram();
}
