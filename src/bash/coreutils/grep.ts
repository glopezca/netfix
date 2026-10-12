/** grep / egrep / fgrep (GNU grep 3.11): -E -F -P -i -v -w -x -c -l -L -n -h -H -o -q -s -r -e -f -A -B -C -m --color. */
import type { Ctx, Gen } from '../types.ts';
import { normalize } from '../vfs.ts';
import { gnuOpts, lines, num, errMsg } from './common.ts';
import { compile, RegexError } from './regex.ts';
import { isTty } from '../io.ts';

const C = { match: '\x1b[01;31m\x1b[K', file: '\x1b[35m\x1b[K', num: '\x1b[32m\x1b[K', sep: '\x1b[36m\x1b[K', end: '\x1b[m\x1b[K' };

interface GrepOpts {
  readonly res: RegExp[];
  readonly invert: boolean;
  readonly count: boolean;
  readonly files: 'with' | 'without' | undefined;
  readonly numbers: boolean;
  readonly only: boolean;
  readonly quiet: boolean;
  readonly names: boolean;
  readonly color: boolean;
  readonly before: number;
  readonly after: number;
  readonly max: number;
}

function walk(ctx: Ctx, path: string, shown: string, out: string[]): void {
  const fs = ctx.sh.env.fs;
  const node = fs.tryLookup(path, ctx.cred);
  if (node?.kind !== 'dir') { out.push(shown); return; }
  let names: string[] = [];
  try { names = fs.readdir(path, ctx.cred); } catch { return; }
  for (const n of names) walk(ctx, normalize(n, path), shown === '.' ? n : `${shown.replace(/\/$/, '')}/${n}`, out);
}

function paintMatches(line: string, res: readonly RegExp[]): string {
  let out = '';
  let i = 0;
  for (;;) {
    let best: RegExpExecArray | null = null;
    for (const re of res) {
      const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
      g.lastIndex = i;
      const m = g.exec(line);
      if (m && m[0] !== '' && (!best || m.index < best.index)) best = m;
    }
    if (!best) return out + line.slice(i);
    out += line.slice(i, best.index) + C.match + best[0] + C.end;
    i = best.index + best[0].length;
  }
}

/** Matches of one input; returns the number of selected lines. */
function grepText(ctx: Ctx, o: GrepOpts, name: string | undefined, text: string): number {
  const all = lines(text);
  const selected = all.map((l) => o.res.some((re) => re.test(l)) !== o.invert);
  let count = 0;
  const shown = new Set<number>();
  const out: string[] = [];
  const prefix = (i: number, sep: string): string => `${name !== undefined ? (o.color ? `${C.file}${name}${C.end}${C.sep}${sep}${C.end}` : `${name}${sep}`) : ''}${o.numbers ? (o.color ? `${C.num}${i + 1}${C.end}${C.sep}${sep}${C.end}` : `${i + 1}${sep}`) : ''}`;
  let lastShown = -2;
  for (let i = 0; i < all.length && count < o.max; i++) {
    if (!selected[i]) continue;
    count++;
    if (o.count || o.files || o.quiet) continue;
    const from = Math.max(0, i - o.before);
    if ((o.before || o.after) && lastShown >= 0 && from > lastShown + 1) out.push(o.color ? `${C.sep}--${C.end}` : '--');
    for (let k = from; k < i; k++) if (!shown.has(k)) { out.push(prefix(k, '-') + (all[k] ?? '')); shown.add(k); }
    const line = all[i] ?? '';
    if (o.only && !o.invert) {
      for (const re of o.res) for (const m of line.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) if (m[0]) out.push(prefix(i, ':') + (o.color ? C.match + m[0] + C.end : m[0]));
    } else out.push(prefix(i, ':') + (o.color && !o.invert ? paintMatches(line, o.res) : line));
    shown.add(i);
    lastShown = i;
    for (let k = i + 1; k <= Math.min(all.length - 1, i + o.after); k++) {
      if (selected[k]) break;
      out.push(prefix(k, '-') + (all[k] ?? ''));
      shown.add(k);
      lastShown = k;
    }
  }
  if (o.quiet) return count;
  if (o.files === 'with' && count) ctx.out(`${o.color ? C.file + (name ?? '(standard input)') + C.end : name ?? '(standard input)'}\n`);
  else if (o.files === 'without' && !count) ctx.out(`${name ?? '(standard input)'}\n`);
  else if (o.count) ctx.out(`${name !== undefined ? `${name}:` : ''}${count}\n`);
  else if (out.length) ctx.out(`${out.join('\n')}\n`);
  return count;
}

/** The files to search: operands, or every file below them with -r. */
function targetFiles(ctx: Ctx, prog: string, ops: readonly string[], recursive: boolean, silent: boolean): string[] {
  const files: string[] = [];
  for (const f of ops.length ? ops : recursive ? ['.'] : []) {
    const node = ctx.sh.env.fs.tryLookup(ctx.resolve(f), ctx.cred);
    if (node?.kind === 'dir' && !recursive) { if (!silent) ctx.err(`${prog}: ${f}: Is a directory\n`); continue; }
    if (recursive) walk(ctx, ctx.resolve(f), f, files);
    else files.push(f);
  }
  return files;
}

export function* grep(ctx: Ctx): Gen<number> {
  const prog = ctx.argv[0] ?? 'grep';
  const p = gnuOpts(ctx.argv.slice(1), {
    flags: 'EFGPivwxclLnhHoqsrRIaUz', withArg: 'efABCm', numeric: 'C',
    long: { 'extended-regexp': 'E', 'fixed-strings': 'F', 'perl-regexp': 'P', 'ignore-case': 'i', 'invert-match': 'v', 'word-regexp': 'w', 'line-regexp': 'x', count: 'c', 'files-with-matches': 'l', 'files-without-match': 'L', 'line-number': 'n', 'no-filename': 'h', 'with-filename': 'H', 'only-matching': 'o', quiet: 'q', silent: 'q', 'no-messages': 's', recursive: 'r', 'regexp=': 'e', 'file=': 'f', 'after-context=': 'A', 'before-context=': 'B', 'context=': 'C', 'max-count=': 'm', 'color=': 'color', colour: 'color', color: 'color', 'colour=': 'color', 'include=': 'include' },
  });
  if (p.error) { ctx.err(`${prog}: ${p.error}\nUsage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n`); return 2; }
  const ops = [...p.operands];
  let patterns = p.multi.get('e') ?? [];
  const pf = p.opts.get('f');
  if (typeof pf === 'string') {
    try { patterns = [...patterns, ...lines(ctx.sh.env.fs.readFile(ctx.resolve(pf), ctx.cred))]; } catch (e) { ctx.err(`${prog}: ${pf}: ${errMsg(e)}\n`); return 2; }
  }
  if (!patterns.length) {
    if (!ops.length) { ctx.err(`Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n`); return 2; }
    patterns = (ops.shift() ?? '').split('\n');
  }
  const extended = p.opts.has('E') || prog === 'egrep';
  let res: RegExp[];
  try {
    res = patterns.map((pt) => compile(pt, { extended, fixed: p.opts.has('F') || prog === 'fgrep', perl: p.opts.has('P'), icase: p.opts.has('i'), word: p.opts.has('w'), line: p.opts.has('x') }));
  } catch (e) {
    ctx.err(`${prog}: ${e instanceof RegexError ? e.message : errMsg(e)}\n`);
    return 2;
  }
  const recursive = p.opts.has('r') || p.opts.has('R');
  const files = targetFiles(ctx, prog, ops, recursive, p.opts.has('s'));
  let failed = false;
  const color = p.opts.get('color');
  const tty = isTty(ctx.fds.get(1));
  const ctxN = num(p.opts.get('C'), 0);
  const o: GrepOpts = {
    res, invert: p.opts.has('v'), count: p.opts.has('c'), files: p.opts.has('l') ? 'with' : p.opts.has('L') ? 'without' : undefined, numbers: p.opts.has('n'), only: p.opts.has('o'),
    quiet: p.opts.has('q'), names: false, color: color === 'always' || color === true || (color === 'auto' && tty), before: num(p.opts.get('B'), ctxN), after: num(p.opts.get('A'), ctxN), max: num(p.opts.get('m'), Infinity),
  };
  const showNames = p.opts.has('H') || (!p.opts.has('h') && (files.length > 1 || recursive));
  let total = 0;
  if (!ops.length && !recursive) total += grepText(ctx, o, p.opts.has('H') ? '(standard input)' : undefined, yield* ctx.readAll());
  for (const f of files) {
    let text: string;
    try { text = ctx.sh.env.fs.readFile(ctx.resolve(f), ctx.cred); } catch (e) { failed = true; if (!p.opts.has('s')) ctx.err(`${prog}: ${f}: ${errMsg(e)}\n`); continue; }
    total += grepText(ctx, o, showNames ? f : undefined, text);
    if (o.quiet && total) return 0;
  }
  if (failed && !(o.quiet && total)) return 2;
  return total ? 0 : 1;
}
