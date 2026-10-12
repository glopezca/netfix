/** history fc alias unalias trap compgen complete compopt bind. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { builtinError } from '../io.ts';
import { parseOpts, badOption, flagStr, shellQuote } from './util.ts';
import { strftime } from '../prompt.ts';
import { matchPattern } from '../glob.ts';
import { KEYWORDS } from './info.ts';
import { FsError } from '../vfs.ts';

export const SIGNALS = ['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STKFLT', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'IO', 'PWR', 'SYS'];

/** Normalises a signal spec to its name (EXIT, ERR, DEBUG, RETURN or SIGxxx without prefix). */
export function signalName(spec: string): string | undefined {
  const s = spec.toUpperCase().replace(/^SIG/, '');
  if (['EXIT', 'ERR', 'DEBUG', 'RETURN'].includes(s)) return s;
  if (/^\d+$/.test(s)) return Number(s) === 0 ? 'EXIT' : SIGNALS[Number(s) - 1];
  return SIGNALS.includes(s) ? s : undefined;
}

function history(ctx: Ctx): number {
  const sh = ctx.sh;
  const h = sh.history;
  const p = parseOpts(ctx.argv.slice(1), 'cd:anrwps');
  if (p.bad) return badOption(ctx, p.bad, 'history [-c] [-d offset] [n] or history -anrw [filename] or history -ps arg [arg...]');
  if (p.flags.has('c')) { h.lines.splice(0); return 0; }
  const del = flagStr(p, 'd');
  if (del !== undefined) {
    const i = Number(del) - h.base;
    if (!Number.isInteger(i) || i < 0 || i >= h.lines.length) return builtinError(ctx, `${del}: history position out of range`);
    h.lines.splice(i, 1);
    return 0;
  }
  if (p.flags.has('s')) { h.lines.push(p.rest.join(' ')); return 0; }
  if (p.flags.has('p')) { ctx.out(p.rest.map((a) => `${sh.historyExpand(a) ?? a}\n`).join('')); return 0; }
  const file = p.rest[0] ?? sh.getVar('HISTFILE') ?? '';
  try {
    if (p.flags.has('w') || p.flags.has('a')) { sh.env.fs.writeFile(sh.resolvePath(file), h.lines.map((l) => `${l}\n`).join(''), sh.cred, p.flags.has('a')); return 0; }
    if (p.flags.has('r') || p.flags.has('n')) { h.lines.push(...sh.env.fs.readFile(sh.resolvePath(file), sh.cred).split('\n').filter(Boolean)); return 0; }
  } catch (e) {
    if (e instanceof FsError) return builtinError(ctx, `${file}: ${e.message}`);
    throw e;
  }
  const n = p.rest[0] !== undefined ? Number(p.rest[0]) : h.lines.length;
  if (!Number.isInteger(n) || n < 0) return builtinError(ctx, `${p.rest[0] ?? ''}: numeric argument required`);
  const fmt = sh.getVar('HISTTIMEFORMAT');
  const start = Math.max(0, h.lines.length - n);
  h.lines.slice(start).forEach((l, i) => ctx.out(`${String(h.base + start + i).padStart(5)}  ${fmt ? strftime(fmt, sh.env.now()) : ''}${l}\n`));
  return 0;
}

function* fc(ctx: Ctx): Gen<number> {
  const sh = ctx.sh;
  const p = parseOpts(ctx.argv.slice(1), 'e:lnrs');
  if (p.bad) return badOption(ctx, p.bad, 'fc [-e ename] [-lnr] [first] [last] or fc -s [pat=rep] [command]');
  const lines = sh.history.lines;
  if (p.flags.has('s')) {
    const sub = p.rest.find((a) => a.includes('='));
    const prefix = p.rest.find((a) => !a.includes('='));
    let cmd = [...lines].reverse().slice(1).find((l) => !prefix || l.startsWith(prefix));
    if (cmd === undefined) return builtinError(ctx, 'no command found');
    if (sub) { const [a, b] = sub.split('='); cmd = cmd.replace(a ?? '', b ?? ''); }
    ctx.err(`${cmd}\n`);
    return yield* sh.runSource(cmd, ctx.fds);
  }
  if (!p.flags.has('l')) return builtinError(ctx, 'Netfix: la edición con fc no está disponible; usa fc -l o fc -s');
  const all = lines.slice(0, -1).map((l, i) => ({ n: sh.history.base + i, l }));
  let list = all.slice(-16);
  if (p.rest[0] !== undefined) {
    const first = Number(p.rest[0]);
    const last = p.rest[1] !== undefined ? Number(p.rest[1]) : all[all.length - 1]?.n ?? first;
    const a = first < 0 ? (all[all.length + first]?.n ?? 0) : first;
    list = all.filter((x) => x.n >= Math.min(a, last) && x.n <= Math.max(a, last));
  }
  if (p.flags.has('r')) list.reverse();
  ctx.out(list.map((x) => (p.flags.has('n') ? `\t ${x.l}\n` : `${x.n}\t ${x.l}\n`)).join(''));
  return 0;
}

const aliasLine = (name: string, value: string): string => `alias ${name}='${value.replace(/'/g, "'\\''")}'`;

function alias(ctx: Ctx): number {
  const sh = ctx.sh;
  const args = ctx.argv.slice(1).filter((a) => a !== '-p' && a !== '--');
  if (!args.length) {
    for (const [k, v] of [...sh.aliases].sort((a, b) => (a[0] < b[0] ? -1 : 1))) ctx.out(`${aliasLine(k, v)}\n`);
    return 0;
  }
  let status = 0;
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0) {
      const name = a.slice(0, eq);
      if (/[\s/$`=|&;()<>'"\\]/.test(name)) { builtinError(ctx, `\`${name}': invalid alias name`); status = 1; continue; }
      sh.aliases.set(name, a.slice(eq + 1));
      sh.aliasLine.set(name, sh.inputLine);
      continue;
    }
    const v = sh.aliases.get(a);
    if (v === undefined) { builtinError(ctx, `${a}: not found`); status = 1; } else ctx.out(`${aliasLine(a, v)}\n`);
  }
  return status;
}

function unalias(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (args[0] === '-a') { ctx.sh.aliases.clear(); return 0; }
  if (!args.length) { ctx.err(`unalias: usage: unalias [-a] name [name ...]\n`); return 2; }
  let status = 0;
  for (const a of args) if (!ctx.sh.aliases.delete(a)) { builtinError(ctx, `${a}: not found`); status = 1; }
  return status;
}

function trapList(ctx: Ctx, names?: readonly string[]): number {
  for (const [sig, action] of ctx.sh.traps) {
    if (names && !names.includes(sig)) continue;
    ctx.out(`trap -- '${action.replace(/'/g, "'\\''")}' ${['EXIT', 'ERR', 'DEBUG', 'RETURN'].includes(sig) ? sig : `SIG${sig}`}\n`);
  }
  return 0;
}

function trap(ctx: Ctx): number {
  const sh = ctx.sh;
  const args = ctx.argv.slice(1);
  if (args[0] === '-l') {
    ctx.out(`${SIGNALS.map((s, i) => `${String(i + 1).padStart(2)}) SIG${s}`).reduce((acc, s, i) => acc + s + ((i + 1) % 5 === 0 ? '\n' : '\t'), '').trimEnd()}\n`);
    return 0;
  }
  if (!args.length) return trapList(ctx);
  if (args[0] === '-p') return trapList(ctx, args.slice(1).map((a) => signalName(a) ?? a));
  const rest = args[0] === '--' ? args.slice(1) : args;
  const resetAll = rest.length === 1 || rest[0] === '-' || /^\d+$/.test(rest[0] ?? '');
  const action = resetAll ? '-' : rest[0] ?? '';
  const sigs = resetAll && rest[0] !== '-' ? rest : rest.slice(1);
  let status = 0;
  for (const s of sigs) {
    const name = signalName(s);
    if (!name) { builtinError(ctx, `${s}: invalid signal specification`); status = 1; continue; }
    if (action === '-') sh.traps.delete(name);
    else sh.traps.set(name, action);
  }
  return status;
}

function candidates(ctx: Ctx, p: ReturnType<typeof parseOpts>): string[] {
  const sh = ctx.sh;
  const out: string[] = [];
  const actions = new Set([...p.flags.keys()]);
  const action = flagStr(p, 'A');
  if (action) actions.add({ alias: 'a', builtin: 'b', command: 'c', directory: 'd', export: 'e', file: 'f', function: 'F', keyword: 'k', user: 'u', variable: 'v' }[action] ?? action);
  const fileNames = (dirsOnly: boolean): string[] => {
    const word = p.rest[0] ?? '';
    const dir = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : '';
    try {
      return sh.env.fs.readdir(sh.resolvePath(dir || '.'), sh.cred).filter((n) => !dirsOnly || sh.env.fs.tryLookup(sh.resolvePath(dir + n))?.kind === 'dir').map((n) => dir + n);
    } catch { return []; }
  };
  if (actions.has('a')) out.push(...sh.aliases.keys());
  if (actions.has('b')) out.push(...sh.builtinNames());
  if (actions.has('k')) out.push(...KEYWORDS);
  if (actions.has('F')) out.push(...sh.functions.keys());
  if (actions.has('c')) out.push(...sh.commandNames());
  if (actions.has('v')) out.push(...sh.vars.visible().map(([k]) => k));
  if (actions.has('e')) out.push(...sh.vars.exported().keys());
  if (actions.has('u')) out.push(...sh.env.users().map((u) => u.name));
  if (actions.has('f')) out.push(...fileNames(false));
  if (actions.has('d')) out.push(...fileNames(true));
  const wl = flagStr(p, 'W');
  if (wl !== undefined) out.push(...sh.expander.words([{ raw: wl }]).flatMap((w) => w.split(/\s+/)).filter(Boolean));
  const glob = flagStr(p, 'G');
  if (glob !== undefined) out.push(...sh.expander.words([{ raw: glob }]));
  return out;
}

function compgen(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'abcdefgjksuvo:A:G:W:F:C:X:P:S:V:');
  if (p.bad) return badOption(ctx, p.bad, 'compgen [-V varname] [-abcdefgjksuv] [-o option] [-A action] [-G globpat] [-W wordlist] [-F function] [-C command] [-X filterpat] [-P prefix] [-S suffix] [word]');
  const word = p.rest[0] ?? '';
  const filter = flagStr(p, 'X');
  const list = [...new Set(candidates(ctx, p))].filter((c) => c.startsWith(word)).filter((c) => !filter || (filter.startsWith('!') ? matchPattern(filter.slice(1), c) : !matchPattern(filter, c)))
    .map((c) => `${flagStr(p, 'P') ?? ''}${c}${flagStr(p, 'S') ?? ''}`);
  const target = flagStr(p, 'V');
  if (target) ctx.sh.vars.setArray(target, list.map((value) => ({ value })), false);
  else ctx.out(list.map((c) => `${c}\n`).join(''));
  return list.length ? 0 : 1;
}

function complete(ctx: Ctx): number {
  const sh = ctx.sh;
  const args = ctx.argv.slice(1);
  if (!args.length || args[0] === '-p') {
    for (const [cmd, spec] of sh.completions) ctx.out(`complete ${spec} ${cmd}\n`);
    return 0;
  }
  if (args[0] === '-r') { for (const n of args.slice(1)) sh.completions.delete(n); if (args.length === 1) sh.completions.clear(); return 0; }
  const names: string[] = [];
  const spec: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a.startsWith('-')) { spec.push(a); if (/^-[oAGWFCXPS]$/.test(a)) spec.push(shellQuote(args[++i] ?? '')); } else names.push(a);
  }
  for (const n of names) sh.completions.set(n, spec.join(' '));
  return 0;
}

export const HIST: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['history', history], ['fc', fc], ['alias', alias], ['unalias', unalias], ['trap', trap],
  ['compgen', compgen], ['complete', complete], ['compopt', () => 0], ['bind', () => 0],
]);
