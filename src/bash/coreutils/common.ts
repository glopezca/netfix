/** Helpers for the GNU-style programs: option parsing, quoting in messages, input files. */
import type { Ctx, Gen } from '../types.ts';
import { FsError } from '../vfs.ts';

export interface OptSpec {
  /** Short flags without argument, e.g. "alhR". */
  readonly flags?: string;
  /** Short options taking an argument, e.g. "nk". */
  readonly withArg?: string;
  /** Long option → short letter (or a long-only key). Suffix "=" means it takes an argument. */
  readonly long?: Readonly<Record<string, string>>;
  /** Stop at the first operand (like POSIX), instead of GNU permutation. */
  readonly posix?: boolean;
  /** Accept -NUM as an option value (head -5, tail -20). */
  readonly numeric?: string;
}

export interface GnuOpts {
  readonly opts: Map<string, string | true>;
  /** Every value of repeated options (grep -e a -e b). */
  readonly multi: Map<string, string[]>;
  readonly operands: string[];
  readonly error?: string;
}

function setOpt(r: { opts: Map<string, string | true>; multi: Map<string, string[]> }, key: string, value: string | true): void {
  r.opts.set(key, value);
  if (typeof value === 'string') r.multi.set(key, [...(r.multi.get(key) ?? []), value]);
}

export function gnuOpts(args: readonly string[], spec: OptSpec): GnuOpts {
  const r = { opts: new Map<string, string | true>(), multi: new Map<string, string[]>(), operands: [] as string[] };
  const flags = spec.flags ?? '';
  const withArg = spec.withArg ?? '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { r.operands.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      const keys = Object.keys(spec.long ?? {}).filter((k) => k.replace(/=$/, '').startsWith(name));
      const exact = keys.find((k) => k.replace(/=$/, '') === name);
      const key = exact ?? (keys.length === 1 ? keys[0] : undefined);
      if (!key) return { ...r, error: keys.length > 1 ? `option '--${name}' is ambiguous` : `unrecognized option '--${name}'` };
      const target = spec.long?.[key] ?? key;
      if (key.endsWith('=')) {
        const v = inline ?? args[++i];
        if (v === undefined) return { ...r, error: `option '--${name}' requires an argument` };
        setOpt(r, target, v);
      } else setOpt(r, target, inline ?? true);
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (spec.numeric && /^-\d+$/.test(a)) { setOpt(r, spec.numeric, a.slice(1)); continue; }
      for (let j = 1; j < a.length; j++) {
        const c = a[j] ?? '';
        if (withArg.includes(c)) {
          const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (v === undefined) return { ...r, error: `option requires an argument -- '${c}'` };
          setOpt(r, c, v);
          break;
        }
        if (!flags.includes(c)) return { ...r, error: `invalid option -- '${c}'` };
        setOpt(r, c, true);
      }
      continue;
    }
    if (spec.posix) { r.operands.push(...args.slice(i)); break; }
    r.operands.push(a);
  }
  return r;
}

/** Reports a usage error the GNU way. */
export function usageError(ctx: Ctx, error: string, status = 1): number {
  const name = ctx.argv[0] ?? '';
  ctx.err(`${name}: ${error}\nTry '${name} --help' for more information.\n`);
  return status;
}

/** 'name' as GNU tools quote operands in messages. */
export function q(name: string): string {
  return /['\s\\]/.test(name) ? `'${name.replace(/'/g, "'\\''")}'` : `'${name}'`;
}

/** ‘name’ (locale quotes) used by mkdir, touch -c and others. */
export function lq(name: string): string {
  return `‘${name}’`;
}

export function errMsg(e: unknown): string {
  if (e instanceof FsError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface Input {
  readonly name: string;
  readonly text: string;
}

/** Contents of the operands ("-" or none = standard input); missing files are reported. */
export function* readInputs(ctx: Ctx, files: readonly string[], report: (name: string, e: unknown) => void = (n, e) => ctx.err(`${ctx.argv[0] ?? ''}: ${n}: ${errMsg(e)}\n`)): Gen<{ inputs: Input[]; failed: boolean }> {
  const inputs: Input[] = [];
  let failed = false;
  for (const f of files.length ? files : ['-']) {
    if (f === '-') { inputs.push({ name: '-', text: yield* ctx.readAll() }); continue; }
    try {
      inputs.push({ name: f, text: ctx.sh.env.fs.readFile(ctx.resolve(f), ctx.cred) });
    } catch (e) {
      report(f, e);
      failed = true;
    }
  }
  return { inputs, failed };
}

/** Splits text into lines without the trailing empty element. */
export function lines(text: string): string[] {
  if (text === '') return [];
  const l = text.split('\n');
  if (l[l.length - 1] === '') l.pop();
  return l;
}

export function joinLines(l: readonly string[]): string {
  return l.length ? `${l.join('\n')}\n` : '';
}

export function num(v: string | true | undefined, fallback: number): number {
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
