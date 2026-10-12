/** Text filters: head tail wc sort uniq cut tr nl rev tac paste fold tee comm. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { gnuOpts, usageError, readInputs, lines, joinLines, num, q, errMsg } from './common.ts';
import type { Input } from './common.ts';
import { sortLines } from './sort.ts';

function headers(inputs: readonly Input[], quiet: boolean): (i: number) => string {
  return (i) => (inputs.length > 1 && !quiet ? `${i > 0 ? '\n' : ''}==> ${inputs[i]?.name === '-' ? 'standard input' : inputs[i]?.name ?? ''} <==\n` : '');
}

function* head(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'qv', withArg: 'nc', numeric: 'n', long: { 'lines=': 'n', 'bytes=': 'c', quiet: 'q' } });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands, (n, e) => ctx.err(`head: cannot open ${q(n)} for reading: ${errMsg(e)}\n`));
  const hdr = headers(inputs, p.opts.has('q'));
  inputs.forEach((inp, i) => {
    let out: string;
    const c = p.opts.get('c');
    if (typeof c === 'string') { const n = Number(c); out = n < 0 ? inp.text.slice(0, n) : inp.text.slice(0, n); }
    else {
      const n = num(p.opts.get('n'), 10);
      const l = lines(inp.text);
      out = joinLines(n < 0 ? l.slice(0, Math.max(0, l.length + n)) : l.slice(0, n));
      if (!inp.text.endsWith('\n') && n >= l.length && out.endsWith('\n')) out = out.slice(0, -1);
    }
    ctx.out(hdr(i) + out);
  });
  return failed ? 1 : 0;
}

function* tail(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'qvfF', withArg: 'nc', numeric: 'n', long: { 'lines=': 'n', 'bytes=': 'c', follow: 'f', quiet: 'q' } });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands, (n, e) => ctx.err(`tail: cannot open ${q(n)} for reading: ${errMsg(e)}\n`));
  const hdr = headers(inputs, p.opts.has('q'));
  inputs.forEach((inp, i) => {
    const c = p.opts.get('c');
    if (typeof c === 'string') { ctx.out(hdr(i) + (c.startsWith('+') ? inp.text.slice(Number(c) - 1) : inp.text.slice(-Number(c)))); return; }
    const spec = String(p.opts.get('n') ?? '10');
    const l = lines(inp.text);
    const sel = spec.startsWith('+') ? l.slice(Math.max(0, Number(spec) - 1)) : l.slice(Math.max(0, l.length - Math.abs(Number(spec))));
    let out = joinLines(sel);
    if (!inp.text.endsWith('\n') && out.endsWith('\n') && sel.length) out = out.slice(0, -1);
    ctx.out(hdr(i) + out);
  });
  return failed ? 1 : 0;
}

function* wc(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'lwcmL', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm', 'max-line-length': 'L' } });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  const want = ['l', 'w', 'm', 'c', 'L'].filter((c) => p.opts.has(c));
  const keys = want.length ? want : ['l', 'w', 'c'];
  const count = (t: string): Record<string, number> => ({
    l: (t.match(/\n/g) ?? []).length, w: t.split(/\s+/).filter(Boolean).length, c: new TextEncoder().encode(t).length, m: Array.from(t).length,
    L: Math.max(0, ...t.split('\n').map((x) => Array.from(x).length)),
  });
  const rows = inputs.map((i) => ({ name: i.name === '-' && !p.operands.length ? '' : i.name, c: count(i.text) }));
  if (rows.length > 1) rows.push({ name: 'total', c: Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + (r.c[k] ?? 0), 0)])) });
  const fromStdin = inputs.some((i) => i.name === '-');
  const totalBytes = inputs.reduce((s, i) => s + new TextEncoder().encode(i.text).length, 0);
  const width = keys.length === 1 && rows.length === 1 ? 1 : Math.max(fromStdin ? 7 : 1, String(totalBytes).length);
  for (const r of rows) ctx.out(`${keys.map((k) => String(r.c[k] ?? 0).padStart(width)).join(' ')}${r.name ? ` ${r.name}` : ''}\n`);
  return failed ? 1 : 0;
}

function* sort(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'nrufbhVMsgcCzR', withArg: 'ktoT', long: { numeric: 'n', reverse: 'r', unique: 'u', 'ignore-case': 'f', 'key=': 'k', 'field-separator=': 't', 'output=': 'o', 'human-numeric-sort': 'h', 'version-sort': 'V', check: 'c' } });
  if (p.error) return usageError(ctx, p.error, 2);
  const { inputs, failed } = yield* readInputs(ctx, p.operands, (n, e) => ctx.err(`sort: cannot read: ${n}: ${errMsg(e)}\n`));
  if (failed) return 2;
  const all = inputs.flatMap((i) => lines(i.text));
  const sorted = sortLines(all, p.opts, p.multi.get('k') ?? []);
  if (p.opts.has('c') || p.opts.has('C')) {
    const bad = all.findIndex((l, i) => i > 0 && l !== sorted[i]);
    if (bad < 0) return 0;
    if (p.opts.has('c')) ctx.err(`sort: -:${bad + 1}: disorder: ${all[bad] ?? ''}\n`);
    return 1;
  }
  const out = joinLines(sorted);
  const o = p.opts.get('o');
  if (typeof o === 'string') { ctx.sh.env.fs.writeFile(ctx.resolve(o), out, ctx.cred); return 0; }
  ctx.out(out);
  return 0;
}

function* uniq(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'cduiDz', withArg: 'fsw', long: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i', 'skip-fields=': 'f', 'skip-chars=': 's' } });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands.slice(0, 1));
  const key = (l: string): string => {
    let k = l;
    const f = num(p.opts.get('f'), 0);
    if (f) k = k.replace(new RegExp(`^(\\s*\\S+){${f}}`), '');
    k = k.slice(num(p.opts.get('s'), 0));
    if (p.opts.has('w')) k = k.slice(0, num(p.opts.get('w'), k.length));
    return p.opts.has('i') ? k.toLowerCase() : k;
  };
  const groups: { line: string; n: number }[] = [];
  for (const l of lines(inputs[0]?.text ?? '')) {
    const last = groups[groups.length - 1];
    if (last && key(last.line) === key(l)) last.n++;
    else groups.push({ line: l, n: 1 });
  }
  const sel = groups.filter((g) => (p.opts.has('d') ? g.n > 1 : p.opts.has('u') ? g.n === 1 : true));
  const out = joinLines(sel.map((g) => (p.opts.has('c') ? `${String(g.n).padStart(7)} ${g.line}` : g.line)));
  if (p.operands[1]) ctx.sh.env.fs.writeFile(ctx.resolve(p.operands[1]), out, ctx.cred);
  else ctx.out(out);
  return failed ? 1 : 0;
}

/** Parses a cut list ("1,3-5,7-") into a predicate on 1-based positions. */
function cutList(spec: string): ((i: number) => boolean) | null {
  const ranges: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d*)-?(\d*)$/.exec(part);
    if (!m || part === '' || part === '-') return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = part.includes('-') ? (m[2] ? Number(m[2]) : Infinity) : a;
    if (a < 1) return null;
    ranges.push([a, b]);
  }
  return (i) => ranges.some(([a, b]) => i >= a && i <= b);
}

function* cut(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'sn', withArg: 'dfcb', long: { 'delimiter=': 'd', 'fields=': 'f', 'characters=': 'c', 'bytes=': 'b', complement: 'complement', 'only-delimited': 's', 'output-delimiter=': 'out' } });
  if (p.error) return usageError(ctx, p.error);
  const listSpec = p.opts.get('f') ?? p.opts.get('c') ?? p.opts.get('b');
  if (typeof listSpec !== 'string') return usageError(ctx, 'you must specify a list of bytes, characters, or fields');
  const sel0 = cutList(listSpec);
  if (!sel0) { ctx.err(`cut: invalid field range\nTry 'cut --help' for more information.\n`); return 1; }
  const sel = p.opts.has('complement') ? (i: number): boolean => !sel0(i) : sel0;
  const delim = typeof p.opts.get('d') === 'string' ? String(p.opts.get('d')) : '\t';
  if (delim.length !== 1) { ctx.err('cut: the delimiter must be a single character\nTry \'cut --help\' for more information.\n'); return 1; }
  const outDelim = typeof p.opts.get('out') === 'string' ? String(p.opts.get('out')) : delim;
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  const result: string[] = [];
  for (const l of inputs.flatMap((i) => lines(i.text))) {
    if (p.opts.has('f')) {
      if (!l.includes(delim)) { if (!p.opts.has('s')) result.push(l); continue; }
      result.push(l.split(delim).filter((_, i) => sel(i + 1)).join(outDelim));
    } else result.push(Array.from(l).filter((_, i) => sel(i + 1)).join(''));
  }
  ctx.out(joinLines(result));
  return failed ? 1 : 0;
}

const BASE_CLASSES: Readonly<Record<string, string>> = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digit: '0123456789', space: ' \t\n\r\v\f', blank: ' \t',
  punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', cntrl: Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('') + '\x7f',
};
const ALPHA = (BASE_CLASSES.upper ?? '') + (BASE_CLASSES.lower ?? '');
const TR_CLASSES: Readonly<Record<string, string>> = { ...BASE_CLASSES, alpha: ALPHA, alnum: ALPHA + (BASE_CLASSES.digit ?? ''), xdigit: '0123456789ABCDEFabcdef' };

export function trSet(spec: string): string[] {
  const unesc = spec.replace(/\\([0-7]{1,3}|.)/g, (_m, c: string) => (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: '\n', t: '\t', r: '\r', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v' } as Record<string, string>)[c] ?? c));
  const out: string[] = [];
  const chars = Array.from(unesc);
  for (let i = 0; i < chars.length; i++) {
    const cls = /^\[:([a-z]+):\]/.exec(chars.slice(i).join(''));
    if (cls && TR_CLASSES[cls[1] ?? '']) { out.push(...Array.from(TR_CLASSES[cls[1] ?? ''] ?? '')); i += cls[0].length - 1; continue; }
    if (chars[i + 1] === '-' && chars[i + 2] !== undefined) {
      const a = (chars[i] ?? '').codePointAt(0) ?? 0;
      const b = (chars[i + 2] ?? '').codePointAt(0) ?? 0;
      for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
      i += 2;
      continue;
    }
    out.push(chars[i] ?? '');
  }
  return out;
}

function* tr(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'dscCt', long: { delete: 'd', 'squeeze-repeats': 's', complement: 'c' }, posix: true });
  if (p.error) return usageError(ctx, p.error);
  const [s1, s2] = p.operands;
  if (s1 === undefined || (!p.opts.has('d') && !p.opts.has('s') && s2 === undefined)) return usageError(ctx, s1 === undefined ? 'missing operand' : `missing operand after ${q(s1)}`);
  const text = yield* ctx.readAll();
  const set1 = trSet(s1);
  const comp = p.opts.has('c') || p.opts.has('C');
  const in1 = (c: string): boolean => set1.includes(c) !== comp;
  let set2 = s2 !== undefined ? trSet(s2) : [];
  if (set2.length && set2.length < set1.length && !p.opts.has('t')) set2 = [...set2, ...Array(set1.length - set2.length).fill(set2[set2.length - 1])];
  let out = '';
  let last = '';
  const squeeze = p.opts.has('s') ? (p.opts.has('d') ? set2 : s2 !== undefined ? set2 : set1) : [];
  for (const c of Array.from(text)) {
    if (p.opts.has('d') && in1(c)) continue;
    const mapped = !p.opts.has('d') && set2.length && in1(c) ? (comp ? set2[set2.length - 1] ?? c : set2[set1.indexOf(c)] ?? c) : c;
    if (squeeze.includes(mapped) && mapped === last) continue;
    out += mapped;
    last = mapped;
  }
  ctx.out(out);
  return 0;
}

function* nl(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { withArg: 'bwsv', long: { 'body-numbering=': 'b', 'number-width=': 'w', 'number-separator=': 's' } });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  const all = p.opts.get('b') === 'a';
  const w = num(p.opts.get('w'), 6);
  const sep = typeof p.opts.get('s') === 'string' ? String(p.opts.get('s')) : '\t';
  let n = num(p.opts.get('v'), 1) - 1;
  ctx.out(joinLines(inputs.flatMap((i) => lines(i.text)).map((l) => (all || l !== '' ? `${String(++n).padStart(w)}${sep}${l}` : ' '.repeat(w + 1)))));
  return failed ? 1 : 0;
}

function* simple(ctx: Ctx, fn: (l: string[]) => string[]): Gen<number> {
  const { inputs, failed } = yield* readInputs(ctx, ctx.argv.slice(1).filter((a) => !a.startsWith('-') || a === '-'));
  ctx.out(joinLines(fn(inputs.flatMap((i) => lines(i.text)))));
  return failed ? 1 : 0;
}

function* paste(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 's', withArg: 'd', long: { 'delimiters=': 'd', serial: 's' } });
  if (p.error) return usageError(ctx, p.error);
  const delims = Array.from(typeof p.opts.get('d') === 'string' ? String(p.opts.get('d')).replace(/\\t/g, '\t').replace(/\\n/g, '\n') : '\t');
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  const cols = inputs.map((i) => lines(i.text));
  const join = (parts: readonly string[]): string => parts.reduce((acc, s, i) => (i === 0 ? s : acc + (delims[(i - 1) % delims.length] ?? '') + s), '');
  if (p.opts.has('s')) ctx.out(joinLines(cols.map(join)));
  else ctx.out(joinLines(Array.from({ length: Math.max(0, ...cols.map((c) => c.length)) }, (_, r) => join(cols.map((c) => c[r] ?? '')))));
  return failed ? 1 : 0;
}

function* fold(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'sb', withArg: 'w', numeric: 'w', long: { 'width=': 'w', spaces: 's' } });
  if (p.error) return usageError(ctx, p.error);
  const w = num(p.opts.get('w'), 80);
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  const out: string[] = [];
  for (const l of inputs.flatMap((i) => lines(i.text))) {
    let rest = l;
    while (Array.from(rest).length > w) {
      let cutAt = w;
      if (p.opts.has('s')) { const sp = rest.slice(0, w).lastIndexOf(' '); if (sp > 0) cutAt = sp + 1; }
      out.push(rest.slice(0, cutAt));
      rest = rest.slice(cutAt);
    }
    out.push(rest);
  }
  ctx.out(joinLines(out));
  return failed ? 1 : 0;
}

function* tee(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'ai', long: { append: 'a' } });
  if (p.error) return usageError(ctx, p.error);
  const text = yield* ctx.readAll();
  let status = 0;
  for (const f of p.operands) {
    try { ctx.sh.env.fs.writeFile(ctx.resolve(f), text, ctx.cred, p.opts.has('a')); } catch (e) { ctx.err(`tee: ${f}: ${errMsg(e)}\n`); status = 1; }
  }
  ctx.out(text);
  return status;
}

function* comm(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: '123' });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands.slice(0, 2));
  const [a, b] = [lines(inputs[0]?.text ?? ''), lines(inputs[1]?.text ?? '')];
  const show = [!p.opts.has('1'), !p.opts.has('2'), !p.opts.has('3')];
  const prefix = (col: number): string => '\t'.repeat(show.slice(0, col).filter(Boolean).length);
  let i = 0;
  let j = 0;
  const out: string[] = [];
  while (i < a.length || j < b.length) {
    const x = a[i];
    const y = b[j];
    if (y === undefined || (x !== undefined && x < y)) { if (show[0]) out.push(x ?? ''); i++; }
    else if (x === undefined || y < x) { if (show[1]) out.push(prefix(1) + y); j++; }
    else { if (show[2]) out.push(prefix(2) + x); i++; j++; }
  }
  ctx.out(joinLines(out));
  return failed ? 1 : 0;
}

export const TEXT: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['head', head], ['tail', tail], ['wc', wc], ['sort', sort], ['uniq', uniq], ['cut', cut], ['tr', tr], ['nl', nl],
  ['rev', (c) => simple(c, (l) => l.map((x) => Array.from(x).reverse().join('')))], ['tac', (c) => simple(c, (l) => [...l].reverse())],
  ['paste', paste], ['fold', fold], ['tee', tee], ['comm', comm],
]);
