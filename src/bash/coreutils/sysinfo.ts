/** System information: date whoami id groups uname hostname uptime ps free env printenv which tty who w users nproc arch lsb_release clear. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { gnuOpts, usageError } from './common.ts';
import { strftime } from '../prompt.ts';
import { findInPath } from '../path.ts';
import { BUILTINS } from '../builtins/index.ts';
import { isTty } from '../io.ts';

const KERNEL = '6.17.0-14-generic';
const GROUP_NAMES: Readonly<Record<number, string>> = { 0: 'root', 4: 'adm', 24: 'cdrom', 27: 'sudo', 30: 'dip', 33: 'www-data', 46: 'plugdev', 100: 'users' };

/** Parses `date -d` strings: now, today, yesterday, tomorrow, @epoch, ISO dates, "N unit(s) ago". */
export function parseDate(text: string, now: number): number | null {
  const t = text.trim().toLowerCase();
  if (t === '' || t === 'now' || t === 'today') return now;
  if (t === 'yesterday') return now - 86_400_000;
  if (t === 'tomorrow') return now + 86_400_000;
  const epoch = /^@(-?\d+)$/.exec(t);
  if (epoch) return Number(epoch[1]) * 1000;
  const rel = /^([+-]?\d+)\s*(second|minute|hour|day|week|month|year)s?(\s+ago)?$/.exec(t);
  if (rel) {
    const unit = { second: 1e3, minute: 6e4, hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9, year: 3.1536e10 }[rel[2] as 'day'];
    return now + Number(rel[1]) * unit * (rel[3] ? -1 : 1);
  }
  const iso = Date.parse(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(t) ? `${t.replace(' ', 'T')}${t.includes(' ') ? '' : 'T00:00:00'}Z` : text);
  return Number.isNaN(iso) ? null : iso;
}

function date(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'uRI', withArg: 'ds', long: { 'date=': 'd', 'set=': 's', utc: 'u', 'rfc-email': 'R', 'iso-8601': 'I' } });
  if (p.error) return usageError(ctx, p.error);
  if (p.opts.has('s')) {
    if (ctx.cred.uid !== 0) { ctx.err('date: cannot set date: Operation not permitted\n'); return 1; }
  }
  const spec = p.opts.get('d') ?? p.opts.get('s');
  const ms = parseDate(typeof spec === 'string' ? spec : '', ctx.sh.env.now());
  if (ms === null) { ctx.err(`date: invalid date '${String(spec)}'\n`); return 1; }
  const fmtArg = p.operands.find((o) => o.startsWith('+'));
  const fmt = fmtArg ? fmtArg.slice(1) : p.opts.has('R') ? '%a, %d %b %Y %H:%M:%S +0000' : p.opts.has('I') ? '%Y-%m-%d' : '%a %b %e %H:%M:%S %Z %Y';
  ctx.out(`${strftime(fmt, ms)}\n`);
  return 0;
}

function idLine(ctx: Ctx, name?: string): string | null {
  const users = ctx.sh.env.users();
  const u = name === undefined ? users.find((x) => x.uid === ctx.cred.uid) : users.find((x) => x.name === name);
  if (!u) return null;
  const gname = (g: number): string => GROUP_NAMES[g] ?? users.find((x) => x.gid === g)?.name ?? String(g);
  const groups = [u.gid, ...u.groups.filter((g) => g !== u.gid)];
  return `uid=${u.uid}(${u.name}) gid=${u.gid}(${gname(u.gid)}) groups=${groups.map((g) => `${g}(${gname(g)})`).join(',')}`;
}

function id(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  const name = args.find((a) => !a.startsWith('-'));
  const line = idLine(ctx, name);
  if (!line) { ctx.err(`id: ‘${name ?? ''}’: no such user\n`); return 1; }
  const m = /uid=(\d+)\((\w[^)]*)\) gid=(\d+)\(([^)]*)\) groups=(.*)$/.exec(line);
  if (args.includes('-u')) ctx.out(`${args.includes('-n') ? m?.[2] : m?.[1]}\n`);
  else if (args.includes('-g')) ctx.out(`${args.includes('-n') ? m?.[4] : m?.[3]}\n`);
  else if (args.includes('-G')) ctx.out(`${(m?.[5] ?? '').split(',').map((g) => (args.includes('-n') ? /\((.*)\)/.exec(g)?.[1] : /^\d+/.exec(g)?.[0])).join(' ')}\n`);
  else ctx.out(`${line}\n`);
  return 0;
}

function uname(ctx: Ctx): number {
  const a = ctx.argv.slice(1).join('');
  const host = ctx.sh.env.hostname;
  if (a.includes('a')) { ctx.out(`Linux ${host} ${KERNEL} #14-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 25 10:12:03 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux\n`); return 0; }
  const parts: string[] = [];
  if (a.includes('s') || a === '') parts.push('Linux');
  if (a.includes('n')) parts.push(host);
  if (a.includes('r')) parts.push(KERNEL);
  if (a.includes('v')) parts.push('#14-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 25 10:12:03 UTC 2026');
  if (a.includes('m')) parts.push('x86_64');
  if (a.includes('o')) parts.push('GNU/Linux');
  ctx.out(`${parts.join(' ')}\n`);
  return 0;
}

function uptime(ctx: Ctx): number {
  const now = ctx.sh.env.now();
  const up = Math.floor((now - ctx.sh.startedAt) / 60000) + 62;
  if (ctx.argv.includes('-p')) { ctx.out(`up ${Math.floor(up / 60)} hour${Math.floor(up / 60) === 1 ? '' : 's'}, ${up % 60} minutes\n`); return 0; }
  ctx.out(` ${strftime('%H:%M:%S', now)} up ${Math.floor(up / 60)}:${String(up % 60).padStart(2, '0')},  1 user,  load average: 0.00, 0.01, 0.00\n`);
  return 0;
}

function ps(ctx: Ctx): number {
  const full = ctx.argv.slice(1).some((a) => /a|e|x|f/.test(a));
  const me = ctx.sh.user.name;
  if (!full) {
    ctx.out(`    PID TTY          TIME CMD\n${String(ctx.sh.pid).padStart(7)} pts/0    00:00:00 bash\n${String(ctx.sh.pid + 7).padStart(7)} pts/0    00:00:00 ps\n`);
    return 0;
  }
  const rows: [string, number, string][] = [['root', 1, '/sbin/init'], ['root', 312, '/usr/lib/systemd/systemd-journald'], ['root', 655, 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups'], ['root', 701, '/usr/sbin/cron -f'], [me, ctx.sh.pid, '-bash'], [me, ctx.sh.pid + 7, ctx.argv.join(' ')]];
  if (ctx.argv.some((a) => a.includes('u') || a === 'aux')) {
    ctx.out(`USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n${rows.map(([u, pid, c]) => `${u.padEnd(8)} ${String(pid).padStart(7)}  0.0  0.1  12345  6789 ${u === me ? 'pts/0   ' : '?       '} Ss   23:00   0:00 ${c}`).join('\n')}\n`);
  } else ctx.out(`UID          PID    PPID  C STIME TTY          TIME CMD\n${rows.map(([u, pid, c]) => `${u.padEnd(8)} ${String(pid).padStart(7)} ${String(pid === 1 ? 0 : 1).padStart(7)}  0 23:00 ${u === me ? 'pts/0   ' : '?       '} 00:00:00 ${c}`).join('\n')}\n`);
  return 0;
}

function free(ctx: Ctx): number {
  const h = ctx.argv.includes('-h');
  const m = ctx.argv.includes('-m');
  const v = (kb: number): string => (h ? `${(kb / 1048576).toFixed(1)}Gi` : m ? String(Math.round(kb / 1024)) : String(kb));
  ctx.out(`               total        used        free      shared  buff/cache   available\nMem:     ${[4014820, 812344, 2531108, 1204, 671368, 3202476].map((x) => v(x).padStart(11)).join(' ')}\nSwap:    ${[2097148, 0, 2097148].map((x) => v(x).padStart(11)).join(' ')}\n`);
  return 0;
}

function env(ctx: Ctx): Gen<number> | number {
  const args = ctx.argv.slice(1);
  const vars = new Map(args[0] === '-i' ? [] : ctx.env);
  let i = args[0] === '-i' ? 1 : 0;
  for (; i < args.length && /^[A-Za-z_]\w*=/.test(args[i] ?? ''); i++) { const [k, ...v] = (args[i] ?? '').split('='); vars.set(k ?? '', v.join('=')); }
  if (i < args.length) return ctx.sh.invokeEnv(args.slice(i), ctx.fds, vars);
  ctx.out([...vars].map(([k, v]) => `${k}=${v}\n`).join(''));
  return 0;
}

function printenv(ctx: Ctx): number {
  const names = ctx.argv.slice(1);
  if (!names.length) { ctx.out([...ctx.env].map(([k, v]) => `${k}=${v}\n`).join('')); return 0; }
  let status = 0;
  for (const n of names) { const v = ctx.env.get(n); if (v === undefined) status = 1; else ctx.out(`${v}\n`); }
  return status;
}

function which(ctx: Ctx): number {
  const all = ctx.argv.includes('-a');
  let status = 0;
  for (const n of ctx.argv.slice(1).filter((a) => !a.startsWith('-'))) {
    const found = all ? (ctx.sh.getVar('PATH') ?? '').split(':').map((d) => findInPath(ctx.sh, n, d)).filter((x): x is string => Boolean(x)) : [findInPath(ctx.sh, n)].filter((x): x is string => Boolean(x));
    if (!found.length) status = 1;
    for (const f of found) ctx.out(`${f}\n`);
  }
  return status;
}

const viaBuiltin = (name: string): CommandFn => (ctx) => (BUILTINS.get(name) as CommandFn)(ctx);

export const SYSINFO: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['date', date], ['id', id], ['uname', uname], ['uptime', uptime], ['ps', ps], ['free', free], ['env', env], ['printenv', printenv], ['which', which],
  ['whoami', (c) => { c.out(`${c.sh.env.users().find((u) => u.uid === c.cred.uid)?.name ?? c.sh.user.name}\n`); return 0; }],
  ['groups', (c) => { const l = idLine(c, c.argv[1]); c.out(`${(l ?? '').replace(/.*groups=/, '').split(',').map((g) => /\((.*)\)/.exec(g)?.[1]).join(' ')}\n`); return 0; }],
  ['tty', (c) => { const t = isTty(c.fds.get(0)); c.out(t ? '/dev/pts/0\n' : 'not a tty\n'); return t ? 0 : 1; }],
  ['who', (c) => { c.out(`${c.sh.user.name.padEnd(8)} pts/0        ${strftime('%Y-%m-%d %H:%M', c.sh.startedAt)}\n`); return 0; }],
  ['users', (c) => { c.out(`${c.sh.user.name}\n`); return 0; }],
  ['w', (c) => { uptime(c); c.out(`USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n${c.sh.user.name.padEnd(8)} pts/0    -                ${strftime('%H:%M', c.sh.startedAt)}    0.00s  0.01s  0.00s w\n`); return 0; }],
  ['nproc', (c) => { c.out('2\n'); return 0; }], ['arch', (c) => { c.out('x86_64\n'); return 0; }],
  ['lsb_release', (c) => { c.out(c.argv.includes('-a') ? 'Distributor ID:\tUbuntu\nDescription:\tUbuntu 26.04 LTS\nRelease:\t26.04\nCodename:\tresolute\n' : 'Ubuntu 26.04 LTS\n'); return 0; }],
  ['clear', (c) => { c.out('\x1b[H\x1b[2J\x1b[3J'); return 0; }],
  ['true', () => 0], ['false', () => 1], ['echo', viaBuiltin('echo')], ['printf', viaBuiltin('printf')], ['test', viaBuiltin('test')], ['[', viaBuiltin('[')],
  ['kill', viaBuiltin('kill')],
]);
