/** test and [ (POSIX rules by argument count, then -a/-o/!/( ) precedence). */
import type { CommandFn, Ctx } from '../types.ts';
import type { Interp } from '../interp.ts';
import { builtinError } from '../io.ts';
import { UNARY_OPS, unaryTest, integerOf, compareInts, fileCompare, TestError } from '../testops.ts';

const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-ef', '-nt', '-ot']);

function binary(sh: Interp, a: string, op: string, b: string, cmd: string): boolean {
  switch (op) {
    case '=': case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '-ef': case '-nt': case '-ot': return fileCompare(sh, op, a, b);
    default: return compareInts(op, integerOf(a, cmd), integerOf(b, cmd));
  }
}

class Evaluator {
  private i = 0;
  private readonly sh: Interp;
  private readonly args: readonly string[];
  private readonly cmd: string;

  constructor(sh: Interp, args: readonly string[], cmd: string) {
    this.sh = sh;
    this.args = args;
    this.cmd = cmd;
  }

  run(): boolean {
    const n = this.args.length;
    const a = this.args;
    if (n === 0) return false;
    if (n === 1) return (a[0] ?? '') !== '';
    if (n === 2) return a[0] === '!' ? (a[1] ?? '') === '' : this.unary(a[0] ?? '', a[1] ?? '');
    if (n === 3 && BINARY.has(a[1] ?? '')) return binary(this.sh, a[0] ?? '', a[1] ?? '', a[2] ?? '', this.cmd);
    if (n === 3 && a[0] === '!') return !new Evaluator(this.sh, a.slice(1), this.cmd).run();
    if (n === 3 && a[0] === '(' && a[2] === ')') return (a[1] ?? '') !== '';
    if (n === 4 && a[0] === '!') return !new Evaluator(this.sh, a.slice(1), this.cmd).run();
    if (n === 4 && a[0] === '(' && a[3] === ')') return new Evaluator(this.sh, a.slice(1, 3), this.cmd).run();
    const v = this.or();
    if (this.i < n) throw new TestError(`${this.cmd}: too many arguments`);
    return v;
  }

  private unary(op: string, arg: string): boolean {
    if (!UNARY_OPS.has(op)) throw new TestError(`${this.cmd}: ${op}: unary operator expected`);
    return unaryTest(this.sh, op, arg);
  }

  private or(): boolean {
    let v = this.and();
    while (this.args[this.i] === '-o') { this.i++; const r = this.and(); v = v || r; }
    return v;
  }

  private and(): boolean {
    let v = this.not();
    while (this.args[this.i] === '-a') { this.i++; const r = this.not(); v = v && r; }
    return v;
  }

  private not(): boolean {
    if (this.args[this.i] === '!') { this.i++; return !this.not(); }
    return this.primary();
  }

  private primary(): boolean {
    const a = this.args;
    const t = a[this.i];
    if (t === undefined) throw new TestError(`${this.cmd}: argument expected`);
    if (t === '(') {
      this.i++;
      const v = this.or();
      if (a[this.i] !== ')') throw new TestError(`${this.cmd}: \`)' expected`);
      this.i++;
      return v;
    }
    if (BINARY.has(a[this.i + 1] ?? '') && a[this.i + 2] !== undefined) {
      const v = binary(this.sh, t, a[this.i + 1] ?? '', a[this.i + 2] ?? '', this.cmd);
      this.i += 3;
      return v;
    }
    if (UNARY_OPS.has(t) && a[this.i + 1] !== undefined && t !== '-a' && t !== '-o') {
      this.i += 2;
      return unaryTest(this.sh, t, a[this.i - 1] ?? '');
    }
    if (a[this.i + 1] !== undefined && !['-a', '-o', ')'].includes(a[this.i + 1] ?? '')) throw new TestError(`${this.cmd}: ${a[this.i + 1] ?? ''}: binary operator expected`);
    this.i++;
    return t !== '';
  }
}

function testCmd(ctx: Ctx): number {
  let args = ctx.argv.slice(1);
  const name = ctx.argv[0] ?? 'test';
  if (name === '[') {
    if (args[args.length - 1] !== ']') return builtinError(ctx, "missing `]'", 2);
    args = args.slice(0, -1);
  }
  try {
    return new Evaluator(ctx.sh, args, name).run() ? 0 : 1;
  } catch (e) {
    if (!(e instanceof TestError)) throw e;
    ctx.err(`${ctx.sh.errPrefix()}${e.message}\n`);
    return 2;
  }
}

export const TEST: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['test', testCmd], ['[', testCmd]]);
