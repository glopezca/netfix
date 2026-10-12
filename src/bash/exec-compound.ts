/** Compound commands: ( ) { } if while until for select case (( )) [[ ]]. Bodies run through sh.execCommand. */
import type { Command, Compound, CondExpr } from './ast.ts';
import type { Interp } from './interp.ts';
import type { Fds, Gen } from './types.ts';
import { DiscardSignal, ExitSignal, LoopSignal, ReturnSignal } from './types.ts';
import { applyRedirects, RedirError } from './redirect.ts';
import { readLineFrom, writeSink } from './io.ts';
import { matchPattern } from './glob.ts';
import { ExpansionError } from './params.ts';
import { ArithError } from './arith.ts';
import { VarError } from './vars.ts';
import { unaryTest, fileCompare, compareInts, regexMatch, TestError } from './testops.ts';

function softError(sh: Interp, e: unknown): number {
  if (e instanceof RedirError) { sh.error(e.message); return 1; }
  if (e instanceof ExpansionError) {
    sh.error(e.message);
    if (e.exits && !sh.interactive) throw new ExitSignal(1);
    throw new DiscardSignal(1);
  }
  if (e instanceof ArithError || e instanceof VarError) { sh.error(e.message); throw new DiscardSignal(1); }
  throw e;
}

export function* execCompound(sh: Interp, cmd: Compound, base: Fds): Gen<number> {
  let fds: Fds;
  try {
    fds = cmd.redirs.length ? applyRedirects(sh, cmd.redirs, base) : base;
  } catch (e) {
    return softError(sh, e);
  }
  switch (cmd.kind) {
    case 'subshell': return yield* subshell(sh, cmd.body, fds);
    case 'group': return yield* sh.execCommand(cmd.body, fds);
    case 'if': return yield* ifCmd(sh, cmd, fds);
    case 'while': return yield* whileCmd(sh, cmd, fds);
    case 'for': return yield* forCmd(sh, cmd, fds);
    case 'arith_for': return yield* arithFor(sh, cmd, fds);
    case 'select': return yield* selectCmd(sh, cmd, fds);
    case 'case': return yield* caseCmd(sh, cmd, fds);
    case 'arith': return arithCmd(sh, cmd);
    case 'cond': return condCmd(sh, cmd);
  }
}

function* subshell(sh: Interp, body: Command, fds: Fds): Gen<number> {
  const sub = sh.clone();
  try {
    return yield* sub.execCommand(body, fds);
  } catch (e) {
    if (e instanceof ExitSignal || e instanceof DiscardSignal) return e.code;
    if (e instanceof LoopSignal || e instanceof ReturnSignal) return 0;
    throw e;
  } finally {
    sub.runTrap('EXIT');
  }
}

/** Runs a condition list: errexit is suspended while it runs. */
function* condition(sh: Interp, cmd: Command, fds: Fds): Gen<number> {
  sh.conditionDepth++;
  try {
    return yield* sh.execCommand(cmd, fds);
  } finally {
    sh.conditionDepth--;
  }
}

function* ifCmd(sh: Interp, cmd: Extract<Compound, { kind: 'if' }>, fds: Fds): Gen<number> {
  for (const c of cmd.clauses) {
    if ((yield* condition(sh, c.cond, fds)) === 0) return yield* sh.execCommand(c.body, fds);
  }
  return cmd.elseBody ? yield* sh.execCommand(cmd.elseBody, fds) : 0;
}

/** Runs one loop body; returns 'break' / 'continue' / undefined, rethrowing outer-level signals. */
function* loopBody(sh: Interp, body: Command, fds: Fds, status: { value: number }): Gen<'break' | 'continue' | undefined> {
  try {
    status.value = yield* sh.execCommand(body, fds);
    return undefined;
  } catch (e) {
    if (!(e instanceof LoopSignal)) throw e;
    if (e.levels > 1) throw new LoopSignal(e.kind, e.levels - 1);
    return e.kind;
  }
}

function* whileCmd(sh: Interp, cmd: Extract<Compound, { kind: 'while' }>, fds: Fds): Gen<number> {
  const status = { value: 0 };
  sh.loopDepth++;
  try {
    for (;;) {
      sh.tick();
      const c = yield* condition(sh, cmd.cond, fds);
      if ((c === 0) === cmd.until) break;
      if ((yield* loopBody(sh, cmd.body, fds, status)) === 'break') break;
    }
  } finally {
    sh.loopDepth--;
  }
  return status.value;
}

function* forCmd(sh: Interp, cmd: Extract<Compound, { kind: 'for' }>, fds: Fds): Gen<number> {
  let items: string[];
  try {
    items = cmd.words ? sh.expander.words(cmd.words) : [...sh.args];
  } catch (e) {
    return softError(sh, e);
  }
  const status = { value: 0 };
  sh.loopDepth++;
  try {
    for (const item of items) {
      sh.tick();
      if (!sh.trySetVar(cmd.name, item)) return 1;
      if ((yield* loopBody(sh, cmd.body, fds, status)) === 'break') break;
    }
  } finally {
    sh.loopDepth--;
  }
  return status.value;
}

function* arithFor(sh: Interp, cmd: Extract<Compound, { kind: 'arith_for' }>, fds: Fds): Gen<number> {
  const status = { value: 0 };
  sh.loopDepth++;
  try {
    sh.expander.arith(cmd.init);
    for (;;) {
      sh.tick();
      if (cmd.cond.trim() !== '' && sh.expander.arith(cmd.cond) === 0n) break;
      if ((yield* loopBody(sh, cmd.body, fds, status)) === 'break') break;
      sh.expander.arith(cmd.step);
    }
  } catch (e) {
    if (e instanceof ArithError) return softError(sh, e);
    throw e;
  } finally {
    sh.loopDepth--;
  }
  return status.value;
}

function* selectCmd(sh: Interp, cmd: Extract<Compound, { kind: 'select' }>, fds: Fds): Gen<number> {
  const items = cmd.words ? sh.expander.words(cmd.words) : [...sh.args];
  const status = { value: 0 };
  const menu = items.map((it, i) => `${i + 1}) ${it}`).join('\n');
  sh.loopDepth++;
  try {
    writeSink(sh, fds.get(2)?.write, `${menu}\n`);
    for (;;) {
      sh.tick();
      const line = yield* readLineFrom(fds.get(0)?.read, sh.getVar('PS3') ?? '#? ');
      if (line === null) { writeSink(sh, fds.get(2)?.write, '\n'); break; }
      sh.setVar('REPLY', line.text);
      if (line.text.trim() === '') { writeSink(sh, fds.get(2)?.write, `${menu}\n`); continue; }
      const n = Number(line.text.trim());
      sh.setVar(cmd.name, Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] ?? '' : '');
      if ((yield* loopBody(sh, cmd.body, fds, status)) === 'break') break;
    }
  } finally {
    sh.loopDepth--;
  }
  return status.value;
}

function* caseCmd(sh: Interp, cmd: Extract<Compound, { kind: 'case' }>, fds: Fds): Gen<number> {
  let subject: string;
  try {
    subject = sh.expander.word(cmd.word.raw);
  } catch (e) {
    return softError(sh, e);
  }
  const nocase = sh.shoptOn('nocasematch');
  let status = 0;
  let fall = false;
  for (const item of cmd.items) {
    const hit = fall || item.patterns.some((p) => matchPattern(sh.expander.pattern(p.raw), subject, { nocase }));
    if (!hit) continue;
    status = item.body ? yield* sh.execCommand(item.body, fds) : 0;
    if (item.term === ';;') return status;
    fall = item.term === ';&';
  }
  return status;
}

function arithCmd(sh: Interp, cmd: Extract<Compound, { kind: 'arith' }>): number {
  sh.lineno = cmd.line;
  if (sh.opt('xtrace')) sh.term(`${sh.prompt(sh.getVar('PS4') ?? '+ ')}(( ${cmd.expr.trim()} ))\n`);
  try {
    return sh.expander.arith(cmd.expr) !== 0n ? 0 : 1;
  } catch (e) {
    if (e instanceof ArithError) { sh.error(`((: ${e.message}`); throw new DiscardSignal(1); }
    return softError(sh, e);
  }
}

function condCmd(sh: Interp, cmd: Extract<Compound, { kind: 'cond' }>): number {
  sh.lineno = cmd.line;
  try {
    return evalCond(sh, cmd.expr) ? 0 : 1;
  } catch (e) {
    if (e instanceof TestError) { if (e.message) sh.error(e.message); return 2; }
    return softError(sh, e);
  }
}

export function evalCond(sh: Interp, e: CondExpr): boolean {
  switch (e.kind) {
    case 'not': return !evalCond(sh, e.expr);
    case 'and': return evalCond(sh, e.left) && evalCond(sh, e.right);
    case 'or': return evalCond(sh, e.left) || evalCond(sh, e.right);
    case 'word': return sh.expander.word(e.arg.raw) !== '';
    case 'unary': return unaryTest(sh, e.op, sh.expander.word(e.arg.raw));
    case 'binary': return binaryCond(sh, e.op, e.left.raw, e.right.raw);
  }
}

function binaryCond(sh: Interp, op: string, leftRaw: string, rightRaw: string): boolean {
  const left = sh.expander.word(leftRaw);
  const nocase = sh.shoptOn('nocasematch');
  switch (op) {
    case '==': case '=': return matchPattern(sh.expander.pattern(rightRaw), left, { nocase });
    case '!=': return !matchPattern(sh.expander.pattern(rightRaw), left, { nocase });
    case '=~': return regexMatch(sh, left, sh.expander.regex(rightRaw));
    case '<': return left < sh.expander.word(rightRaw);
    case '>': return left > sh.expander.word(rightRaw);
    case '-ef': case '-nt': case '-ot': return fileCompare(sh, op, left, sh.expander.word(rightRaw));
    default: return compareInts(op, sh.expander.arith(left), sh.expander.arith(sh.expander.word(rightRaw)));
  }
}
