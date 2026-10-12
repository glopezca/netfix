/** Initial variables of a bash process (login environment on Ubuntu 26.04). */
import type { Interp } from './interp.ts';
import { BASH_VERSION, BASH_VERSINFO } from './version.ts';

export const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

function setDefault(sh: Interp, name: string, value: string, exported = false): void {
  if (sh.vars.get(name)?.value === undefined) sh.setVar(name, value, { export: exported });
  else if (exported) sh.vars.get(name)?.attrs.add('x');
}

function readonlyVar(sh: Interp, name: string, value: string): void {
  sh.setVar(name, value);
  sh.vars.get(name)?.attrs.add('r');
}

/** `env` = inherited environment (child shells); without it a login environment is built. */
export function initVariables(sh: Interp, env?: ReadonlyMap<string, string>): void {
  const u = sh.user;
  for (const [k, v] of env ?? []) {
    if (!['UID', 'EUID', 'PPID', 'BASH_VERSINFO'].includes(k)) sh.setVar(k, v, { export: true });
  }
  if (!env) {
    for (const [k, v] of [['HOME', u.home], ['USER', u.name], ['LOGNAME', u.name], ['SHELL', u.shell], ['PATH', DEFAULT_PATH], ['LANG', 'C.UTF-8'],
      ['MAIL', `/var/mail/${u.name}`], ['TERM', 'xterm-256color']] as const) setDefault(sh, k, v, true);
  }
  sh.setVar('SHLVL', String(Number(env?.get('SHLVL') ?? 0) + 1), { export: true });
  for (const [k, v] of [['BASH', '/usr/bin/bash'], ['BASH_VERSION', BASH_VERSION], ['HOSTNAME', sh.env.hostname], ['HOSTTYPE', 'x86_64'],
    ['MACHTYPE', 'x86_64-pc-linux-gnu'], ['OSTYPE', 'linux-gnu'], ['IFS', ' \t\n'], ['PS2', '> '], ['PS4', '+ '], ['OPTIND', '1'], ['OPTERR', '1'],
    ['COLUMNS', '80'], ['LINES', '24'], ['HISTFILE', `${u.home}/.bash_history`], ['HISTSIZE', '1000'], ['HISTFILESIZE', '2000']] as const) setDefault(sh, k, v);
  setDefault(sh, 'PWD', sh.cwd, true);
  if (sh.vars.get('BASH_VERSINFO')?.value === undefined) {
    sh.vars.setArray('BASH_VERSINFO', BASH_VERSINFO.map((value) => ({ value })), false);
    sh.vars.get('BASH_VERSINFO')?.attrs.add('r');
  }
  readonlyVar(sh, 'UID', String(u.uid));
  readonlyVar(sh, 'EUID', String(u.uid));
  readonlyVar(sh, 'PPID', String(sh.pid - 1));
  sh.vars.setArray('GROUPS', [u.gid, ...u.groups.filter((g) => g !== u.gid)].map((g) => ({ value: String(g) })), false);
}
