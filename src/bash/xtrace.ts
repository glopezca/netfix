/**
 * bash's execution trace (set -x, bash -x): every command after its expansions, behind PS4. The first character of
 * PS4 is repeated once more per level of command or process substitution (`++ echo hi` inside `$(…)`), as in bash.
 */
import type { Interp } from './interp.ts';
import type { Fds } from './types.ts';
import { writeSink } from './io.ts';
import { quoteForReuse } from './params.ts';

/** Substitution level of a shell (only what is not 0 is stored). */
const levels = new WeakMap<Interp, number>();

const levelOf = (sh: Interp): number => levels.get(sh) ?? 0;

/**
 * Runs `fn` one substitution level deeper than `sh`: in `target`, a subshell clone or `sh` itself (${ …; }), whose
 * previous level comes back afterwards.
 */
export function deeper<T>(sh: Interp, target: Interp, fn: () => T): T {
  const before = levels.get(target);
  levels.set(target, levelOf(sh) + 1);
  try {
    return fn();
  } finally {
    if (before === undefined) levels.delete(target);
    else levels.set(target, before);
  }
}

/** A subshell (or a pipeline stage) traces at the level of the shell it was cloned from. */
export function inheritTraceLevel(from: Interp, to: Interp): void {
  const level = levels.get(from);
  if (level !== undefined) levels.set(to, level);
}

/** A word as bash's trace shows it: bare when safe, otherwise in single quotes. */
export const traceWord = (s: string): string => (/^[A-Za-z0-9_./=:@%+,-]+$/.test(s) ? s : quoteForReuse(s));

/** An operand of [[ ]]: bash shows its value unquoted, and '' when it is empty. */
export const traceOperand = (s: string): string => (s === '' ? "''" : s);

/** Writes one trace line when xtrace is on (to the command's stderr, or the shell's). */
export function xtrace(sh: Interp, text: string, fds: Fds = sh.currentFds): void {
  if (!sh.opt('xtrace')) return;
  const ps4 = sh.prompt(sh.getVar('PS4') ?? '+ ');
  writeSink(sh, fds.get(2)?.write, `${(ps4[0] ?? '').repeat(levelOf(sh))}${ps4}${text}\n`);
}
