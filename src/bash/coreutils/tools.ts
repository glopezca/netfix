/** seq expr xargs base64 diff cmp yes sleep. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { gnuOpts, usageError, lines, errMsg, readInputs } from './common.ts';
import { formatPrintf } from '../builtins/printf.ts';
import { compile } from './regex.ts';
import { strftime } from '../prompt.ts';

const MAX_SEQ = 1_000_000;
const MAX_YES = 20_000;
const MAX_SLEEP_MS = 60_000;

function seq(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'w', withArg: 'sf', long: { 'separator=': 's', 'format=': 'f', 'equal-width': 'w' }, posix: true });
  if (p.error && !/invalid option -- '\d'/.test(p.error)) return usageError(ctx, p.error);
  const nums = (p.error ? ctx.argv.slice(1) : p.operands).map(Number);
  if (!nums.length || nums.length > 3 || nums.some((n) => Number.isNaN(n))) {
    const bad = (p.error ? ctx.argv.slice(1) : p.operands).find((o) => Number.isNaN(Number(o)));
    return usageError(ctx, bad !== undefined ? `invalid floating point argument: ‘${bad}’` : 'missing operand');
  }
  const [first, inc, last] = nums.length === 1 ? [1, 1, nums[0] ?? 1] : nums.length === 2 ? [nums[0] ?? 1, 1, nums[1] ?? 1] : [nums[0] ?? 1, nums[1] ?? 1, nums[2] ?? 1];
  if (inc === 0) { ctx.err('seq: invalid Zero increment value: ‘0’\n'); return 1; }
  const decimals = Math.max(...(p.operands.length ? p.operands : ['0']).map((o) => (o.split('.')[1] ?? '').length));
  const fmt = typeof p.opts.get('f') === 'string' ? String(p.opts.get('f')) : `%.${decimals}f`;
  const out: string[] = [];
  for (let v = first, i = 0; inc > 0 ? v <= last + 1e-9 : v >= last - 1e-9; v = first + ++i * inc) {
    if (out.length >= MAX_SEQ) break;
    out.push(formatPrintf(fmt, [String(v)], 0).passes[0]?.text ?? '');
  }
  if (p.opts.has('w')) { const w = Math.max(...out.map((s) => s.length)); for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? '').padStart(w, '0'); }
  ctx.out(out.length ? `${out.join(typeof p.opts.get('s') === 'string' ? String(p.opts.get('s')) : '\n')}\n` : '');
  return 0;
}

class ExprError extends Error {}

/** expr: | & = > >= < <= != + - * / % : match substr index length ( ). */
function exprEval(tokens: string[]): string {
  let i = 0;
  const isInt = (s: string): boolean => /^-?\d+$/.test(s);
  const num = (s: string): bigint => { if (!isInt(s)) throw new ExprError('non-integer argument'); return BigInt(s); };
  const level = (n: number): string => {
    if (n === 6) return primary();
    let l = level(n + 1);
    const ops = [['|'], ['&'], ['=', '>', '>=', '<', '<=', '!='], ['+', '-'], ['*', '/', '%'], [':']][n] ?? [];
    while (i < tokens.length && ops.includes(tokens[i] ?? '')) {
      const op = tokens[i++] ?? '';
      const r = level(n + 1);
      l = apply(op, l, r);
    }
    return l;
  };
  const apply = (op: string, l: string, r: string): string => {
    switch (op) {
      case '|': return l !== '' && l !== '0' ? l : r !== '' && r !== '0' ? r : '0';
      case '&': return l !== '' && l !== '0' && r !== '' && r !== '0' ? l : '0';
      case '+': return String(num(l) + num(r));
      case '-': return String(num(l) - num(r));
      case '*': return String(num(l) * num(r));
      case '/': case '%': if (num(r) === 0n) throw new ExprError('division by zero'); return String(op === '/' ? num(l) / num(r) : num(l) % num(r));
      case ':': { const m = new RegExp(`^(?:${compile(r).source})`).exec(l); return m ? (m[1] ?? String(m[0].length)) : m === null && /\\\(/.test(r) ? '' : '0'; }
      default: {
        const c = isInt(l) && isInt(r) ? Number(num(l) - num(r)) : l < r ? -1 : l > r ? 1 : 0;
        return (op === '=' ? c === 0 : op === '!=' ? c !== 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0) ? '1' : '0';
      }
    }
  };
  const primary = (): string => {
    const t = tokens[i++];
    if (t === undefined) throw new ExprError('syntax error: missing argument after ‘' + (tokens[i - 2] ?? '') + '’');
    if (t === '(') { const v = level(0); if (tokens[i++] !== ')') throw new ExprError("syntax error: expecting ')'"); return v; }
    if (t === 'length') return String(Array.from(primary()).length);
    if (t === 'substr') { const s = primary(); const p = Number(primary()); const n = Number(primary()); return Array.from(s).slice(p - 1, p - 1 + n).join(''); }
    if (t === 'index') { const s = primary(); const c = primary(); const idx = [...s].findIndex((ch) => c.includes(ch)); return String(idx + 1); }
    if (t === 'match') { const s = primary(); const r = primary(); return apply(':', s, r); }
    return t;
  };
  const v = level(0);
  if (i < tokens.length) throw new ExprError(`syntax error: unexpected argument ‘${tokens[i] ?? ''}’`);
  return v;
}

function expr(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (!args.length) return usageError(ctx, 'missing operand', 2);
  try {
    const v = exprEval(args);
    ctx.out(`${v}\n`);
    return v === '' || v === '0' ? 1 : 0;
  } catch (e) {
    ctx.err(`expr: ${errMsg(e)}\n`);
    return e instanceof ExprError && /syntax/.test(e.message) ? 2 : 3;
  }
}

function* xargs(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'tr0', withArg: 'nIdL', long: { 'max-args=': 'n', 'null': '0', verbose: 't', 'no-run-if-empty': 'r', 'delimiter=': 'd' }, posix: true });
  if (p.error) return usageError(ctx, p.error);
  const text = yield* ctx.readAll();
  const delim = p.opts.has('0') ? '\0' : typeof p.opts.get('d') === 'string' ? String(p.opts.get('d')) : undefined;
  const items = delim !== undefined ? text.split(delim).filter((x, i, a) => x !== '' || i < a.length - 1) : p.opts.has('I') || p.opts.has('L') ? lines(text) : (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''));
  const base = p.operands.length ? p.operands : ['echo'];
  if (!items.length && (p.opts.has('r') || true) && base[0] !== 'echo') return 0;
  const replace = p.opts.get('I');
  const per = typeof replace === 'string' ? 1 : Number(p.opts.get('n') ?? p.opts.get('L') ?? items.length) || items.length || 1;
  let status = 0;
  const fds = new Map(ctx.fds);
  fds.set(0, { read: { kind: 'null' } });
  for (let i = 0; i < Math.max(1, items.length); i += per) {
    const chunk = items.slice(i, i + per);
    const argv = typeof replace === 'string' ? base.map((a) => a.split(replace).join(chunk[0] ?? '')) : [...base, ...chunk];
    if (p.opts.has('t')) ctx.err(`${argv.join(' ')}\n`);
    const s = yield* ctx.sh.invoke(argv, fds);
    if (s !== 0) status = s === 127 ? 127 : 123;
  }
  return status;
}

function* base64(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'di', withArg: 'w', long: { decode: 'd', 'wrap=': 'w' } });
  if (p.error) return usageError(ctx, p.error);
  const { inputs, failed } = yield* readInputs(ctx, p.operands);
  const text = inputs.map((i) => i.text).join('');
  const bytes = new TextEncoder().encode(text);
  if (p.opts.has('d')) {
    try {
      const bin = atob(text.replace(/\s+/g, ''));
      ctx.out(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch { ctx.err('base64: invalid input\n'); return 1; }
    return 0;
  }
  const enc = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  const w = Number(p.opts.get('w') ?? 76);
  ctx.out(`${w > 0 ? (enc.match(new RegExp(`.{1,${w}}`, 'g')) ?? ['']).join('\n') : enc}\n`);
  return failed ? 1 : 0;
}

/** Longest common subsequence edit script between two line arrays. */
function diffOps(a: readonly string[], b: readonly string[]): ('=' | '-' | '+')[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return [...a.map(() => '-' as const), ...b.map(() => '+' as const)];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) (dp[i] as Uint32Array)[j] = a[i] === b[j] ? ((dp[i + 1] as Uint32Array)[j + 1] ?? 0) + 1 : Math.max((dp[i + 1] as Uint32Array)[j] ?? 0, (dp[i] as Uint32Array)[j + 1] ?? 0);
  const ops: ('=' | '-' | '+')[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push('='); i++; j++; }
    else if (i < n && (j >= m || ((dp[i + 1] as Uint32Array)[j] ?? 0) >= ((dp[i] as Uint32Array)[j + 1] ?? 0))) { ops.push('-'); i++; }
    else { ops.push('+'); j++; }
  }
  return ops;
}

function range(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${start + count - 1}`;
}

const CONTEXT = 3;

/** Unified hunks with three lines of context, as GNU diff -u prints them. */
function unified(ops: readonly ('=' | '-' | '+')[], a: readonly string[], b: readonly string[]): string {
  const rows: { op: '=' | '-' | '+'; ai: number; bi: number }[] = [];
  let i = 0;
  let j = 0;
  for (const o of ops) { rows.push({ op: o, ai: i, bi: j }); if (o !== '+') i++; if (o !== '-') j++; }
  const changed = rows.map((r, k) => (r.op !== '=' ? k : -1)).filter((k) => k >= 0);
  let out = '';
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, (changed[k] ?? 0) - CONTEXT);
    let end = Math.min(rows.length, (changed[k] ?? 0) + CONTEXT + 1);
    while (k + 1 < changed.length && (changed[k + 1] ?? 0) - CONTEXT <= end) { k++; end = Math.min(rows.length, (changed[k] ?? 0) + CONTEXT + 1); }
    const hunk = rows.slice(start, end);
    const aLen = hunk.filter((r) => r.op !== '+').length;
    const bLen = hunk.filter((r) => r.op !== '-').length;
    const aStart = aLen ? (hunk[0]?.ai ?? 0) + 1 : hunk[0]?.ai ?? 0;
    const bStart = bLen ? (hunk[0]?.bi ?? 0) + 1 : hunk[0]?.bi ?? 0;
    out += `@@ -${aStart}${aLen === 1 ? '' : `,${aLen}`} +${bStart}${bLen === 1 ? '' : `,${bLen}`} @@\n`;
    for (const r of hunk) out += r.op === '+' ? `+${b[r.bi] ?? ''}\n` : `${r.op === '-' ? '-' : ' '}${a[r.ai] ?? ''}\n`;
    k++;
  }
  return out;
}

function* diff(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'uqswiB', long: { unified: 'u', brief: 'q' } });
  if (p.error) return usageError(ctx, p.error, 2);
  if (p.operands.length !== 2) { ctx.err(`diff: missing operand after '${p.operands[0] ?? 'diff'}'\ndiff: Try 'diff --help' for more information.\n`); return 2; }
  const { inputs, failed } = yield* readInputs(ctx, p.operands, (n, e) => ctx.err(`diff: ${n}: ${errMsg(e)}\n`));
  if (failed) return 2;
  const norm = (s: string): string => (p.opts.has('w') ? s.replace(/\s+/g, '') : p.opts.has('i') ? s.toLowerCase() : s);
  const [a, b] = [lines(inputs[0]?.text ?? ''), lines(inputs[1]?.text ?? '')];
  const ops = diffOps(a.map(norm), b.map(norm));
  if (ops.every((o) => o === '=')) { if (p.opts.has('s')) ctx.out(`Files ${p.operands[0]} and ${p.operands[1]} are identical\n`); return 0; }
  if (p.opts.has('q')) { ctx.out(`Files ${p.operands[0]} and ${p.operands[1]} differ\n`); return 1; }
  if (p.opts.has('u')) {
    const stamp = (f: string): string => strftime('%Y-%m-%d %H:%M:%S.000000000 +0000', ctx.sh.env.fs.stat(ctx.resolve(f), ctx.cred).mtime);
    ctx.out(`--- ${p.operands[0]}\t${stamp(p.operands[0] ?? '')}\n+++ ${p.operands[1]}\t${stamp(p.operands[1] ?? '')}\n${unified(ops, a, b)}`);
    return 1;
  }
  let i = 0;
  let j = 0;
  for (let k = 0; k < ops.length;) {
    if (ops[k] === '=') { i++; j++; k++; continue; }
    let dels = 0;
    let adds = 0;
    while (ops[k] === '-' || ops[k] === '+') { if (ops[k] === '-') dels++; else adds++; k++; }
    const kind = dels && adds ? 'c' : dels ? 'd' : 'a';
    const left = kind === 'a' ? String(i) : range(i + 1, dels);
    const right = kind === 'd' ? String(j) : range(j + 1, adds);
    ctx.out(`${left}${kind}${right}\n`);
    for (let x = 0; x < dels; x++) ctx.out(`< ${a[i + x] ?? ''}\n`);
    if (kind === 'c') ctx.out('---\n');
    for (let x = 0; x < adds; x++) ctx.out(`> ${b[j + x] ?? ''}\n`);
    i += dels;
    j += adds;
  }
  return 1;
}

function* cmp(ctx: Ctx): Gen<number> {
  const ops = ctx.argv.slice(1).filter((a) => !a.startsWith('-'));
  const { inputs, failed } = yield* readInputs(ctx, ops.slice(0, 2));
  if (failed) return 2;
  const [a, b] = [inputs[0]?.text ?? '', inputs[1]?.text ?? ''];
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (a[k] === b[k]) continue;
    if (a[k] === undefined || b[k] === undefined) { ctx.err(`cmp: EOF on ${a[k] === undefined ? ops[0] : ops[1]} after byte ${k}\n`); return 1; }
    if (!ctx.argv.includes('-s')) ctx.out(`${ops[0]} ${ops[1]} differ: byte ${k + 1}, line ${(a.slice(0, k).match(/\n/g) ?? []).length + 1}\n`);
    return 1;
  }
  return 0;
}

function yes(ctx: Ctx): number {
  const word = ctx.argv.slice(1).join(' ') || 'y';
  ctx.out(`${word}\n`.repeat(MAX_YES));
  return 0;
}

function sleep(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (!args.length) return usageError(ctx, 'missing operand');
  let ms = 0;
  for (const a of args) {
    const m = /^(\d*\.?\d+)([smhd]?)$/.exec(a);
    if (!m) { ctx.err(`sleep: invalid time interval ‘${a}’\nTry 'sleep --help' for more information.\n`); return 1; }
    ms += Number(m[1]) * ({ '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as ''] ?? 1000);
  }
  ctx.sh.env.wait?.(Math.min(ms, MAX_SLEEP_MS));
  return 0;
}

export const TOOLS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['seq', seq], ['expr', expr], ['xargs', xargs], ['base64', base64], ['diff', diff], ['cmp', cmp], ['yes', yes], ['sleep', sleep],
]);
