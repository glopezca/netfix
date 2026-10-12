/** Command substitution ($(…), ${ …; }, ${| …; }) and process substitution (<(…), >(…)). */
import type { Interp } from './interp.ts';
import { DiscardSignal, ExitSignal } from './types.ts';
import { bufferSink } from './io.ts';
import { runSync } from './run-sync.ts';

export function commandSubstitution(sh: Interp, src: string, mode: 'sub' | 'cur' | 'val'): string {
  const target = mode === 'sub' ? sh.clone() : sh;
  const capture = bufferSink();
  const fds = new Map(sh.currentFds);
  if (mode !== 'val') fds.set(1, { write: capture });
  let reply = '';
  if (mode === 'val') {
    sh.vars.pushScope();
    sh.vars.declareLocal('REPLY');
  }
  try {
    target.status = runSync(target.runSource(src, fds));
  } catch (e) {
    if (e instanceof ExitSignal || (mode === 'sub' && e instanceof DiscardSignal)) target.status = e.code;
    else throw e;
  } finally {
    if (mode === 'val') { reply = sh.getVar('REPLY') ?? ''; sh.vars.popScope(); }
  }
  sh.status = target.status;
  sh.substitutions++;
  if (mode === 'val') return reply;
  return capture.chunks.join('').replace(/\n+$/, '');
}

export function processSubstitution(sh: Interp, dir: '<' | '>', src: string, path: string): void {
  if (dir === '>') { sh.env.fs.writeFile(path, ''); return; }
  const capture = bufferSink();
  const fds = new Map(sh.currentFds);
  fds.set(1, { write: capture });
  try { runSync(sh.clone().runSource(src, fds)); } catch (e) { if (!(e instanceof ExitSignal)) throw e; }
  sh.env.fs.writeFile(path, capture.chunks.join(''));
}
