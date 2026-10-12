/** awk lexer and parser (POSIX awk as implemented by mawk 1.3.4, Ubuntu's default awk). */

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 're'; v: string }
  | { t: 'var'; name: string }
  | { t: 'field'; e: Expr }
  | { t: 'idx'; name: string; keys: Expr[] }
  | { t: 'assign'; op: string; target: Expr; e: Expr }
  | { t: 'cond'; c: Expr; a: Expr; b: Expr }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'un'; op: string; e: Expr }
  | { t: 'incdec'; op: string; prefix: boolean; target: Expr }
  | { t: 'in'; keys: Expr[]; arr: string }
  | { t: 'match'; neg: boolean; l: Expr; r: Expr }
  | { t: 'call'; name: string; args: Expr[] }
  | { t: 'getline'; target?: Expr; file?: Expr; cmd?: Expr }
  | { t: 'group'; e: Expr };

export type Stmt =
  | { t: 'expr'; e: Expr }
  | { t: 'print'; args: Expr[]; printf: boolean; dest?: { op: string; e: Expr } }
  | { t: 'if'; c: Expr; a: Stmt; b?: Stmt }
  | { t: 'while'; c: Expr; body: Stmt; doWhile: boolean }
  | { t: 'for'; init?: Stmt; c?: Expr; step?: Stmt; body: Stmt }
  | { t: 'forin'; v: string; arr: string; body: Stmt }
  | { t: 'block'; body: Stmt[] }
  | { t: 'simple'; op: 'next' | 'nextfile' | 'break' | 'continue' }
  | { t: 'exit' | 'return'; e?: Expr }
  | { t: 'delete'; name: string; keys?: Expr[] };

export interface Rule {
  readonly pattern?: Expr | 'BEGIN' | 'END';
  readonly pattern2?: Expr;
  readonly action?: Stmt;
}

export interface Program {
  readonly rules: Rule[];
  readonly funcs: Map<string, { params: string[]; body: Stmt }>;
}

export class AwkError extends Error {}

interface Tok {
  readonly k: 'num' | 'str' | 're' | 'name' | 'func' | 'builtin' | 'kw' | 'op' | 'nl' | 'eof';
  readonly v: string;
}

const KEYWORDS = new Set(['BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'nextfile', 'exit', 'return', 'delete', 'in', 'getline', 'print', 'printf']);
export const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'tolower', 'toupper', 'int', 'sqrt', 'exp', 'log', 'sin', 'cos', 'atan2', 'rand', 'srand', 'system', 'close', 'fflush']);
const OPS = ['+=', '-=', '*=', '/=', '%=', '^=', '**=', '==', '<=', '>=', '!=', '++', '--', '&&', '||', '>>', '!~', '**', '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '>', '<', '|', '?', ':', '~', '$', '='];
const ESC: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/', a: '\x07', b: '\b', f: '\f', v: '\v' };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const regexOk = (): boolean => {
    const last = toks[toks.length - 1];
    return !last || last.k === 'nl' || (last.k === 'op' && !/^[)\]$]$|^\+\+$|^--$/.test(last.v)) || (last.k === 'kw' && last.v !== 'getline');
  };
  while (i < src.length) {
    const c = src[i] ?? '';
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '\n') { toks.push({ k: 'nl', v: '\n' }); i++; continue; }
    if (c === '"') {
      let s = '';
      for (i++; i < src.length && src[i] !== '"'; i++) {
        if (src[i] === '\\') { const n = src[++i] ?? ''; s += /[0-7]/.test(n) ? String.fromCharCode(parseInt(/^[0-7]{1,3}/.exec(src.slice(i))?.[0] ?? '0', 8)) : ESC[n] ?? `\\${n}`; if (/[0-7]/.test(n)) i += (/^[0-7]{1,3}/.exec(src.slice(i))?.[0].length ?? 1) - 1; }
        else s += src[i];
      }
      if (i >= src.length) throw new AwkError('runaway string constant "' + s.slice(0, 10) + ' ...');
      i++;
      toks.push({ k: 'str', v: s });
      continue;
    }
    if (c === '/' && regexOk()) {
      let s = '';
      for (i++; i < src.length && src[i] !== '/'; i++) {
        if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i++; } else if (src[i] === '\n') throw new AwkError('runaway regular expression /' + s.slice(0, 10) + ' ...'); else s += src[i];
      }
      i++;
      toks.push({ k: 're', v: s });
      continue;
    }
    const num = /^(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|0[xX][0-9a-fA-F]+)/.exec(src.slice(i));
    if (num) { toks.push({ k: 'num', v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      const w = id[0];
      i += w.length;
      toks.push({ k: KEYWORDS.has(w) ? 'kw' : BUILTINS.has(w) ? 'builtin' : src[i] === '(' ? 'func' : 'name', v: w });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new AwkError(`syntax error at or near ${c}`);
    toks.push({ k: 'op', v: op });
    i += op.length;
  }
  toks.push({ k: 'eof', v: '' });
  return toks;
}

export class AwkParser {
  private toks: Tok[];
  private i = 0;
  private noIn = 0;
  private noGt = 0;

  constructor(src: string) {
    this.toks = lex(src);
  }

  private get t(): Tok { return this.toks[this.i] as Tok; }
  private is(k: Tok['k'], v?: string): boolean { return this.t.k === k && (v === undefined || this.t.v === v); }
  private eat(k: Tok['k'], v?: string): boolean { if (this.is(k, v)) { this.i++; return true; } return false; }
  private expect(k: Tok['k'], v?: string): Tok {
    if (!this.is(k, v)) throw new AwkError(`syntax error at or near ${this.t.v === '\n' ? 'end of line' : this.t.v || 'end of file'}`);
    return this.toks[this.i++] as Tok;
  }
  private nls(): void { while (this.is('nl')) this.i++; }
  private terms(): void { while (this.is('nl') || this.is('op', ';')) this.i++; }

  parse(): Program {
    const rules: Rule[] = [];
    const funcs = new Map<string, { params: string[]; body: Stmt }>();
    this.terms();
    while (!this.is('eof')) {
      if (this.is('kw', 'function') || this.is('kw', 'func')) {
        this.i++;
        const name = this.toks[this.i++]?.v ?? '';
        this.expect('op', '(');
        const params: string[] = [];
        while (!this.eat('op', ')')) { params.push(this.expect('name').v); this.eat('op', ','); this.nls(); }
        this.nls();
        funcs.set(name, { params, body: this.block() });
      } else rules.push(this.rule());
      this.terms();
    }
    return { rules, funcs };
  }

  private rule(): Rule {
    if (this.eat('kw', 'BEGIN')) { this.nls(); return { pattern: 'BEGIN', action: this.block() }; }
    if (this.eat('kw', 'END')) { this.nls(); return { pattern: 'END', action: this.block() }; }
    let pattern: Expr | undefined;
    let pattern2: Expr | undefined;
    if (!this.is('op', '{')) {
      pattern = this.expr();
      if (this.eat('op', ',')) { this.nls(); pattern2 = this.expr(); }
    }
    return { pattern, pattern2, action: this.is('op', '{') ? this.block() : undefined };
  }

  private block(): Stmt {
    this.expect('op', '{');
    const body: Stmt[] = [];
    this.terms();
    while (!this.eat('op', '}')) { body.push(this.stmt()); this.terms(); }
    return { t: 'block', body };
  }

  private simpleEnd(): void {
    if (this.is('op', ';') || this.is('nl')) { this.i++; return; }
    if (!this.is('op', '}') && !this.is('eof')) throw new AwkError(`syntax error at or near ${this.t.v}`);
  }

  private stmt(): Stmt {
    if (this.is('op', '{')) return this.block();
    if (this.eat('kw', 'if')) {
      this.expect('op', '('); const c = this.expr(); this.expect('op', ')'); this.nls();
      const a = this.stmt();
      const save = this.i; this.terms();
      if (this.eat('kw', 'else')) { this.nls(); return { t: 'if', c, a, b: this.stmt() }; }
      this.i = save;
      return { t: 'if', c, a };
    }
    if (this.eat('kw', 'while')) { this.expect('op', '('); const c = this.expr(); this.expect('op', ')'); if (this.eat('op', ';')) return { t: 'while', c, body: { t: 'block', body: [] }, doWhile: false }; this.nls(); return { t: 'while', c, body: this.stmt(), doWhile: false }; }
    if (this.eat('kw', 'do')) { this.nls(); const body = this.stmt(); this.terms(); this.expect('kw', 'while'); this.expect('op', '('); const c = this.expr(); this.expect('op', ')'); this.simpleEnd(); return { t: 'while', c, body, doWhile: true }; }
    if (this.eat('kw', 'for')) return this.forStmt();
    if (this.is('kw', 'next') || this.is('kw', 'nextfile') || this.is('kw', 'break') || this.is('kw', 'continue')) { const op = this.toks[this.i++]?.v as 'next'; this.simpleEnd(); return { t: 'simple', op }; }
    if (this.is('kw', 'exit') || this.is('kw', 'return')) {
      const t = this.toks[this.i++]?.v as 'exit' | 'return';
      const e = this.is('op', ';') || this.is('nl') || this.is('op', '}') ? undefined : this.expr();
      this.simpleEnd();
      return { t, e };
    }
    if (this.eat('kw', 'delete')) {
      const name = this.expect('name').v;
      let keys: Expr[] | undefined;
      if (this.eat('op', '[')) { keys = this.exprList(); this.expect('op', ']'); }
      this.simpleEnd();
      return { t: 'delete', name, keys };
    }
    if (this.is('kw', 'print') || this.is('kw', 'printf')) return this.print();
    if (this.eat('op', ';')) return { t: 'block', body: [] };
    const e = this.expr();
    this.simpleEnd();
    return { t: 'expr', e };
  }

  private forStmt(): Stmt {
    this.expect('op', '(');
    if (this.is('name') && this.toks[this.i + 1]?.v === 'in' && this.toks[this.i + 3]?.v === ')') {
      const v = this.expect('name').v; this.i++; const arr = this.expect('name').v; this.expect('op', ')'); this.nls();
      return { t: 'forin', v, arr, body: this.stmt() };
    }
    const init = this.is('op', ';') ? undefined : ({ t: 'expr', e: this.expr() } as Stmt);
    this.expect('op', ';'); this.nls();
    const c = this.is('op', ';') ? undefined : this.expr();
    this.expect('op', ';'); this.nls();
    const step = this.is('op', ')') ? undefined : ({ t: 'expr', e: this.expr() } as Stmt);
    this.expect('op', ')');
    if (this.eat('op', ';')) return { t: 'for', init, c, step, body: { t: 'block', body: [] } };
    this.nls();
    return { t: 'for', init, c, step, body: this.stmt() };
  }

  private print(): Stmt {
    const printf = this.toks[this.i++]?.v === 'printf';
    let args: Expr[] = [];
    this.noGt++;
    if (this.is('op', '(')) {
      const save = this.i;
      this.i++;
      const list = this.exprList();
      if (this.eat('op', ')') && (this.is('op', ';') || this.is('nl') || this.is('op', '}') || this.is('op', '>') || this.is('op', '>>') || this.is('op', '|') || this.is('eof'))) args = list;
      else { this.i = save; args = this.exprList(); }
    } else if (!this.is('op', ';') && !this.is('nl') && !this.is('op', '}') && !this.is('op', '>') && !this.is('op', '|')) args = this.exprList();
    this.noGt--;
    let dest: { op: string; e: Expr } | undefined;
    if (this.is('op', '>') || this.is('op', '>>') || this.is('op', '|')) { const op = this.toks[this.i++]?.v ?? '>'; dest = { op, e: this.concat() }; }
    this.simpleEnd();
    return { t: 'print', args, printf, dest };
  }

  private exprList(): Expr[] {
    const list = [this.expr()];
    while (this.eat('op', ',')) { this.nls(); list.push(this.expr()); }
    return list;
  }

  expr(): Expr { return this.ternary(); }

  private ternary(): Expr {
    const c = this.or();
    if (this.eat('op', '?')) { this.nls(); const a = this.ternary(); this.nls(); this.expect('op', ':'); this.nls(); return { t: 'cond', c, a, b: this.ternary() }; }
    if (this.is('op') && /^(\+|-|\*|\/|%|\^|\*\*)?=$/.test(this.t.v) && (c.t === 'var' || c.t === 'field' || c.t === 'idx')) {
      const op = this.toks[this.i++]?.v ?? '=';
      this.nls();
      return { t: 'assign', op, target: c, e: this.ternary() };
    }
    return c;
  }

  private or(): Expr { let l = this.and(); while (this.eat('op', '||')) { this.nls(); l = { t: 'bin', op: '||', l, r: this.and() }; } return l; }
  private and(): Expr { let l = this.inExpr(); while (this.eat('op', '&&')) { this.nls(); l = { t: 'bin', op: '&&', l, r: this.inExpr() }; } return l; }

  private inExpr(): Expr {
    let l = this.matchExpr();
    while (!this.noIn && this.eat('kw', 'in')) l = { t: 'in', keys: [l], arr: this.expect('name').v };
    return l;
  }

  private matchExpr(): Expr {
    let l = this.compare();
    while (this.is('op', '~') || this.is('op', '!~')) { const neg = this.toks[this.i++]?.v === '!~'; l = { t: 'match', neg, l, r: this.compare() }; }
    return l;
  }

  private compare(): Expr {
    let l = this.concat();
    while (this.is('op', '|') && this.toks[this.i + 1]?.v === 'getline') {
      this.i += 2;
      const target = this.is('name') || this.is('op', '$') ? this.primary() : undefined;
      l = { t: 'getline', cmd: l, target };
    }
    const ops = this.noGt ? ['<', '<=', '!=', '==', '>='] : ['<', '<=', '!=', '==', '>', '>='];
    if (this.is('op') && ops.includes(this.t.v)) { const op = this.toks[this.i++]?.v ?? '=='; return { t: 'bin', op, l, r: this.concat() }; }
    return l;
  }

  private concat(): Expr {
    let l = this.additive();
    while (this.startsOperand()) l = { t: 'bin', op: ' ', l, r: this.additive() };
    return l;
  }

  private startsOperand(): boolean {
    const t = this.t;
    if (t.k === 'num' || t.k === 'str' || t.k === 'name' || t.k === 'func' || t.k === 'builtin' || t.k === 're') return true;
    return t.k === 'op' && ['$', '!', '(', '++', '--'].includes(t.v);
  }

  private additive(): Expr { let l = this.mul(); while (this.is('op', '+') || this.is('op', '-')) { const op = this.toks[this.i++]?.v ?? '+'; l = { t: 'bin', op, l, r: this.mul() }; } return l; }
  private mul(): Expr { let l = this.unary(); while (this.is('op', '*') || this.is('op', '/') || this.is('op', '%')) { const op = this.toks[this.i++]?.v ?? '*'; l = { t: 'bin', op, l, r: this.unary() }; } return l; }

  private unary(): Expr {
    if (this.is('op', '!')) { this.i++; return { t: 'un', op: '!', e: this.unary() }; }
    if (this.is('op', '-') || this.is('op', '+')) { const op = this.toks[this.i++]?.v ?? '-'; return { t: 'un', op, e: this.unary() }; }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (this.is('op', '^') || this.is('op', '**')) { this.i++; return { t: 'bin', op: '^', l: base, r: this.unaryPow() }; }
    return base;
  }

  private unaryPow(): Expr {
    if (this.is('op', '-') || this.is('op', '+') || this.is('op', '!')) { const op = this.toks[this.i++]?.v ?? '-'; return { t: 'un', op, e: this.unaryPow() }; }
    return this.power();
  }

  private postfix(): Expr {
    if (this.is('op', '++') || this.is('op', '--')) { const op = this.toks[this.i++]?.v ?? '++'; return { t: 'incdec', op, prefix: true, target: this.postfix() }; }
    const e = this.primary();
    if ((e.t === 'var' || e.t === 'field' || e.t === 'idx') && (this.is('op', '++') || this.is('op', '--'))) return { t: 'incdec', op: this.toks[this.i++]?.v ?? '++', prefix: false, target: e };
    return e;
  }

  private primary(): Expr {
    const t = this.t;
    if (t.k === 'num') { this.i++; return { t: 'num', v: Number(t.v) }; }
    if (t.k === 'str') { this.i++; return { t: 'str', v: t.v }; }
    if (t.k === 're') { this.i++; return { t: 're', v: t.v }; }
    if (this.eat('op', '$')) return { t: 'field', e: this.is('op', '++') || this.is('op', '--') ? this.postfix() : this.primary() };
    if (this.eat('op', '(')) {
      this.noIn = 0;
      const list = this.exprList();
      this.expect('op', ')');
      if (list.length > 1) { this.expect('kw', 'in'); return { t: 'in', keys: list, arr: this.expect('name').v }; }
      return { t: 'group', e: list[0] as Expr };
    }
    if (this.eat('kw', 'getline')) return this.getline();
    if (t.k === 'builtin' || t.k === 'func') return this.call();
    if (t.k === 'name') {
      this.i++;
      if (this.eat('op', '[')) { const keys = this.exprList(); this.expect('op', ']'); return { t: 'idx', name: t.v, keys }; }
      return { t: 'var', name: t.v };
    }
    throw new AwkError(`syntax error at or near ${t.v === '\n' ? 'end of line' : t.v || 'end of file'}`);
  }

  private getline(): Expr {
    let target: Expr | undefined;
    if (this.is('name') || this.is('op', '$')) target = this.primary();
    if (this.eat('op', '<')) return { t: 'getline', target, file: this.primary() };
    return { t: 'getline', target };
  }

  private call(): Expr {
    const name = this.toks[this.i++]?.v ?? '';
    const args: Expr[] = [];
    if (this.eat('op', '(')) {
      this.nls();
      if (!this.eat('op', ')')) { args.push(...this.exprList()); this.nls(); this.expect('op', ')'); }
    }
    return { t: 'call', name, args };
  }
}
