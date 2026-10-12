/** awk (mawk 1.3.4 compatible): -F -v -f, var=value operands, BEGIN/END, ranges, RS, getline, output redirection. */
import { isCatastrophic } from '../regex-guard.ts';
import type { Ctx, Gen } from '../types.ts';
import { AwkParser, AwkError } from './awk-parse.ts';
import type { Expr, Program, Rule } from './awk-parse.ts';
import { AwkVM, ExitSig, NextSig, toNum } from './awk-vm.ts';
import type { AwkIo } from './awk-vm.ts';
import { RegexError } from './regex.ts';
import { decodeAnsi } from '../wordparse.ts';
import { runSync } from '../interp.ts';
import { bufferSink, dataSource } from '../io.ts';
import { lines, errMsg } from './common.ts';

interface Source {
  readonly name: string;
  readonly text: string;
}

function records(text: string, rs: string): string[] {
  if (text === '') return [];
  if (rs === '\n') return lines(text);
  if (rs === '') return text.replace(/^\n+/, '').split(/\n\n+/).map((r) => r.replace(/\n+$/, '')).filter((r) => r !== '');
  const parts = rs.length === 1 || isCatastrophic(rs) ? text.split(rs) : text.split(new RegExp(rs));
  if (parts[parts.length - 1] === '' || parts[parts.length - 1] === '\n') parts.pop();
  return parts;
}

function runCapture(ctx: Ctx, cmd: string, input?: string): { out: string; status: number } {
  const sh = ctx.sh;
  const cap = bufferSink();
  const fds = new Map(ctx.fds);
  fds.set(1, { write: cap });
  if (input !== undefined) fds.set(0, { read: dataSource(input) });
  const status = runSync(sh.clone().runSource(cmd, fds));
  return { out: cap.chunks.join(''), status };
}

function makeIo(ctx: Ctx, vm: () => AwkVM, next: () => string | null): AwkIo & { flush(): void } {
  const files = new Map<string, boolean>();
  const pipes = new Map<string, string[]>();
  const readers = new Map<string, string[]>();
  const flushPipe = (cmd: string): number => {
    const data = pipes.get(cmd);
    if (data === undefined) return -1;
    pipes.delete(cmd);
    const r = runCapture(ctx, cmd, data.join(''));
    ctx.out(r.out);
    return r.status;
  };
  return {
    now: ctx.sh.env.now(),
    env: ctx.env,
    out: (t) => ctx.out(t),
    printTo(op, dest, text) {
      if (op === '|') { pipes.set(dest, [...(pipes.get(dest) ?? []), text]); return; }
      if (dest === '/dev/stdout' || dest === '-') { ctx.out(text); return; }
      if (dest === '/dev/stderr') { ctx.err(text); return; }
      const append = op === '>>' || files.has(dest);
      files.set(dest, true);
      ctx.sh.env.fs.writeFile(ctx.resolve(dest), text, ctx.cred, append);
    },
    nextRecord: next,
    readFileLine(name) {
      if (!readers.has(name)) {
        try { readers.set(name, records(name === '-' ? '' : ctx.sh.env.fs.readFile(ctx.resolve(name), ctx.cred), vm().str(vm().globals.get('RS') ?? '\n'))); } catch { return null; }
      }
      return readers.get(name)?.shift() ?? null;
    },
    readCmdLine(cmd) {
      if (!readers.has(`|${cmd}`)) readers.set(`|${cmd}`, lines(runCapture(ctx, cmd).out));
      return readers.get(`|${cmd}`)?.shift() ?? null;
    },
    system(cmd) {
      for (const k of [...pipes.keys()]) flushPipe(k);
      const r = runCapture(ctx, cmd);
      ctx.out(r.out);
      return r.status;
    },
    close(name) {
      files.delete(name);
      readers.delete(name);
      readers.delete(`|${name}`);
      return pipes.has(name) ? flushPipe(name) : 0;
    },
    flush() { for (const k of [...pipes.keys()]) flushPipe(k); },
  };
}

function assignOperand(vm: AwkVM, op: string): boolean {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(op);
  if (!m) return false;
  vm.setVar(m[1] ?? '', { sn: decodeAnsi((m[2] ?? '').replace(/'/g, "\\'")) });
  return true;
}

function matchRule(vm: AwkVM, rule: Rule, state: Map<Rule, boolean>): boolean {
  if (rule.pattern === undefined) return true;
  if (rule.pattern === 'BEGIN' || rule.pattern === 'END') return false;
  if (!rule.pattern2) return vm.truthy(vm.eval(rule.pattern));
  if (state.get(rule)) {
    if (vm.truthy(vm.eval(rule.pattern2))) state.set(rule, false);
    return true;
  }
  if (!vm.truthy(vm.eval(rule.pattern))) return false;
  state.set(rule, !vm.truthy(vm.eval(rule.pattern2)));
  return true;
}

function parseArgs(ctx: Ctx): { prog?: string; fs?: string; assigns: string[]; operands: string[]; error?: string } {
  const args = ctx.argv.slice(1);
  const assigns: string[] = [];
  let fs: string | undefined;
  let prog: string | undefined;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { i++; break; }
    if (a.startsWith('-F')) { fs = a.length > 2 ? a.slice(2) : args[++i]; continue; }
    if (a.startsWith('-v')) { assigns.push(a.length > 2 ? a.slice(2) : args[++i] ?? ''); continue; }
    if (a.startsWith('-f')) {
      const f = a.length > 2 ? a.slice(2) : args[++i] ?? '';
      try { prog = (prog ?? '') + ctx.sh.env.fs.readFile(ctx.resolve(f), ctx.cred); } catch (e) { return { assigns, operands: [], error: `couldn't open file ${f}: ${errMsg(e)}` }; }
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && a !== '-') return { assigns, operands: [], error: `not an option: ${a}` };
    break;
  }
  const rest = args.slice(i);
  if (prog === undefined) prog = rest.shift();
  return { prog, fs, assigns, operands: rest };
}

export function* awk(ctx: Ctx): Gen<number> {
  const a = parseArgs(ctx);
  if (a.error) { ctx.err(`awk: ${a.error}\n`); return 2; }
  if (a.prog === undefined) { ctx.err('usage: awk [-F value] [-v var=value] [--] \'program text\' [file ...]\nusage: awk [-F value] [-v var=value] [-f program-file] [--] [file ...]\n'); return 2; }
  let program: Program;
  try {
    program = new AwkParser(a.prog).parse();
  } catch (e) {
    ctx.err(`awk: line 1: ${errMsg(e)}\n`);
    return 2;
  }
  const sources: Source[] = [];
  let srcIdx = 0;
  let recs: string[] = [];
  let failed = false;
  const stdin = a.operands.filter((o) => !/^[A-Za-z_]\w*=/.test(o)).length === 0;
  const stdinText = stdin && program.rules.some((r) => r.pattern !== 'BEGIN') ? yield* ctx.readAll() : '';
  let vm: AwkVM;
  const pending = [...a.operands];
  const nextRecord = (): string | null => {
    for (;;) {
      if (recs.length) return recs.shift() ?? null;
      if (srcIdx < sources.length) { srcIdx++; continue; }
      const op = pending.shift();
      if (op === undefined) {
        if (stdin && !sources.length) { sources.push({ name: '', text: stdinText }); recs = records(stdinText, vm.str(vm.globals.get('RS') ?? '\n')); srcIdx = 1; vm.globals.set('FNR', 0); continue; }
        return null;
      }
      if (assignOperand(vm, op)) continue;
      let text: string;
      try { text = op === '-' ? stdinText : ctx.sh.env.fs.readFile(ctx.resolve(op), ctx.cred); } catch (e) { ctx.err(`awk: cannot open ${op} (${errMsg(e)})\n`); failed = true; continue; }
      sources.push({ name: op, text });
      srcIdx = sources.length;
      vm.globals.set('FILENAME', op);
      vm.globals.set('FNR', 0);
      recs = records(text, vm.str(vm.globals.get('RS') ?? '\n'));
    }
  };
  const io = makeIo(ctx, () => vm, nextRecord);
  vm = new AwkVM(program, io);
  if (a.fs !== undefined) vm.globals.set('FS', a.fs === 't' ? '\t' : decodeAnsi(a.fs));
  for (const as of a.assigns) assignOperand(vm, as);
  vm.arrays.set('ARGV', new Map([['0', 'awk'], ...a.operands.map((o, i) => [String(i + 1), o] as [string, string])]));
  vm.globals.set('ARGC', a.operands.length + 1);
  const status = runProgram(ctx, vm, program, nextRecord);
  io.flush();
  return status ?? (failed ? 2 : 0);
}

function runRules(vm: AwkVM, rules: readonly Rule[]): void {
  for (const r of rules) if (r.action) vm.exec(r.action);
}

function runProgram(ctx: Ctx, vm: AwkVM, program: Program, next: () => string | null): number | undefined {
  const begin = program.rules.filter((r) => r.pattern === 'BEGIN');
  const end = program.rules.filter((r) => r.pattern === 'END');
  const main = program.rules.filter((r) => r.pattern !== 'BEGIN' && r.pattern !== 'END');
  const ranges = new Map<Rule, boolean>();
  let exitCode: number | undefined;
  try {
    try {
      runRules(vm, begin);
      if (main.length || end.length) {
        for (let rec = next(); rec !== null; rec = next()) {
          vm.globals.set('NR', toNum(vm.globals.get('NR') ?? 0) + 1);
          vm.globals.set('FNR', toNum(vm.globals.get('FNR') ?? 0) + 1);
          vm.setRecord(rec);
          ctx.sh.tick();
          try {
            for (const r of main) if (matchRule(vm, r, ranges)) vm.exec(r.action ?? { t: 'print', args: [], printf: false });
          } catch (e) { if (!(e instanceof NextSig)) throw e; }
        }
      }
    } catch (e) {
      if (!(e instanceof ExitSig)) throw e;
      exitCode = e.code;
    }
    try { runRules(vm, end); } catch (e) { if (!(e instanceof ExitSig)) throw e; exitCode = e.code; }
  } catch (e) {
    if (e instanceof AwkError || e instanceof RegexError) { ctx.err(`awk: run time error: ${e.message}\n\tFILENAME="${vm.str(vm.globals.get('FILENAME') ?? '')}" FNR=${vm.str(vm.globals.get('FNR') ?? 0)} NR=${vm.str(vm.globals.get('NR') ?? 0)}\n`); return 2; }
    throw e;
  }
  void (undefined as unknown as Expr);
  return exitCode;
}
