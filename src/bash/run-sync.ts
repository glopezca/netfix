/** Runs a generator of the interpreter to the end, answering every interaction with end of input. */
import type { Gen } from './types.ts';

export function runSync(gen: Gen<number>): number {
  let r = gen.next(null);
  while (!r.done) r = gen.next(null);
  return r.value;
}
