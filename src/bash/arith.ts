/** Shell arithmetic with 64-bit signed integers (BigInt), C precedence and bash error messages. */

export interface ArithEnv {
  get(name: string, sub: string | undefined): string | undefined;
  set(name: string, sub: string | undefined, value: string): void;
}

export class ArithError extends Error {}

type Node =
  | { k: 'num'; v: bigint }
  | { k: 'var'; name: string; sub?: string }
  | { k: 'un'; op: string; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'asg'; op: string; target: Extract<Node, { k: 'var' }>; e: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node }
  | { k: 'inc'; op: '++' | '--'; prefix: boolean; target: Extract<Node, { k: 'var' }> };

interface Tok {
  readonly v: string;
  readonly pos: number;
  readonly kind: 'num' | 'id' | 'op' | 'end';
  readonly sub?: string;
}

const OPS = ['<<=', '>>=', '**', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '*=', '/=', '%=', '+=', '-=', '&=', '^=', '|=',
  '+', '-', '*', '/', '%', '<', '>', '&', '^', '|', '!', '~', '?', ':', '=', ',', '(', ')'];
const ASSIGN = new Set(['=', '*=', '/=', '%=', '+=', '-=', '<<=', '>>=', '&=', '^=', '|=']);
const LEVELS: readonly (readonly string[])[] = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
const MAX_DEPTH = 1024;

const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? '';
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:0[xX][0-9a-fA-F]*|[0-9]+#[0-9a-zA-Z@_]+|[0-9]+)/.exec(src.slice(i));
    if (num) { toks.push({ v: num[0], pos: i, kind: 'num' }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      let j = i + id[0].length;
      let sub: string | undefined;
      if (src[j] === '[') {
        let depth = 0;
        const start = j;
        for (; j < src.length; j++) { if (src[j] === '[') depth++; else if (src[j] === ']' && --depth === 0) break; }
        sub = src.slice(start + 1, j);
        j++;
      }
      toks.push({ v: id[0], pos: i, kind: 'id', sub });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw err(src, i, 'syntax error: invalid arithmetic operator');
    toks.push({ v: op, pos: i, kind: 'op' });
    i += op.length;
  }
  toks.push({ v: '', pos: src.length, kind: 'end' });
  return toks;
}

function err(src: string, pos: number, what: string): ArithError {
  return new ArithError(`${src}: ${what} (error token is "${src.slice(pos)}")`);
}

export function parseNumber(text: string, src: string, pos: number): bigint {
  const base = /^([0-9]+)#(.+)$/.exec(text);
  if (base) {
    const b = Number(base[1]);
    if (b < 2 || b > 64) throw err(src, pos, 'invalid arithmetic base');
    let v = 0n;
    for (const ch of base[2] ?? '') {
      const d = /[0-9]/.test(ch) ? ch.charCodeAt(0) - 48 : /[a-z]/.test(ch) ? ch.charCodeAt(0) - 87 : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - (b <= 36 ? 55 : 29) : ch === '@' ? 62 : 63;
      if (d >= b) throw err(src, pos, 'value too great for base');
      v = wrap(v * BigInt(b) + BigInt(d));
    }
    return v;
  }
  if (/^0[xX]/.test(text)) {
    if (text.length === 2) throw err(src, pos, 'invalid number');
    return wrap(BigInt(text));
  }
  if (text.length > 1 && text.startsWith('0')) {
    if (/[89]/.test(text)) throw err(src, pos, 'value too great for base');
    return wrap(BigInt(`0o${text.slice(1)}`));
  }
  return wrap(BigInt(text));
}

class ArithParser {
  private i = 0;
  private readonly src: string;
  private readonly toks: Tok[];

  constructor(src: string, toks: Tok[]) {
    this.src = src;
    this.toks = toks;
  }

  private get t(): Tok {
    return this.toks[this.i] as Tok;
  }

  private eat(v: string): boolean {
    if (this.t.kind === 'op' && this.t.v === v) { this.i++; return true; }
    return false;
  }

  parse(): Node {
    const n = this.comma();
    if (this.t.kind !== 'end') throw err(this.src, this.t.pos, 'syntax error in expression');
    return n;
  }

  private comma(): Node {
    let n = this.assign();
    while (this.eat(',')) n = { k: 'bin', op: ',', l: n, r: this.assign() };
    return n;
  }

  private assign(): Node {
    const start = this.i;
    const left = this.ternary();
    if (this.t.kind === 'op' && ASSIGN.has(this.t.v)) {
      if (left.k !== 'var') throw err(this.src, this.toks[start]?.pos ?? 0, 'attempted assignment to non-variable');
      const op = this.t.v;
      this.i++;
      return { k: 'asg', op, target: left, e: this.assign() };
    }
    return left;
  }

  private ternary(): Node {
    const c = this.binary(0);
    if (!this.eat('?')) return c;
    const a = this.assign();
    if (!this.eat(':')) throw err(this.src, this.t.pos, "syntax error: `:' expected for conditional expression");
    return { k: 'tern', c, a, b: this.assign() };
  }

  private binary(level: number): Node {
    if (level >= LEVELS.length) return this.power();
    let l = this.binary(level + 1);
    const ops = LEVELS[level] ?? [];
    while (this.t.kind === 'op' && ops.includes(this.t.v)) {
      const op = this.t.v;
      this.i++;
      l = { k: 'bin', op, l, r: this.binary(level + 1) };
    }
    return l;
  }

  private power(): Node {
    const base = this.unary();
    if (this.eat('**')) return { k: 'bin', op: '**', l: base, r: this.power() };
    return base;
  }

  private unary(): Node {
    const t = this.t;
    if (t.kind === 'op' && (t.v === '++' || t.v === '--')) {
      this.i++;
      const target = this.unary();
      if (target.k !== 'var') throw err(this.src, t.pos, 'syntax error: operand expected');
      return { k: 'inc', op: t.v, prefix: true, target };
    }
    if (t.kind === 'op' && ['!', '~', '+', '-'].includes(t.v)) {
      this.i++;
      return { k: 'un', op: t.v, e: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    const n = this.primary();
    if (n.k === 'var' && this.t.kind === 'op' && (this.t.v === '++' || this.t.v === '--')) {
      const op = this.t.v;
      this.i++;
      return { k: 'inc', op, prefix: false, target: n };
    }
    return n;
  }

  private primary(): Node {
    const t = this.t;
    if (t.kind === 'num') { this.i++; return { k: 'num', v: parseNumber(t.v, this.src, t.pos) }; }
    if (t.kind === 'id') { this.i++; return { k: 'var', name: t.v, sub: t.sub }; }
    if (this.eat('(')) {
      const n = this.comma();
      if (!this.eat(')')) throw err(this.src, this.t.pos, "syntax error: `)' expected");
      return n;
    }
    const at = t.kind === 'end' ? this.toks[this.i - 1]?.pos ?? t.pos : t.pos;
    throw err(this.src, at, 'syntax error: operand expected');
  }
}

export class Arith {
  private depth = 0;
  private readonly env: ArithEnv;

  constructor(env: ArithEnv) {
    this.env = env;
  }

  eval(src: string): bigint {
    if (src.trim() === '') return 0n;
    if (++this.depth > MAX_DEPTH) { this.depth = 0; throw new ArithError(`${src}: expression recursion level exceeded (error token is "${src}")`); }
    try {
      return this.node(new ArithParser(src, tokenize(src)).parse(), src);
    } finally {
      this.depth--;
    }
  }

  private read(v: Extract<Node, { k: 'var' }>): bigint {
    const raw = this.env.get(v.name, v.sub);
    if (raw === undefined || raw.trim() === '') return 0n;
    return /^-?\d+$/.test(raw.trim()) ? wrap(BigInt(raw.trim())) : this.eval(raw);
  }

  private node(n: Node, src: string): bigint {
    switch (n.k) {
      case 'num': return n.v;
      case 'var': return this.read(n);
      case 'un': { const v = this.node(n.e, src); return n.op === '!' ? (v === 0n ? 1n : 0n) : n.op === '~' ? wrap(~v) : n.op === '-' ? wrap(-v) : v; }
      case 'tern': return this.node(n.c, src) !== 0n ? this.node(n.a, src) : this.node(n.b, src);
      case 'inc': {
        const old = this.read(n.target);
        const nv = wrap(n.op === '++' ? old + 1n : old - 1n);
        this.env.set(n.target.name, n.target.sub, String(nv));
        return n.prefix ? nv : old;
      }
      case 'asg': {
        const rhs = this.node(n.e, src);
        const v = n.op === '=' ? rhs : binop(n.op.slice(0, -1), this.read(n.target), rhs, src);
        this.env.set(n.target.name, n.target.sub, String(v));
        return v;
      }
      case 'bin': {
        if (n.op === '&&') return this.node(n.l, src) !== 0n && this.node(n.r, src) !== 0n ? 1n : 0n;
        if (n.op === '||') return this.node(n.l, src) !== 0n || this.node(n.r, src) !== 0n ? 1n : 0n;
        if (n.op === ',') { this.node(n.l, src); return this.node(n.r, src); }
        return binop(n.op, this.node(n.l, src), this.node(n.r, src), src);
      }
    }
  }
}

/** a ** b with 64-bit wrap-around at every step (no huge intermediate values). */
function power(a: bigint, b: bigint): bigint {
  let result = 1n;
  let base = a;
  let e = b;
  while (e > 0n) {
    if (e & 1n) result = wrap(result * base);
    base = wrap(base * base);
    e >>= 1n;
  }
  return result;
}

function binop(op: string, a: bigint, b: bigint, src: string): bigint {
  switch (op) {
    case '+': return wrap(a + b);
    case '-': return wrap(a - b);
    case '*': return wrap(a * b);
    case '/': case '%':
      if (b === 0n) throw new ArithError(`${src}: division by 0 (error token is "${src.slice(src.lastIndexOf(op) + 1)}")`);
      return wrap(op === '/' ? a / b : a % b);
    case '**':
      if (b < 0n) throw new ArithError(`${src}: exponent less than 0 (error token is "${src.slice(src.lastIndexOf('**') + 2)}")`);
      return power(a, b);
    case '<<': return wrap(a << (b & 63n));
    case '>>': return wrap(a >> (b & 63n));
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
    case '<': return a < b ? 1n : 0n;
    case '>': return a > b ? 1n : 0n;
    case '<=': return a <= b ? 1n : 0n;
    case '>=': return a >= b ? 1n : 0n;
    case '==': return a === b ? 1n : 0n;
    case '!=': return a !== b ? 1n : 0n;
    default: throw new ArithError(`${src}: syntax error: invalid arithmetic operator (error token is "${op}")`);
  }
}
