/** wait jobs fg bg disown kill suspend ulimit umask times caller. Background jobs finish immediately in netsim. */
import type { CommandFn, Ctx } from '../types.ts';
import { builtinError } from '../io.ts';
import { parseOpts, badOption } from './util.ts';
import { SIGNALS, signalName } from './hist.ts';

function jobs(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'lnprsx');
  if (p.bad) return badOption(ctx, p.bad, 'jobs [-lnprs] [jobspec ...] or jobs -x command [args]');
  for (const j of ctx.sh.jobs) {
    if (p.flags.has('p')) ctx.out(`${j.pid}\n`);
    else ctx.out(`[${j.id}]+  ${p.flags.has('l') ? `${j.pid} ` : ''}${j.status ? `Exit ${j.status}` : 'Done'}                    ${j.source}\n`);
  }
  if (!p.flags.has('p')) ctx.sh.jobs = [];
  return 0;
}

function wait(ctx: Ctx): number {
  const sh = ctx.sh;
  const ids = ctx.argv.slice(1).filter((a) => !a.startsWith('-'));
  if (!ids.length) return 0;
  let status = 0;
  for (const id of ids) {
    const job = sh.jobs.find((j) => (id.startsWith('%') ? String(j.id) === id.slice(1) : String(j.pid) === id)) ?? sh.finishedJobs.find((j) => String(j.pid) === id);
    if (!job) { builtinError(ctx, `pid ${id} is not a child of this shell`, 127); status = 127; continue; }
    status = job.status;
  }
  return status;
}

function noJob(): CommandFn {
  return (ctx) => builtinError(ctx, `${ctx.argv[1] ?? 'current'}: no such job`);
}

function kill(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (args[0] === '-l' || args[0] === '-L') {
    if (args[1] !== undefined) {
      const n = Number(args[1]);
      ctx.out(`${Number.isInteger(n) ? SIGNALS[(n > 128 ? n - 128 : n) - 1] ?? '' : String(SIGNALS.indexOf(signalName(args[1]) ?? '') + 1)}\n`);
      return 0;
    }
    ctx.out(`${SIGNALS.map((s, i) => `${String(i + 1).padStart(2)}) SIG${s}`).reduce((acc, s, i) => acc + s + ((i + 1) % 5 === 0 ? '\n' : '\t'), '').trimEnd()}\n`);
    return 0;
  }
  let i = 0;
  let sig = 'TERM';
  if (args[0] === '-s' || args[0] === '-n') { i = 2; sig = signalName(args[1] ?? '') ?? sig; }
  else if (args[0]?.startsWith('-')) {
    if (!signalName(args[0].slice(1))) return builtinError(ctx, `${args[0].slice(1)}: invalid signal specification`);
    i = 1;
    sig = signalName(args[0].slice(1)) ?? sig;
  }
  const targets = args.slice(i);
  if (!targets.length) {
    ctx.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n');
    return 2;
  }
  let status = 0;
  for (const t of targets) {
    if (t === String(ctx.sh.pid) || t === String(ctx.sh.bashpid)) { ctx.sh.runTrap(sig); continue; }
    builtinError(ctx, t.startsWith('%') ? `${t}: no such job` : `(${t}) - No such process`);
    status = 1;
  }
  return status;
}

function umask(ctx: Ctx): number {
  const sh = ctx.sh;
  const p = parseOpts(ctx.argv.slice(1), 'pS');
  if (p.bad) return badOption(ctx, p.bad, 'umask [-p] [-S] [mode]');
  const mode = p.rest[0];
  if (mode === undefined) {
    const m = sh.umask;
    if (p.flags.has('S')) {
      const perms = (bits: number): string => `${bits & 4 ? '' : 'r'}${bits & 2 ? '' : 'w'}${bits & 1 ? '' : 'x'}`;
      ctx.out(`u=${perms((m >> 6) & 7)},g=${perms((m >> 3) & 7)},o=${perms(m & 7)}\n`);
    } else ctx.out(`${p.flags.has('p') ? 'umask ' : ''}${m.toString(8).padStart(4, '0')}\n`);
    return 0;
  }
  if (!/^[0-7]{1,4}$/.test(mode)) return builtinError(ctx, `${mode}: octal number out of range`);
  sh.umask = parseInt(mode, 8);
  return 0;
}

function ulimit(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (args.includes('-a')) {
    ctx.out(['real-time non-blocking time  (microseconds, -R) unlimited', 'core file size              (blocks, -c) 0', 'data seg size               (kbytes, -d) unlimited',
      'scheduling priority                 (-e) 0', 'file size                   (blocks, -f) unlimited', 'pending signals                     (-i) 15421',
      'max locked memory           (kbytes, -l) 503712', 'max memory size             (kbytes, -m) unlimited', 'open files                          (-n) 1024',
      'pipe size                (512 bytes, -p) 8', 'POSIX message queues         (bytes, -q) 819200', 'real-time priority                  (-r) 0',
      'stack size                  (kbytes, -s) 8192', 'cpu time                   (seconds, -t) unlimited', 'max user processes                  (-u) 15421',
      'virtual memory              (kbytes, -v) unlimited', 'file locks                          (-x) unlimited'].join('\n') + '\n');
    return 0;
  }
  ctx.out(args.includes('-n') ? '1024\n' : args.includes('-s') ? '8192\n' : 'unlimited\n');
  return 0;
}

function caller(ctx: Ctx): number {
  const sh = ctx.sh;
  if (!sh.funcNames.length) return 1;
  const frame = Number(ctx.argv[1] ?? '-1');
  const fn = frame < 0 ? undefined : sh.funcNames[frame + 1] ?? 'main';
  ctx.out(frame < 0 ? `${sh.lineno} ${sh.arg0}\n` : `${sh.lineno} ${fn} ${sh.arg0}\n`);
  return 0;
}

export const JOBS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['jobs', jobs], ['wait', wait], ['fg', noJob()], ['bg', noJob()], ['disown', () => 0], ['kill', kill],
  ['suspend', (c) => builtinError(c, 'cannot suspend a login shell')], ['ulimit', ulimit], ['umask', umask],
  ['times', (c) => { c.out('0m0.010s 0m0.004s\n0m0.000s 0m0.000s\n'); return 0; }], ['caller', caller],
]);
