/** Runs bash source text line by line, as bash reads scripts, with its syntax error reports. */
import type { List } from './ast.ts';
import type { Interp } from './interp.ts';
import type { Fds, Gen } from './types.ts';
import { DiscardSignal } from './types.ts';
import { Parser } from './parser.ts';
import { BashSyntaxError, IncompleteInput } from './lexer.ts';
import { execList } from './exec.ts';

function reportSyntax(sh: Interp, e: Error, lines: readonly string[]): void {
  if (e instanceof IncompleteInput) {
    sh.lineno = lines.length;
    sh.error('syntax error: unexpected end of file');
    return;
  }
  const line = (e as BashSyntaxError).line || sh.lineno;
  sh.lineno = line;
  sh.error(e.message);
  if (!sh.interactive) sh.error(`\`${lines[line - 1] ?? ''}'`);
}

/** `topLevel`: errors that discard the rest of a line (bad substitution…) do not stop the script. */
export function* runSourceText(sh: Interp, src: string, fds: Fds, topLevel: boolean): Gen<number> {
  const parser = new Parser(src);
  const lines = src.split('\n');
  let status = sh.status;
  for (;;) {
    let list: List | null;
    try {
      list = parser.parseLine();
    } catch (e) {
      if (!(e instanceof BashSyntaxError) && !(e instanceof IncompleteInput)) throw e;
      reportSyntax(sh, e, lines);
      sh.status = 2;
      return 2;
    }
    if (!list) return status;
    sh.inputLine++;
    // bash -n, set -n: read and check the syntax, run nothing (an interactive shell ignores it).
    if (sh.opt('noexec') && !sh.interactive) { status = 0; continue; }
    try {
      status = yield* execList(sh, list, fds);
    } catch (e) {
      if (!(e instanceof DiscardSignal) || !topLevel) throw e;
      status = e.code;
    }
    sh.status = status;
  }
}
