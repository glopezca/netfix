/**
 * The checkers of the mail packages: `postconf` (-n, NAME…) and `postfix check|reload|status` (Postfix 3.10),
 * `doveconf -n` (Dovecot 2.4). They read the files as the user who runs them; postfix itself is root's.
 */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { runsServices } from '../devices/kinds.ts';
import { appAvailable } from '../net/device-apps.ts';
import { checkMainCf, MAIN_CF, parseMainCf, POSTFIX_DEFAULTS } from '../services/postfix-conf.ts';
import { DOVECOT_CONF, DOVECOT_VERSION, parseDovecotConf } from '../services/dovecot-conf.ts';

/** doveconf's exit status on a fatal error (FATAL_DEFAULT). */
const DOVE_FATAL = 89;
const POSTFIX_USAGE = 'postfix: fatal: usage: postfix [-c config_dir] [-Dv] command\n';

/** The mail box of a server (its packages): without it, Ubuntu's command-not-found hint. */
function installed(ctx: Ctx, host: Host, pkg: string): boolean {
  if (runsServices(host.kind) && appAvailable(host, 'mail')) return true;
  ctx.err(`Command '${ctx.argv[0] ?? ''}' not found, but can be installed with:\nsudo apt install ${pkg}\n`);
  return false;
}

function read(ctx: Ctx, path: string): string | undefined {
  try {
    return ctx.sh.env.fs.readFile(path, ctx.cred);
  } catch {
    return undefined;
  }
}

function postconf(host: Host): CommandFn {
  return (ctx) => {
    if (!installed(ctx, host, 'postfix')) return 127;
    const text = read(ctx, MAIN_CF);
    if (text === undefined) { ctx.err(`postconf: fatal: open ${MAIN_CF}: No such file or directory\n`); return 1; }
    const cf = parseMainCf(text);
    if (cf.error !== undefined) { ctx.err(`postconf: fatal: ${cf.error}\n`); return 1; }
    const args = ctx.argv.slice(1);
    const names = args.filter((a) => !a.startsWith('-'));
    if (args.includes('-n')) {
      for (const [k, v] of [...cf.params].sort(([a], [b]) => a.localeCompare(b))) ctx.out(`${k} = ${v}\n`);
    } else {
      for (const n of names.length ? names : Object.keys(POSTFIX_DEFAULTS).sort()) {
        const v = cf.params.get(n) ?? POSTFIX_DEFAULTS[n];
        if (v === undefined) ctx.err(`postconf: warning: ${n}: unknown parameter\n`);
        else ctx.out(`${n} = ${v}\n`);
      }
    }
    for (const w of cf.warnings) ctx.err(`postconf: warning: ${w}\n`);
    return 0;
  };
}

/** postfix check (and the check reload runs first): the fatal line, or nothing. */
function checkFile(ctx: Ctx): boolean {
  const text = read(ctx, MAIN_CF);
  const c = text === undefined ? { error: `open ${MAIN_CF}: No such file or directory`, warnings: [] } : checkMainCf(text);
  for (const w of c.warnings) ctx.err(`postfix: warning: ${w}\n`);
  if (c.error !== undefined) ctx.err(`postfix: fatal: ${c.error}\n`);
  return c.error === undefined;
}

function postfix(host: Host): CommandFn {
  return (ctx) => {
    if (!installed(ctx, host, 'postfix')) return 127;
    const verb = ctx.argv.slice(1).find((a) => !a.startsWith('-'));
    if (!['check', 'reload', 'status'].includes(verb ?? '')) { ctx.err(POSTFIX_USAGE); return 1; }
    if (ctx.cred.uid !== 0) { ctx.err('postfix: fatal: the postfix command is reserved for the superuser\n'); return 1; }
    const server = host as Server;
    const running = server.services.mail.smtp;
    if (verb === 'status') {
      ctx.err(`postfix/postfix-script: the Postfix mail system is ${running ? 'running: PID: 1021' : 'not running'}\n`);
      return running ? 0 : 1;
    }
    if (!checkFile(ctx)) return 1;
    if (verb === 'check') return 0;
    if (!running) { ctx.err('postfix/postfix-script: fatal: the Postfix mail system is not running\n'); return 1; }
    ctx.err('postfix/postfix-script: refreshing the Postfix mail system\n');
    return server.reloadFiles('smtp', false) ? 1 : 0;
  };
}

function doveconf(host: Host): CommandFn {
  return (ctx) => {
    if (!installed(ctx, host, 'dovecot-core')) return 127;
    const text = read(ctx, DOVECOT_CONF);
    const c = text === undefined ? { error: `Error in configuration file ${DOVECOT_CONF}: open(${DOVECOT_CONF}) failed: Permission denied`, lines: [] } : parseDovecotConf(text);
    if (c.error !== undefined) { ctx.err(`doveconf: Fatal: ${c.error}\n`); return DOVE_FATAL; }
    // shortcut: without -n doveconf prints every default setting; Netfix prints the same as -n.
    ctx.out(`# ${DOVECOT_VERSION}: ${DOVECOT_CONF}\n# OS: Linux 6.17.0-14-generic x86_64 Ubuntu 26.04 LTS\n${c.lines.map((l) => `${l}\n`).join('')}`);
    return 0;
  };
}

/** The mail checkers, on servers. */
export function mailTools(host: Host): [string, CommandFn][] {
  return [['postconf', postconf(host)], ['postfix', postfix(host)], ['doveconf', doveconf(host)]];
}
