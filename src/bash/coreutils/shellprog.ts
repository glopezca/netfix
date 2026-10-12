/** bash/sh/dash, sudo and su: child shells, privilege changes and nested interactive sessions. */
import type { CommandFn, Ctx, Gen, LineRead, UserInfo } from '../types.ts';
import { readLineFrom } from '../io.ts';
import { BASH_VERSION } from '../version.ts';
import { findInPath } from '../path.ts';
import { DEFAULT_PATH } from '../startup.ts';

const SUDO_GROUP = 27;
const SUDO_CACHE_MS = 15 * 60_000;
const MAX_TRIES = 3;
const sudoCache = new WeakMap<object, Map<string, number>>();

const VERSION_TEXT = `GNU bash, version ${BASH_VERSION} (x86_64-pc-linux-gnu)
Copyright (C) 2025 Free Software Foundation, Inc.
License GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>

This is free software; you are free to change and redistribute it.
There is NO WARRANTY, to the extent permitted by law.
`;

function* bash(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  if (args.includes('--version')) { ctx.out(VERSION_TEXT); return 0; }
  const flags = new Set<string>();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { i++; break; }
    if (a === '--login') { flags.add('l'); continue; }
    if (a === '--norc' || a === '--noprofile' || a === '--posix') continue;
    if (!/^-[a-zA-Z]+$/.test(a)) break;
    for (const c of a.slice(1)) flags.add(c);
  }
  const rest = args.slice(i);
  const prepare = (arg0: string, params: readonly string[]): ReturnType<Ctx['sh']['spawn']> => {
    const child = ctx.sh.spawn(arg0, params, ctx.env);
    if (flags.has('x')) child.opts.set('xtrace', true);
    if (flags.has('e')) child.opts.set('errexit', true);
    if (flags.has('u')) child.opts.set('nounset', true);
    if (flags.has('n')) child.opts.set('noexec', true);
    return child;
  };
  if (flags.has('c')) {
    if (!rest.length) { ctx.err('bash: -c: option requires an argument\n'); return 2; }
    return yield* prepare(rest[1] ?? 'bash', rest.slice(2)).runScriptText(rest[0] ?? '', ctx.fds);
  }
  if (rest.length) {
    const script = rest[0] ?? '';
    const path = script.includes('/') ? ctx.resolve(script) : ctx.sh.env.fs.exists(ctx.resolve(script)) ? ctx.resolve(script) : findInPath(ctx.sh, script) ?? ctx.resolve(script);
    let text: string;
    try { text = ctx.sh.env.fs.readFile(path, ctx.cred); } catch (e) { ctx.err(`bash: ${script}: ${e instanceof Error ? e.message : 'No such file or directory'}\n`); return 127; }
    return yield* prepare(script, rest.slice(1)).runScriptText(text, ctx.fds);
  }
  const stdin = ctx.fds.get(0)?.read;
  if (stdin?.kind === 'tty' || flags.has('i')) {
    const status = yield { kind: 'shell', user: ctx.sh.user, login: flags.has('l') };
    return Number(status ?? 0) || 0;
  }
  const text = yield* ctx.readAll();
  return yield* prepare('bash', []).runScriptText(text, ctx.fds);
}

function findUser(ctx: Ctx, name: string): UserInfo | undefined {
  return ctx.sh.env.users().find((u) => u.name === name || String(u.uid) === name.replace(/^#/, ''));
}

/** Reads a password from the controlling terminal (or stdin with sudo -S). */
function* readPassword(ctx: Ctx, prompt: string, fromStdin: boolean): Gen<LineRead | null> {
  if (fromStdin) { ctx.err(prompt); return yield* ctx.readLine('', true); }
  return yield* readLineFrom({ kind: 'tty' }, prompt, true);
}

/** Asks for a password (up to three times). True when accepted. */
function* authenticate(ctx: Ctx, account: string, prompt: string, sudoStyle: boolean, fromStdin = false): Gen<boolean> {
  const expected = ctx.sh.env.password?.(account);
  if (!ctx.sh.controllingTty && !fromStdin) {
    ctx.err(sudoStyle ? 'sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper\nsudo: a password is required\n' : 'su: must be run from a terminal\n');
    return false;
  }
  for (let t = 0; t < MAX_TRIES; t++) {
    const line = yield* readPassword(ctx, prompt, fromStdin);
    if (line === null) { ctx.err('\n'); return false; }
    if (expected !== undefined && line.text === expected) return true;
    if (!sudoStyle) return false;
    ctx.err(t < MAX_TRIES - 1 ? 'Sorry, try again.\n' : `sudo: ${MAX_TRIES} incorrect password attempts\n`);
  }
  return false;
}

function* sudo(ctx: Ctx): Gen<number> {
  const sh = ctx.sh;
  const args = [...ctx.argv.slice(1)];
  const opts = new Set<string>();
  let target = 'root';
  while (args[0]?.startsWith('-')) {
    const a = args.shift() ?? '';
    if (a === '--') break;
    if (a === '-u') { target = args.shift() ?? 'root'; continue; }
    for (const c of a.slice(1)) opts.add(c);
  }
  const me = sh.user;
  if (opts.has('k')) { sudoCache.get(sh.env)?.delete(me.name); return 0; }
  if (me.uid !== 0 && !me.groups.includes(SUDO_GROUP)) { ctx.err(`${me.name} is not in the sudoers file.\n`); return 1; }
  const cache = sudoCache.get(sh.env) ?? new Map<string, number>();
  sudoCache.set(sh.env, cache);
  const now = sh.env.now();
  const needsPassword = me.uid !== 0 && sh.env.password?.(me.name) !== undefined && (cache.get(me.name) ?? 0) < now;
  if (needsPassword && !(yield* authenticate(ctx, me.name, `[sudo] password for ${me.name}: `, true, opts.has('S')))) return 1;
  cache.set(me.name, now + SUDO_CACHE_MS);
  if (opts.has('v')) return 0;
  if (opts.has('l')) { ctx.out(`Matching Defaults entries for ${me.name} on ${sh.env.hostname}:\n    env_reset, mail_badpass, secure_path=${DEFAULT_PATH}, use_pty\n\nUser ${me.name} may run the following commands on ${sh.env.hostname}:\n    (ALL : ALL) ALL\n`); return 0; }
  const user = findUser(ctx, target);
  if (!user) { ctx.err(`sudo: unknown user ${target}\n`); return 1; }
  if (opts.has('i') || opts.has('s') || !args.length) {
    if (!args.length && !opts.has('i') && !opts.has('s')) { ctx.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [<command>]\n'); return 1; }
    const status = yield { kind: 'shell', user, login: opts.has('i') };
    return Number(status ?? 0) || 0;
  }
  const as = sh.clone();
  as.user = user;
  for (const [k, v] of [['USER', user.name], ['LOGNAME', user.name], ['HOME', user.home], ['SUDO_USER', me.name], ['SUDO_UID', String(me.uid)], ['PATH', DEFAULT_PATH]]) as.setVar(k ?? '', v ?? '', { export: true });
  const cmd = args[0] ?? '';
  if (!cmd.includes('/') && !findInPath(as, cmd)) { ctx.err(`sudo: ${cmd}: command not found\n`); return 1; }
  return yield* as.invoke(args, ctx.fds, { noFunctions: true });
}

function* su(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  const login = args.some((a) => a === '-' || a === '-l' || a === '--login');
  const cIdx = args.indexOf('-c');
  const command = cIdx >= 0 ? args[cIdx + 1] : undefined;
  const name = args.filter((a, i) => !a.startsWith('-') && i !== cIdx + 1)[0] ?? 'root';
  const user = findUser(ctx, name);
  if (!user) { ctx.err(`su: user ${name} does not exist or the user entry does not contain all the required fields\n`); return 1; }
  if (ctx.sh.user.uid !== 0) {
    const ok = yield* authenticate(ctx, user.name, 'Password: ', false);
    if (!ok) { ctx.err('su: Authentication failure\n'); return 1; }
  }
  if (command !== undefined) {
    const as = ctx.sh.clone();
    as.user = user;
    return yield* as.spawn('bash', [], ctx.env).runScriptText(command, ctx.fds);
  }
  const status = yield { kind: 'shell', user, login };
  return Number(status ?? 0) || 0;
}

export const SHELLPROG: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['bash', bash], ['sh', bash], ['rbash', bash], ['sudo', sudo], ['su', su]]);
