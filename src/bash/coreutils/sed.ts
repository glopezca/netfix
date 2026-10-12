/** GNU sed 4.9 subset: addresses, s y d D p P n N q Q a i c = l r w h H g G x b t T :label { } !, -n -e -f -i -E -s. */
import type { Ctx, Gen } from '../types.ts';
import { gnuOpts, lines, errMsg } from './common.ts';
import { compile, RegexError } from './regex.ts';

type Addr = { k: 'line'; n: number } | { k: 'last' } | { k: 're'; re: RegExp } | { k: 'step'; first: number; step: number } | { k: 'zero' };

interface Cmd {
  a1?: Addr;
  a2?: Addr | { k: 'plus'; n: number };
  neg: boolean;
  name: string;
  arg?: string;
  re?: RegExp;
  rep?: string;
  flags?: { g: boolean; nth: number; p: boolean; w?: string };
  block?: Cmd[];
  inRange?: boolean;
  rangeEnd?: number;
}

export class SedError extends Error {}

class SedParser {
  private i = 0;
  private readonly s: string;
  private readonly ere: boolean;

  constructor(script: string, ere: boolean) {
    this.s = script;
    this.ere = ere;
  }

  private delimited(delim: string): string {
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== delim) {
      if (this.s[this.i] === '\\' && this.s[this.i + 1] === delim) { out += delim; this.i += 2; continue; }
      if (this.s[this.i] === '\\') { out += this.s.slice(this.i, this.i + 2); this.i += 2; continue; }
      if (this.s[this.i] === '\n') break;
      out += this.s[this.i++];
    }
    if (this.s[this.i] !== delim) throw new SedError(`-e expression #1, char ${this.i}: unterminated \`s' command`);
    this.i++;
    return out;
  }

  private regex(delim: string, flags = ''): RegExp {
    const src = this.delimited(delim);
    return compile(src === '' ? '(?:)' : src, { extended: this.ere || src === '', icase: flags.includes('I'), global: true });
  }

  private addr(): Addr | undefined {
    const c = this.s[this.i];
    const num = /^\d+(~\d+)?/.exec(this.s.slice(this.i));
    if (num) {
      this.i += num[0].length;
      const [a, b] = num[0].split('~');
      if (b !== undefined) return { k: 'step', first: Number(a), step: Number(b) };
      return Number(a) === 0 ? { k: 'zero' } : { k: 'line', n: Number(a) };
    }
    if (c === '$') { this.i++; return { k: 'last' }; }
    if (c === '/' || c === '\\') {
      const delim = c === '\\' ? this.s[++this.i] ?? '/' : '/';
      this.i++;
      const re = this.regex(delim, this.s[this.i] === 'I' ? (this.i++, 'I') : '');
      return { k: 're', re };
    }
    return undefined;
  }

  private text(): string {
    while (this.s[this.i] === ' ') this.i++;
    if (this.s[this.i] === '\\') { this.i++; if (this.s[this.i] === '\n') this.i++; }
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== '\n') {
      if (this.s[this.i] === '\\' && this.i + 1 < this.s.length) { out += this.s[this.i + 1] === 'n' ? '\n' : this.s[this.i + 1]; this.i += 2; continue; }
      out += this.s[this.i++];
    }
    return out;
  }

  private label(): string {
    while (this.s[this.i] === ' ') this.i++;
    const m = /^[^;\n}]*/.exec(this.s.slice(this.i))?.[0] ?? '';
    this.i += m.length;
    return m.trim();
  }

  parse(end = false): Cmd[] {
    const cmds: Cmd[] = [];
    for (;;) {
      while (/[\s;]/.test(this.s[this.i] ?? 'x')) this.i++;
      if (this.i >= this.s.length) { if (end) throw new SedError('-e expression #1, char 0: unmatched `{\''); return cmds; }
      if (this.s[this.i] === '}') { if (!end) throw new SedError(`-e expression #1, char ${this.i + 1}: unexpected \`}'`); this.i++; return cmds; }
      cmds.push(this.command());
    }
  }

  private command(): Cmd {
    const cmd: Cmd = { neg: false, name: '' };
    cmd.a1 = this.addr();
    if (cmd.a1 && this.s[this.i] === ',') {
      this.i++;
      const plus = /^\+(\d+)/.exec(this.s.slice(this.i));
      if (plus) { this.i += plus[0].length; cmd.a2 = { k: 'plus', n: Number(plus[1]) }; } else cmd.a2 = this.addr();
    }
    while (this.s[this.i] === ' ') this.i++;
    if (this.s[this.i] === '!') { cmd.neg = true; this.i++; while (this.s[this.i] === ' ') this.i++; }
    const name = this.s[this.i++] ?? '';
    cmd.name = name;
    if (name === '{') cmd.block = this.parse(true);
    else if (name === 's') this.subst(cmd);
    else if (name === 'y') { const d = this.s[this.i++] ?? '/'; cmd.arg = this.delimited(d); cmd.rep = this.delimited(d); }
    else if ('aic'.includes(name)) cmd.arg = this.text();
    else if ('btT:'.includes(name)) cmd.arg = this.label();
    else if ('rwRW'.includes(name)) cmd.arg = this.text();
    else if ('qQlL'.includes(name)) { const m = /^\s*(\d*)/.exec(this.s.slice(this.i))?.[0] ?? ''; this.i += m.length; cmd.arg = m.trim(); }
    else if (!'dDpPnNhHgGx=z'.includes(name) || name === '') throw new SedError(`-e expression #1, char ${this.i}: unknown command: \`${name}'`);
    return cmd;
  }

  private subst(cmd: Cmd): void {
    const d = this.s[this.i++] ?? '/';
    const pat = this.delimited(d);
    cmd.rep = this.delimited(d);
    const fl = /^[gpiImeM0-9]*(w\s*[^\n;]*)?/.exec(this.s.slice(this.i))?.[0] ?? '';
    this.i += fl.length;
    const nth = Number(/\d+/.exec(fl)?.[0] ?? 0);
    cmd.flags = { g: fl.includes('g'), nth, p: fl.includes('p'), w: /w\s*(.+)$/.exec(fl)?.[1]?.trim() };
    cmd.re = compile(pat === '' ? '(?:)' : pat, { extended: this.ere, icase: /[iI]/.test(fl.replace(/w.*$/, '')), global: true });
  }
}

/** Expands & \1-\9 \n \t and the GNU case escapes \L \U \E \l \u. */
function replacement(rep: string, m: RegExpExecArray): string {
  let out = '';
  let mode: 'L' | 'U' | '' = '';
  let once: 'l' | 'u' | '' = '';
  const put = (t: string): void => {
    for (const ch of t) {
      let c = mode === 'L' ? ch.toLowerCase() : mode === 'U' ? ch.toUpperCase() : ch;
      if (once) { c = once === 'l' ? c.toLowerCase() : c.toUpperCase(); once = ''; }
      out += c;
    }
  };
  for (let i = 0; i < rep.length; i++) {
    const c = rep[i] ?? '';
    if (c === '&') { put(m[0]); continue; }
    if (c !== '\\' || i + 1 >= rep.length) { put(c); continue; }
    const n = rep[++i] ?? '';
    if (/\d/.test(n)) put(m[Number(n)] ?? '');
    else if (n === 'n') put('\n');
    else if (n === 't') put('\t');
    else if (n === 'L' || n === 'U') mode = n;
    else if (n === 'E') mode = '';
    else if (n === 'l' || n === 'u') once = n;
    else put(n);
  }
  return out;
}

interface State {
  pattern: string;
  hold: string;
  lineNo: number;
  last: boolean;
  out: string[];
  append: string[];
  tflag: boolean;
  quit?: number;
  autoprint: boolean;
}

function matches(a: Addr | { k: 'plus'; n: number }, st: State): boolean {
  switch (a.k) {
    case 'line': return st.lineNo === a.n;
    case 'last': return st.last;
    case 're': a.re.lastIndex = 0; return a.re.test(st.pattern);
    case 'step': return a.step <= 0 ? st.lineNo === a.first : st.lineNo >= a.first && (st.lineNo - a.first) % a.step === 0;
    case 'zero': return false;
    case 'plus': return false;
  }
}

function selected(cmd: Cmd, st: State): boolean {
  if (!cmd.a1) return !cmd.neg;
  let hit: boolean;
  if (!cmd.a2) hit = matches(cmd.a1, st);
  else if (cmd.inRange) {
    const a2 = cmd.a2;
    const endNow = a2.k === 'plus' ? st.lineNo >= (cmd.rangeEnd ?? 0) : a2.k === 'line' ? st.lineNo >= a2.n : matches(a2, st);
    if (endNow || (a2.k === 'line' && st.lineNo >= a2.n)) cmd.inRange = false;
    hit = true;
  } else if (cmd.a1.k === 'zero' ? st.lineNo === 1 || matches(cmd.a1, st) : matches(cmd.a1, st)) {
    hit = true;
    const a2 = cmd.a2;
    cmd.rangeEnd = a2.k === 'plus' ? st.lineNo + a2.n : undefined;
    const closesNow = a2.k === 'line' ? a2.n <= st.lineNo : a2.k === 'plus' ? a2.n === 0 : cmd.a1.k === 'zero' && a2.k === 're' ? matches(a2, st) : false;
    cmd.inRange = !closesNow;
  } else hit = false;
  return hit !== cmd.neg;
}

/** s/RE/REP/FLAGS on the pattern space. */
function substitute(ctx: Ctx, cmd: Cmd, st: State): void {
  const re = cmd.re as RegExp;
  let n = 0;
  let did = false;
  const res = st.pattern.replace(re, (...args) => {
    n++;
    const m = Object.assign([...args.slice(0, -2)] as string[], { index: 0, input: '' }) as unknown as RegExpExecArray;
    if (cmd.flags?.nth ? n === cmd.flags.nth || (cmd.flags.g && n > cmd.flags.nth) : (cmd.flags?.g || n === 1)) { did = true; return replacement(cmd.rep ?? '', m); }
    return args[0] as string;
  });
  if (!did) return;
  st.pattern = res;
  st.tflag = true;
  if (cmd.flags?.p) st.out.push(st.pattern);
  if (cmd.flags?.w) ctx.sh.env.fs.writeFile(ctx.resolve(cmd.flags.w), `${st.pattern}\n`, ctx.cred, true);
}

function runCmds(ctx: Ctx, cmds: readonly Cmd[], st: State, input: { lines: string[]; idx: number }, labels: Map<string, number>, root: readonly Cmd[]): 'next' | 'delete' | 'restart' | 'quit' {
  for (let pc = 0; pc < cmds.length; pc++) {
    const cmd = cmds[pc] as Cmd;
    if (!selected(cmd, st)) continue;
    switch (cmd.name) {
      case '{': { const r = runCmds(ctx, cmd.block ?? [], st, input, labels, root); if (r !== 'next') return r; break; }
      case 's': substitute(ctx, cmd, st); break;
      case 'y': { const from = Array.from(cmd.arg ?? ''); const to = Array.from(cmd.rep ?? ''); st.pattern = Array.from(st.pattern).map((c) => (from.includes(c) ? to[from.indexOf(c)] ?? c : c)).join(''); break; }
      case 'd': return 'delete';
      case 'D': if (!st.pattern.includes('\n')) return 'delete'; st.pattern = st.pattern.slice(st.pattern.indexOf('\n') + 1); return 'restart';
      case 'p': st.out.push(st.pattern); break;
      case 'P': st.out.push(st.pattern.split('\n')[0] ?? ''); break;
      case 'n': if (st.autoprint) st.out.push(st.pattern); if (input.idx >= input.lines.length) return 'quit'; st.pattern = input.lines[input.idx++] ?? ''; st.lineNo++; st.last = input.idx >= input.lines.length; break;
      case 'N': if (input.idx >= input.lines.length) return 'next'; st.pattern += `\n${input.lines[input.idx++] ?? ''}`; st.lineNo++; st.last = input.idx >= input.lines.length; break;
      case 'q': st.quit = Number(cmd.arg || 0); return 'quit';
      case 'Q': st.quit = Number(cmd.arg || 0); st.autoprint = false; return 'quit';
      case 'a': st.append.push(cmd.arg ?? ''); break;
      case 'i': st.out.push(cmd.arg ?? ''); break;
      case 'c': if (!cmd.a2 || !cmd.inRange) st.out.push(cmd.arg ?? ''); return 'delete';
      case '=': st.out.push(String(st.lineNo)); break;
      case 'l': st.out.push(`${st.pattern.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n')}$`); break;
      case 'r': try { st.append.push(ctx.sh.env.fs.readFile(ctx.resolve(cmd.arg ?? ''), ctx.cred).replace(/\n$/, '')); } catch { /* missing files are ignored, as GNU sed does */ } break;
      case 'w': ctx.sh.env.fs.writeFile(ctx.resolve(cmd.arg ?? ''), `${st.pattern}\n`, ctx.cred, true); break;
      case 'h': st.hold = st.pattern; break;
      case 'H': st.hold += `\n${st.pattern}`; break;
      case 'g': st.pattern = st.hold; break;
      case 'G': st.pattern += `\n${st.hold}`; break;
      case 'x': [st.pattern, st.hold] = [st.hold, st.pattern]; break;
      case 'z': st.pattern = ''; break;
      case ':': break;
      case 'b': case 't': case 'T': {
        const jump = cmd.name === 'b' || (cmd.name === 't' ? st.tflag : !st.tflag);
        if (cmd.name !== 'b') st.tflag = false;
        if (!jump) break;
        if (!cmd.arg) return 'next';
        const target = labels.get(cmd.arg);
        if (target === undefined) throw new SedError(`-e expression #1, char 0: can't find label for jump to \`${cmd.arg}'`);
        return runCmds(ctx, root.slice(target), st, input, labels, root);
      }
    }
  }
  return 'next';
}

export function* sed(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'nErsuz', withArg: 'efi', long: { quiet: 'n', silent: 'n', 'expression=': 'e', 'file=': 'f', 'regexp-extended': 'E', 'in-place': 'i', separate: 's' } });
  const inPlace = ctx.argv.slice(1).some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'));
  const raw = ctx.argv.slice(1).map((a) => (/^-i\S*$/.test(a) ? '-i' : a));
  const q = inPlace ? gnuOpts(raw.filter((a) => a !== '-i'), { flags: 'nErsuz', withArg: 'ef', long: { quiet: 'n', 'expression=': 'e', 'regexp-extended': 'E' } }) : p;
  if (q.error) { ctx.err(`sed: ${q.error}\nUsage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n`); return 1; }
  const ops = [...q.operands];
  const scripts = [...(q.multi.get('e') ?? [])];
  const sf = q.opts.get('f');
  if (typeof sf === 'string') { try { scripts.push(ctx.sh.env.fs.readFile(ctx.resolve(sf), ctx.cred)); } catch (e) { ctx.err(`sed: couldn't open file ${sf}: ${errMsg(e)}\n`); return 1; } }
  if (!scripts.length) { const s = ops.shift(); if (s === undefined) { ctx.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n'); return 1; } scripts.push(s); }
  let cmds: Cmd[];
  try { cmds = new SedParser(scripts.join('\n'), q.opts.has('E') || q.opts.has('r')).parse(); } catch (e) { ctx.err(`sed: ${e instanceof SedError || e instanceof RegexError ? e.message : errMsg(e)}\n`); return 1; }
  const labels = new Map<string, number>();
  cmds.forEach((c, i) => { if (c.name === ':' && c.arg) labels.set(c.arg, i); });
  const files = ops.length ? ops : ['-'];
  const groups = inPlace || q.opts.has('s') ? files.map((f) => [f]) : [files];
  let status = 0;
  for (const group of groups) {
    const texts: string[] = [];
    for (const f of group) {
      if (f === '-') { texts.push(yield* ctx.readAll()); continue; }
      try { texts.push(ctx.sh.env.fs.readFile(ctx.resolve(f), ctx.cred)); } catch (e) { ctx.err(`sed: can't read ${f}: ${errMsg(e)}\n`); status = 2; }
    }
    const result = runSed(ctx, cmds, labels, lines(texts.join('')), !q.opts.has('n'));
    if (result.error) { ctx.err(`sed: ${result.error}\n`); return 1; }
    if (inPlace && group[0] !== '-') ctx.sh.env.fs.writeFile(ctx.resolve(group[0] ?? ''), result.text, ctx.cred);
    else ctx.out(result.text);
    if (result.quit !== undefined) return result.quit;
  }
  return status;
}

function runSed(ctx: Ctx, cmds: Cmd[], labels: Map<string, number>, input: string[], autoprint: boolean): { text: string; quit?: number; error?: string } {
  const st: State = { pattern: '', hold: '', lineNo: 0, last: false, out: [], append: [], tflag: false, autoprint };
  const src = { lines: input, idx: 0 };
  for (const c of cmds) c.inRange = false;
  try {
    while (src.idx < src.lines.length) {
      st.pattern = src.lines[src.idx++] ?? '';
      st.lineNo++;
      st.last = src.idx >= src.lines.length;
      st.tflag = false;
      let r = runCmds(ctx, cmds, st, src, labels, cmds);
      while (r === 'restart') r = runCmds(ctx, cmds, st, src, labels, cmds);
      if (r !== 'delete' && st.autoprint) st.out.push(st.pattern);
      st.out.push(...st.append);
      st.append = [];
      if (r === 'quit') break;
    }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : String(e) };
  }
  ctx.sh.tick();
  return { text: st.out.length ? `${st.out.join('\n')}\n` : '', quit: st.quit };
}
