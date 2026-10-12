/** man, less/more, shuf and tree. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { gnuOpts, readInputs, usageError } from './common.ts';
import { manPage, apropos } from '../../docs/index.ts';
import { BUILTIN_DOCS } from '../../docs/bash-builtins.ts';
import { normalize } from '../vfs.ts';

function man(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (args[0] === '-k' || args[0] === '--apropos') {
    const hits = apropos(args[1] ?? '');
    if (!hits.length) { ctx.err(`${args[1] ?? ''}: nothing appropriate.\n`); return 16; }
    ctx.out(`${hits.join('\n')}\n`);
    return 0;
  }
  const names = args.filter((a) => !/^(-.*|[1-9])$/.test(a));
  if (!names.length) { ctx.err('What manual page do you want?\nFor example, try \'man man\'.\n'); return 1; }
  let status = 0;
  for (const n of names) {
    const page = manPage(n);
    if (page) { ctx.out(page); continue; }
    ctx.err(`No manual entry for ${n}\n`);
    if (BUILTIN_DOCS[n]) ctx.err(`(${n} es una orden interna de bash: prueba «help ${n}»)\n`);
    status = 16;
  }
  return status;
}

/** Without a real pager the terminal shows everything (like less when the output is not a terminal). */
function* pager(ctx: Ctx): Gen<number> {
  const files = ctx.argv.slice(1).filter((a) => !a.startsWith('-') || a === '-');
  const { inputs, failed } = yield* readInputs(ctx, files);
  for (const i of inputs) ctx.out(i.text);
  return failed ? 1 : 0;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

function* shuf(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'ez', withArg: 'ni', long: { echo: 'e', 'head-count=': 'n', 'input-range=': 'i' } });
  if (p.error) return usageError(ctx, p.error);
  let lines: string[];
  const range = p.opts.get('i');
  if (typeof range === 'string') {
    const m = /^(\d+)-(\d+)$/.exec(range);
    if (!m || Number(m[2]) < Number(m[1]) - 1) { ctx.err(`shuf: invalid input range: ‘${range}’\n`); return 1; }
    const lo = Number(m[1]);
    lines = Array.from({ length: Math.min(100_000, Number(m[2]) - lo + 1) }, (_, k) => String(lo + k));
  } else if (p.opts.has('e')) lines = [...p.operands];
  else {
    const { inputs, failed } = yield* readInputs(ctx, p.operands.slice(0, 1));
    if (failed) return 1;
    lines = inputs.map((i) => i.text).join('').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
  }
  const n = p.opts.get('n');
  const out = shuffle(lines).slice(0, typeof n === 'string' ? Math.max(0, Number(n) || 0) : undefined);
  if (out.length) ctx.out(`${out.join('\n')}\n`);
  return 0;
}

function tree(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'adf', withArg: 'L' });
  if (p.error) return usageError(ctx, p.error);
  const depth = typeof p.opts.get('L') === 'string' ? Number(p.opts.get('L')) : Infinity;
  if (!(depth > 0)) { ctx.err('tree: Invalid level, must be greater than 0.\n'); return 1; }
  const fs = ctx.sh.env.fs;
  const counts = { dirs: 0, files: 0 };
  const lines: string[] = [];
  const walk = (abs: string, shown: string, prefix: string, level: number): void => {
    let names: string[] = [];
    try { names = fs.readdir(abs, ctx.cred).filter((n) => p.opts.has('a') || !n.startsWith('.')).sort(); } catch { return; }
    const entries = names.map((n) => ({ n, abs: normalize(n, abs), dir: fs.tryLookup(normalize(n, abs), ctx.cred)?.kind === 'dir' })).filter((e) => e.dir || !p.opts.has('d'));
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${p.opts.has('f') ? `${shown}/${e.n}` : e.n}`);
      if (!e.dir) { counts.files++; return; }
      counts.dirs++;
      if (level < depth) walk(e.abs, `${shown}/${e.n}`, `${prefix}${last ? '    ' : '│   '}`, level + 1);
    });
  };
  for (const root of p.operands.length ? p.operands : ['.']) {
    const abs = ctx.resolve(root);
    if (fs.tryLookup(abs, ctx.cred)?.kind !== 'dir') { lines.push(`${root}  [error opening dir]`); continue; }
    lines.push(root);
    walk(abs, root, '', 1);
  }
  const d = counts.dirs;
  const f = counts.files;
  ctx.out(`${lines.join('\n')}\n\n${d} director${d === 1 ? 'y' : 'ies'}${p.opts.has('d') ? '' : `, ${f} file${f === 1 ? '' : 's'}`}\n`);
  return 0;
}

export const EXTRA: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['man', man], ['less', pager], ['more', pager], ['shuf', shuf], ['tree', tree],
]);
