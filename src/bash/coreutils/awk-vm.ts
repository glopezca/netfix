/** awk virtual machine: values, fields, expressions, statements and builtin functions. */
import type { Expr, Program, Stmt } from './awk-parse.ts';
import { AwkError } from './awk-parse.ts';
import { compile } from './regex.ts';
import { formatPrintf } from '../builtins/printf.ts';
import { NUMERIC, NextSig, ExitSig, BreakSig, ContinueSig, ReturnSig, toNum, numToStr, isStrNum } from './awk-value.ts';
import type { StrNum, Val } from './awk-value.ts';

export type { StrNum, Val };
export { NextSig, ExitSig, toNum, numToStr };

export interface AwkIo {
  out(text: string): void;
  printTo(op: string, dest: string, text: string): void;
  nextRecord(): string | null;
  readFileLine(name: string): string | null;
  readCmdLine(cmd: string): string | null;
  system(cmd: string): number;
  close(name: string): number;
  readonly now: number;
  readonly env: ReadonlyMap<string, string>;
}

export class AwkVM {
  readonly globals = new Map<string, Val>();
  readonly arrays = new Map<string, Map<string, Val>>();
  private frames: { scalars: Map<string, Val>; arrays: Map<string, Map<string, Val>> }[] = [];
  private record = '';
  private fields: string[] | null = [];
  private seed = 0;
  private randState = 1;
  readonly prog: Program;
  readonly io: AwkIo;
  steps = 0;

  constructor(prog: Program, io: AwkIo) {
    this.prog = prog;
    this.io = io;
    for (const [k, v] of Object.entries({ FS: ' ', OFS: ' ', ORS: '\n', RS: '\n', SUBSEP: '\x1c', CONVFMT: '%.6g', OFMT: '%.6g', NR: 0, FNR: 0, RSTART: 0, RLENGTH: -1, FILENAME: '' })) this.globals.set(k, v);
    this.arrays.set('ENVIRON', new Map([...io.env].map(([k, v]) => [k, { sn: v } as Val])));
  }

  // ------------------------------------------------------------ values

  str(v: Val, out = false): string {
    if (typeof v === 'number') return numToStr(v, String(this.globals.get(out ? 'OFMT' : 'CONVFMT') ?? '%.6g'));
    return typeof v === 'string' ? v : v.sn;
  }

  truthy(v: Val): boolean {
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v !== '';
    return NUMERIC.test(v.sn) ? toNum(v) !== 0 : v.sn !== '';
  }

  private compare(a: Val, b: Val): number {
    const numA = typeof a === 'number' || (isStrNum(a) && NUMERIC.test(a.sn));
    const numB = typeof b === 'number' || (isStrNum(b) && NUMERIC.test(b.sn));
    if (numA && numB) return toNum(a) - toNum(b);
    const x = this.str(a);
    const y = this.str(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // ------------------------------------------------------------ records and fields

  setRecord(text: string): void {
    this.record = text;
    this.fields = null;
  }

  private split(text: string, fs: string): string[] {
    if (text === '') return [];
    if (fs === ' ') return text.trim().split(/[ \t\n]+/);
    if (fs.length === 1 && fs !== '\\') return text.split(fs === '\t' ? '\t' : fs);
    return text.split(this.re(fs));
  }

  private getFields(): string[] {
    if (!this.fields) this.fields = this.split(this.record, this.str(this.globals.get('FS') ?? ' '));
    return this.fields;
  }

  getField(i: number): Val {
    if (i === 0) return { sn: this.record };
    const f = this.getFields()[i - 1];
    return f === undefined ? { sn: '' } : { sn: f };
  }

  setField(i: number, v: string): void {
    if (i === 0) { this.setRecord(v); return; }
    const f = [...this.getFields()];
    while (f.length < i) f.push('');
    f[i - 1] = v;
    this.fields = f;
    this.record = f.join(this.str(this.globals.get('OFS') ?? ' '));
  }

  private setNF(n: number): void {
    const f = this.getFields().slice(0, n);
    while (f.length < n) f.push('');
    this.fields = f;
    this.record = f.join(this.str(this.globals.get('OFS') ?? ' '));
  }

  // ------------------------------------------------------------ variables

  private frame(): { scalars: Map<string, Val>; arrays: Map<string, Map<string, Val>> } | undefined {
    return this.frames[this.frames.length - 1];
  }

  getVar(name: string): Val {
    const f = this.frame();
    if (f?.scalars.has(name)) return f.scalars.get(name) as Val;
    if (name === 'NF') return this.getFields().length;
    return this.globals.get(name) ?? '';
  }

  setVar(name: string, v: Val): void {
    const f = this.frame();
    if (f?.scalars.has(name)) { f.scalars.set(name, v); return; }
    if (name === 'NF') { this.setNF(Math.max(0, Math.trunc(toNum(v)))); return; }
    if (name === 'FS') this.fields = this.fields ?? null;
    this.globals.set(name, v);
  }

  array(name: string): Map<string, Val> {
    const f = this.frame();
    if (f?.arrays.has(name)) return f.arrays.get(name) as Map<string, Val>;
    if (f?.scalars.has(name)) { const a = new Map<string, Val>(); f.scalars.delete(name); f.arrays.set(name, a); return a; }
    let a = this.arrays.get(name);
    if (!a) { a = new Map(); this.arrays.set(name, a); }
    return a;
  }

  private key(keys: readonly Expr[]): string {
    return keys.map((k) => this.str(this.eval(k))).join(this.str(this.globals.get('SUBSEP') ?? '\x1c'));
  }

  private assignTo(target: Expr, v: Val): Val {
    if (target.t === 'var') this.setVar(target.name, v);
    else if (target.t === 'field') this.setField(Math.trunc(toNum(this.eval(target.e))), this.str(v));
    else if (target.t === 'idx') this.array(target.name).set(this.key(target.keys), v);
    else if (target.t === 'group') return this.assignTo(target.e, v);
    else throw new AwkError('assignment to non-variable');
    return v;
  }

  re(src: string): RegExp {
    return compile(src, { extended: true });
  }

  private matchRe(e: Expr): RegExp {
    return this.re(e.t === 're' ? e.v : this.str(this.eval(e)));
  }

  // ------------------------------------------------------------ expressions

  eval(e: Expr): Val {
    if (++this.steps % 4096 === 0 && this.steps > 5_000_000) throw new AwkError('netsim: demasiadas operaciones (¿bucle infinito?)');
    switch (e.t) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 're': return this.re(e.v).test(this.record) ? 1 : 0;
      case 'group': return this.eval(e.e);
      case 'var': return this.getVar(e.name);
      case 'field': return this.getField(Math.trunc(toNum(this.eval(e.e))));
      case 'idx': { const a = this.array(e.name); const k = this.key(e.keys); if (!a.has(k)) a.set(k, ''); return a.get(k) as Val; }
      case 'in': return this.array(e.arr).has(this.key(e.keys)) ? 1 : 0;
      case 'match': { const r = this.matchRe(e.r).test(this.str(this.eval(e.l))); return r !== e.neg ? 1 : 0; }
      case 'cond': return this.truthy(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case 'un': { const v = this.eval(e.e); return e.op === '!' ? (this.truthy(v) ? 0 : 1) : e.op === '-' ? -toNum(v) : toNum(v); }
      case 'incdec': return this.incdec(e);
      case 'assign': return this.assign(e);
      case 'bin': return this.binary(e);
      case 'call': return this.call(e.name, e.args);
      case 'getline': return this.getline(e);
    }
  }

  private incdec(e: Extract<Expr, { t: 'incdec' }>): Val {
    const old = toNum(this.eval(e.target));
    const nv = e.op === '++' ? old + 1 : old - 1;
    this.assignTo(e.target, nv);
    return e.prefix ? nv : old;
  }

  private assign(e: Extract<Expr, { t: 'assign' }>): Val {
    const rhs = this.eval(e.e);
    if (e.op === '=') return this.assignTo(e.target, isStrNum(rhs) ? rhs : rhs);
    const op = e.op.slice(0, -1).replace('**', '^');
    return this.assignTo(e.target, this.arith(op, toNum(this.eval(e.target)), toNum(rhs)));
  }

  private arith(op: string, a: number, b: number): number {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw new AwkError('division by zero'); return a / b;
      case '%': if (b === 0) throw new AwkError('division by zero in %'); return a % b;
      default: return a ** b;
    }
  }

  private binary(e: Extract<Expr, { t: 'bin' }>): Val {
    if (e.op === '&&') return this.truthy(this.eval(e.l)) && this.truthy(this.eval(e.r)) ? 1 : 0;
    if (e.op === '||') return this.truthy(this.eval(e.l)) || this.truthy(this.eval(e.r)) ? 1 : 0;
    const l = this.eval(e.l);
    const r = this.eval(e.r);
    if (e.op === ' ') return this.str(l) + this.str(r);
    if (['<', '<=', '>', '>=', '==', '!='].includes(e.op)) {
      const c = this.compare(l, r);
      return (e.op === '<' ? c < 0 : e.op === '<=' ? c <= 0 : e.op === '>' ? c > 0 : e.op === '>=' ? c >= 0 : e.op === '==' ? c === 0 : c !== 0) ? 1 : 0;
    }
    return this.arith(e.op, toNum(l), toNum(r));
  }

  private getline(e: Extract<Expr, { t: 'getline' }>): Val {
    const line = e.file ? this.io.readFileLine(this.str(this.eval(e.file))) : e.cmd ? this.io.readCmdLine(this.str(this.eval(e.cmd))) : this.io.nextRecord();
    if (line === null) return 0;
    if (e.target) this.assignTo(e.target, { sn: line });
    else this.setRecord(line);
    if (!e.file && !e.cmd) { this.globals.set('NR', toNum(this.globals.get('NR') ?? 0) + 1); this.globals.set('FNR', toNum(this.globals.get('FNR') ?? 0) + 1); }
    return 1;
  }

  // ------------------------------------------------------------ builtin and user functions

  private call(name: string, args: Expr[]): Val {
    const user = this.prog.funcs.get(name);
    if (user) return this.callUser(user, args);
    const s = (i: number): string => this.str(this.eval(args[i] as Expr));
    const n = (i: number): number => toNum(this.eval(args[i] as Expr));
    switch (name) {
      case 'length': {
        const a = args[0];
        if (!a) return Array.from(this.record).length;
        if (a.t === 'var' && (this.arrays.has(a.name) || this.frame()?.arrays.has(a.name))) return this.array(a.name).size;
        return Array.from(s(0)).length;
      }
      case 'substr': {
        const chars = Array.from(s(0));
        const start = Math.round(n(1));
        const len = args[2] ? Math.round(n(2)) : Infinity;
        const from = Math.max(start, 1);
        const to = Math.min(chars.length + 1, start + len);
        return to > from ? chars.slice(from - 1, to - 1).join('') : '';
      }
      case 'index': return s(0).indexOf(s(1)) + 1;
      case 'split': return this.splitInto(args);
      case 'sub': case 'gsub': return this.substitute(args, name === 'gsub');
      case 'match': {
        const m = this.matchRe(args[1] as Expr).exec(s(0));
        this.globals.set('RSTART', m ? m.index + 1 : 0);
        this.globals.set('RLENGTH', m ? m[0].length : -1);
        return m ? m.index + 1 : 0;
      }
      case 'sprintf': return this.sprintf(args);
      case 'tolower': return s(0).toLowerCase();
      case 'toupper': return s(0).toUpperCase();
      case 'int': return Math.trunc(n(0));
      case 'sqrt': return Math.sqrt(n(0));
      case 'exp': return Math.exp(n(0));
      case 'log': return Math.log(n(0));
      case 'sin': return Math.sin(n(0));
      case 'cos': return Math.cos(n(0));
      case 'atan2': return Math.atan2(n(0), n(1));
      case 'rand': this.randState = (this.randState * 1103515245 + 12345) % 2147483648; return this.randState / 2147483648;
      case 'srand': { const prev = this.seed; this.seed = args[0] ? n(0) : Math.floor(this.io.now / 1000); this.randState = this.seed || 1; return prev; }
      case 'system': return this.io.system(s(0));
      case 'close': return this.io.close(s(0));
      case 'fflush': return 0;
      default: throw new AwkError(`function ${name} never defined`);
    }
  }

  private splitInto(args: Expr[]): number {
    const target = args[1];
    if (target?.t !== 'var') throw new AwkError('split: second argument must be an array');
    const text = this.str(this.eval(args[0] as Expr));
    const fs = args[2] ? (args[2].t === 're' ? args[2].v : this.str(this.eval(args[2]))) : this.str(this.globals.get('FS') ?? ' ');
    const parts = this.split(text, fs);
    const a = this.array(target.name);
    a.clear();
    parts.forEach((p, i) => a.set(String(i + 1), { sn: p }));
    return parts.length;
  }

  private substitute(args: Expr[], global: boolean): number {
    const re = this.matchRe(args[0] as Expr);
    const rep = this.str(this.eval(args[1] as Expr));
    const target: Expr = args[2] ?? { t: 'field', e: { t: 'num', v: 0 } };
    const text = this.str(this.eval(target));
    let count = 0;
    const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    const out = text.replace(g, (m) => {
      if (!global && count > 0) return m;
      count++;
      return rep.replace(/\\\\|\\&|&/g, (x) => (x === '&' ? m : x === '\\&' ? '&' : '\\'));
    });
    if (count) this.assignTo(target, out);
    return count;
  }

  sprintf(args: readonly Expr[]): string {
    const fmt = this.str(this.eval(args[0] as Expr));
    const vals = args.slice(1).map((a) => this.eval(a));
    let i = 0;
    return fmt.replace(/%([-+ #0]*\*?\d*(?:\.\*?\d*)?)([a-zA-Z%])/g, (spec, flags: string, conv: string) => {
      if (conv === '%') return '%';
      const v = vals[i++] ?? '';
      if (conv === 'c') return typeof v === 'number' ? formatPrintf(`%${flags}s`, [String.fromCharCode(v)], 0).passes[0]?.text ?? '' : formatPrintf(`%${flags}s`, [Array.from(this.str(v))[0] ?? ''], 0).passes[0]?.text ?? '';
      const arg = 'diouxXeEfFgGaA'.includes(conv) ? String(toNum(v)) : this.str(v);
      return formatPrintf(spec, [arg], this.io.now).passes.map((x) => x.text).join('');
    });
  }

  private callUser(fn: { params: string[]; body: Stmt }, args: Expr[]): Val {
    const scalars = new Map<string, Val>();
    const arrays = new Map<string, Map<string, Val>>();
    fn.params.forEach((p, i) => {
      const a = args[i];
      if (a?.t === 'var' && (this.arrays.has(a.name) || this.frame()?.arrays.has(a.name))) arrays.set(p, this.array(a.name));
      else scalars.set(p, a ? this.eval(a) : '');
    });
    if (this.frames.length > 1000) throw new AwkError('function call nesting too deep');
    this.frames.push({ scalars, arrays });
    try {
      this.exec(fn.body);
      return '';
    } catch (e) {
      if (e instanceof ReturnSig) return e.v;
      throw e;
    } finally {
      this.frames.pop();
    }
  }

  // ------------------------------------------------------------ statements

  exec(s: Stmt): void {
    switch (s.t) {
      case 'block': for (const x of s.body) this.exec(x); return;
      case 'expr': this.eval(s.e); return;
      case 'print': return this.print(s);
      case 'if': if (this.truthy(this.eval(s.c))) this.exec(s.a); else if (s.b) this.exec(s.b); return;
      case 'while': return this.loop(() => this.truthy(this.eval(s.c)), s.body, undefined, s.doWhile);
      case 'for': if (s.init) this.exec(s.init); return this.loop(() => !s.c || this.truthy(this.eval(s.c)), s.body, s.step, false);
      case 'forin': {
        for (const k of [...this.array(s.arr).keys()]) {
          this.setVar(s.v, { sn: k });
          try { this.exec(s.body); } catch (e) { if (e instanceof BreakSig) break; if (!(e instanceof ContinueSig)) throw e; }
        }
        return;
      }
      case 'simple': throw s.op === 'break' ? new BreakSig() : s.op === 'continue' ? new ContinueSig() : new NextSig();
      case 'exit': throw new ExitSig(s.e ? Math.trunc(toNum(this.eval(s.e))) : 0);
      case 'return': throw new ReturnSig(s.e ? this.eval(s.e) : '');
      case 'delete': if (s.keys) this.array(s.name).delete(this.key(s.keys)); else this.array(s.name).clear(); return;
    }
  }

  private loop(cond: () => boolean, body: Stmt, step: Stmt | undefined, doFirst: boolean): void {
    let first = doFirst;
    while (first || cond()) {
      first = false;
      try { this.exec(body); } catch (e) { if (e instanceof BreakSig) return; if (!(e instanceof ContinueSig)) throw e; }
      if (step) this.exec(step);
    }
  }

  private print(s: Extract<Stmt, { t: 'print' }>): void {
    let text: string;
    if (s.printf) text = this.sprintf(s.args);
    else {
      const parts = s.args.length ? s.args.map((a) => this.str(this.eval(a), true)) : [this.record];
      text = parts.join(this.str(this.globals.get('OFS') ?? ' ')) + this.str(this.globals.get('ORS') ?? '\n');
    }
    if (s.dest) this.io.printTo(s.dest.op, this.str(this.eval(s.dest.e)), text);
    else this.io.out(text);
  }
}
