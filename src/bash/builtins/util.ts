/** Helpers shared by the builtins: option parsing and error output in bash's format. */
import type { Ctx } from '../types.ts';
import { builtinError } from '../io.ts';

export interface Parsed {
  /** Option letter → argument (or true). */
  readonly flags: Map<string, string | true>;
  /** Letters given with "+" (declare +x, set +o). */
  readonly plus: Set<string>;
  readonly rest: string[];
  readonly bad?: string;
}

/** Parses "-abc -d arg -- rest". `spec` lists letters; "d:" takes an argument. */
export function parseOpts(args: readonly string[], spec: string, allowPlus = false): Parsed {
  const flags = new Map<string, string | true>();
  const plus = new Set<string>();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { i++; break; }
    const sign = a[0];
    if (a.length < 2 || (sign !== '-' && !(allowPlus && sign === '+')) || /^-[0-9]/.test(a) && !spec.includes(a[1] ?? '')) break;
    for (let j = 1; j < a.length; j++) {
      const c = a[j] ?? '';
      const at = spec.indexOf(c);
      if (at < 0) return { flags, plus, rest: args.slice(i), bad: `${sign}${c}` };
      if (spec[at + 1] === ':') {
        const value = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (value === undefined) return { flags, plus, rest: [], bad: `${sign}${c}:` };
        flags.set(c, value);
        break;
      }
      if (sign === '+') plus.add(c);
      else flags.set(c, true);
    }
  }
  return { flags, plus, rest: args.slice(i) };
}

/** Reports an invalid option like bash: `bash: name: -q: invalid option` + usage line (status 2). */
export function badOption(ctx: Ctx, bad: string, usage: string): number {
  if (bad.endsWith(':')) builtinError(ctx, `${bad.slice(0, -1)}: option requires an argument`, 2);
  else builtinError(ctx, `${bad}: invalid option`, 2);
  ctx.err(`${ctx.argv[0] ?? ''}: usage: ${usage}\n`);
  return 2;
}

export function flagStr(p: Parsed, c: string): string | undefined {
  const v = p.flags.get(c);
  return typeof v === 'string' ? v : undefined;
}

/** Quotes a value the way `set`, `declare -p` and `alias` print it. */
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  if (!/'/.test(s)) return `'${s}'`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** `$'…'` quoting for values with control characters (used by %q and set). */
export function ansiQuote(s: string): string {
  if (!/[\x00-\x1f\x7f]/.test(s)) return shellQuote(s);
  const body = s.replace(/[\\']/g, '\\$&').replace(/[\x00-\x1f\x7f]/g, (c) => {
    const named: Record<string, string> = { '\n': '\\n', '\t': '\\t', '\r': '\\r', '\x1b': '\\E', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\v': '\\v' };
    return named[c] ?? `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`;
  });
  return `$'${body}'`;
}
