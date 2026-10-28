/** Compound commands: ( ) { } if while until for select case (( )) [[ ]] and function definitions. */
import type { CaseItem, Command, Compound, CondExpr, FunctionDef, Word } from './ast.ts';
import type { Parser } from './parser.ts';
import { BashSyntaxError } from './lexer.ts';
import type { Token } from './lexer.ts';

export const COMPOUND_STARTS: ReadonlySet<string> = new Set(['{', 'if', 'while', 'until', 'for', 'select', 'case', 'function', '[[', 'coproc']);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COND_UNARY = new Set(['-a', '-b', '-c', '-d', '-e', '-f', '-g', '-h', '-k', '-p', '-r', '-s', '-t', '-u', '-w', '-x', '-O', '-G', '-L', '-S', '-N', '-o', '-v', '-R', '-z', '-n']);
const COND_BINARY = new Set(['==', '=', '!=', '=~', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-ef', '-nt', '-ot']);

const word = (t: Token, text?: string): boolean => t.kind === 'word' && (text === undefined || t.raw === text);
const op = (t: Token, o?: string): boolean => t.kind === 'op' && (o === undefined || t.op === o);

export function parseCompound(p: Parser): Command {
  const t = p.peek();
  if (op(t, '((')) return withRedirs(p, arith(p));
  if (op(t, '(')) return withRedirs(p, subshell(p));
  if (t.kind !== 'word') return p.fail(t);
  switch (t.raw) {
    case '{': return withRedirs(p, group(p));
    case 'if': return withRedirs(p, ifClause(p));
    case 'while': case 'until': return withRedirs(p, whileClause(p));
    case 'for': return withRedirs(p, forClause(p));
    case 'select': return withRedirs(p, forClause(p));
    case 'case': return withRedirs(p, caseClause(p));
    case '[[': return withRedirs(p, condCommand(p));
    case 'coproc': p.next(); return p.parseCommand();
    default: return functionDef(p);
  }
}

function withRedirs<T extends Compound>(p: Parser, c: T): T {
  const redirs = p.parseRedirects();
  return redirs.length ? { ...c, redirs: [...c.redirs, ...redirs] } : c;
}

function arith(p: Parser): Compound {
  const t = p.next();
  return { kind: 'arith', expr: t.kind === 'op' ? t.text ?? '' : '', line: t.line, redirs: [] };
}

function subshell(p: Parser): Compound {
  p.next();
  const body = p.parseList([]);
  p.expectOp(')');
  if (!body.items.length) throw new BashSyntaxError(')');
  return { kind: 'subshell', body, redirs: [] };
}

function group(p: Parser): Compound {
  p.next();
  const body = p.parseList(['}']);
  p.expectWord('}');
  if (!body.items.length) throw new BashSyntaxError('}');
  return { kind: 'group', body, redirs: [] };
}

/** A non-empty compound list closed by one of `stops`. */
function block(p: Parser, stops: readonly string[]): Command {
  const list = p.parseList(stops);
  const t = p.peek();
  if (!list.items.length) p.fail(t);
  return list;
}

function ifClause(p: Parser): Compound {
  p.next();
  const clauses: { cond: Command; body: Command }[] = [];
  let elseBody: Command | undefined;
  for (;;) {
    const cond = block(p, ['then']);
    p.expectWord('then');
    clauses.push({ cond, body: block(p, ['elif', 'else', 'fi']) });
    const t = p.next();
    if (word(t, 'elif')) continue;
    if (word(t, 'else')) {
      elseBody = block(p, ['fi']);
      p.expectWord('fi');
    } else if (!word(t, 'fi')) p.fail(t);
    return { kind: 'if', clauses, elseBody, redirs: [] };
  }
}

function doGroup(p: Parser): Command {
  p.skipNewlines();
  if (word(p.peek(), '{')) {
    p.next();
    const body = block(p, ['}']);
    p.expectWord('}');
    return body;
  }
  p.expectWord('do');
  const body = block(p, ['done']);
  p.expectWord('done');
  return body;
}

function whileClause(p: Parser): Compound {
  const until = (p.next() as { raw: string }).raw === 'until';
  const cond = block(p, ['do']);
  return { kind: 'while', until, cond, body: doGroup(p), redirs: [] };
}

function forClause(p: Parser): Compound {
  const kw = p.next();
  const isSelect = word(kw, 'select');
  const next = p.peek();
  if (!isSelect && op(next, '((')) {
    const parts = (p.next() as { text?: string }).text?.split(';') ?? [];
    if (parts.length !== 3) throw new BashSyntaxError('((');
    if (op(p.peek(), ';')) p.next();
    return { kind: 'arith_for', init: parts[0] ?? '', cond: parts[1] ?? '', step: parts[2] ?? '', body: doGroup(p), redirs: [] };
  }
  if (!word(next) || !NAME.test((next as { raw: string }).raw)) p.fail(next);
  const name = (p.next() as { raw: string }).raw;
  let words: Word[] | undefined;
  if (op(p.peek(), ';')) p.next();
  p.skipNewlines();
  if (word(p.peek(), 'in')) {
    p.next();
    words = [];
    while (word(p.peek())) words.push({ raw: (p.next() as { raw: string }).raw });
    const sep = p.peek();
    if (op(sep, ';') || sep.kind === 'newline') p.next();
    else p.fail(sep);
  }
  const body = doGroup(p);
  return isSelect ? { kind: 'select', name, words, body, redirs: [] } : { kind: 'for', name, words, body, redirs: [] };
}

function caseClause(p: Parser): Compound {
  p.next();
  const subject = p.peek();
  if (!word(subject)) p.fail(subject);
  p.next();
  p.skipNewlines();
  p.expectWord('in');
  p.skipNewlines();
  const items: CaseItem[] = [];
  while (!word(p.peek(), 'esac')) items.push(caseItem(p));
  p.next();
  return { kind: 'case', word: { raw: (subject as { raw: string }).raw }, items, redirs: [] };
}

function caseItem(p: Parser): CaseItem {
  if (op(p.peek(), '(')) p.next();
  const patterns: Word[] = [];
  for (;;) {
    const t = p.next();
    if (!word(t)) p.fail(t);
    patterns.push({ raw: (t as { raw: string }).raw });
    const sep = p.next();
    if (op(sep, ')')) break;
    if (!op(sep, '|')) p.fail(sep);
  }
  const list = p.parseList(['esac']);
  const t = p.peek();
  let term: CaseItem['term'] = ';;';
  if (op(t, ';;') || op(t, ';&') || op(t, ';;&')) {
    term = (p.next() as { op: CaseItem['term'] }).op;
    p.skipNewlines();
  } else if (!word(t, 'esac')) p.fail(t);
  return { patterns, body: list.items.length ? list : undefined, term };
}

function functionDef(p: Parser): FunctionDef {
  const start = p.peek().start;
  let t = p.next();
  if (word(t, 'function')) {
    t = p.next();
    if (!word(t)) p.fail(t);
    if (op(p.peek(), '(')) {
      p.next();
      p.expectOp(')');
    }
  } else {
    p.expectOp('(');
    p.expectOp(')');
  }
  const name = (t as { raw: string }).raw;
  p.skipNewlines();
  const body = parseCompound(p);
  if (body.kind === 'function' || !('redirs' in body)) throw new BashSyntaxError(name);
  return { kind: 'function', name, body: body as Compound, source: p.src.slice(start, p.lastEnd) };
}

// ------------------------------------------------------------ [[ ]]

function condCommand(p: Parser): Compound {
  const line = p.next().line;
  const expr = condOr(p);
  p.skipNewlines();
  const end = p.peek();
  if (!word(end, ']]')) p.fail(end);
  p.next();
  return { kind: 'cond', expr, line, redirs: [] };
}

function condOr(p: Parser): CondExpr {
  let left = condAnd(p);
  while (op(p.peek(), '||')) {
    p.next();
    p.skipNewlines();
    left = { kind: 'or', left, right: condAnd(p) };
  }
  return left;
}

function condAnd(p: Parser): CondExpr {
  let left = condNot(p);
  while (op(p.peek(), '&&')) {
    p.next();
    p.skipNewlines();
    left = { kind: 'and', left, right: condNot(p) };
  }
  return left;
}

function condNot(p: Parser): CondExpr {
  p.skipNewlines();
  if (word(p.peek(), '!')) {
    p.next();
    p.skipNewlines();
    const group = op(p.peek(), '(');
    return { kind: 'not', expr: condNot(p), ...(group ? { group } : {}) };
  }
  return condPrimary(p);
}

function condWord(p: Parser): Word {
  const t = p.next();
  if (!word(t) || word(t, ']]')) p.fail(t);
  return { raw: (t as { raw: string }).raw };
}

function condPrimary(p: Parser): CondExpr {
  const t = p.peek();
  if (op(t, '(')) {
    p.next();
    const e = condOr(p);
    p.skipNewlines();
    p.expectOp(')');
    return e;
  }
  if (word(t) && COND_UNARY.has((t as { raw: string }).raw) && word(p.peek(1)) && !word(p.peek(1), ']]')) {
    p.next();
    return { kind: 'unary', op: (t as { raw: string }).raw, arg: condWord(p) };
  }
  const left = condWord(p);
  const o = p.peek();
  const binop = word(o) && COND_BINARY.has((o as { raw: string }).raw) ? (o as { raw: string }).raw : op(o, '<') || op(o, '>') ? (o as { op: string }).op : undefined;
  if (!binop) return { kind: 'word', arg: left };
  p.next();
  if (binop === '=~') return { kind: 'binary', op: binop, left, right: { raw: p.lex.regexWord() } };
  return { kind: 'binary', op: binop, left, right: condWord(p) };
}
