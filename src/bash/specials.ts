/** $?, $#, $-, $!… and the dynamic variables (RANDOM, SECONDS, EPOCHREALTIME, LINENO, BASH_COMMAND…). */
import type { Interp } from './interp.ts';
import { SET_LETTERS } from './options.ts';

const FLAG_ORDER = 'abefhikmnptuvxBCEHPTs';

export function dynamicVariable(sh: Interp, name: string): string | undefined {
  const now = sh.env.now();
  switch (name) {
    case 'RANDOM': sh.rngSeed = (sh.rngSeed * 1103515245 + 12345) & 0x7fffffff; return String((sh.rngSeed >> 16) & 0x7fff);
    case 'SRANDOM': return String(Math.floor(Math.random() * 0x100000000));
    case 'SECONDS': return String(Math.floor((now - sh.startedAt) / 1000));
    case 'EPOCHSECONDS': return String(Math.floor(now / 1000));
    case 'EPOCHREALTIME': return `${Math.floor(now / 1000)}.${String((now % 1000) * 1000).padStart(6, '0')}`;
    case 'BASH_MONOSECONDS': return String(Math.floor((now - sh.startedAt) / 1000) + 1);
    case 'LINENO': return String(sh.lineno);
    case 'BASHPID': return String(sh.bashpid);
    case 'BASH_SUBSHELL': return String(sh.subshell);
    case 'BASH_COMMAND': return sh.bashCommand;
    case 'HISTCMD': return String(sh.history.base + sh.history.lines.length);
    default: return undefined;
  }
}

/** $- */
export function optionFlags(sh: Interp): string {
  const letters = Object.entries(SET_LETTERS).filter(([, o]) => sh.opt(o)).map(([l]) => l);
  if (sh.interactive) letters.push('i', 's');
  return [...new Set(letters)].sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b)).join('');
}

export function specialParameter(sh: Interp, name: string): string | readonly string[] | undefined {
  switch (name) {
    case '?': return String(sh.status);
    case '#': return String(sh.args.length);
    case '@': case '*': return sh.args;
    case '-': return optionFlags(sh);
    case '$': return String(sh.pid);
    case '!': return sh.bgPid === undefined ? undefined : String(sh.bgPid);
    case '0': return sh.arg0;
    default: return dynamicVariable(sh, name);
  }
}
