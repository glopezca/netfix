/** batcat (bat 0.25 as packaged by Ubuntu) and whereis. */
import type { CommandFn, Ctx, Gen } from '../types.ts';
import { gnuOpts, usageError } from './common.ts';
import { isTty } from '../io.ts';
import { errMsg } from './common.ts';
import { highlight, languageByName, languageFor, LANGUAGE_LIST } from './syntax.ts';
import type { Language } from './syntax.ts';
import { manSection } from '../../docs/index.ts';

const GUTTER = 7;
const DEFAULT_COLUMNS = 80;
const GRID = '\x1b[38;5;238m';
const RESET = '\x1b[0m';
const BIN_DIRS = ['/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin'];
const EXTRA_DIRS = ['/etc', '/usr/lib', '/usr/share'];

interface Style {
  readonly header: boolean;
  readonly grid: boolean;
  readonly numbers: boolean;
}

interface Input {
  readonly name: string;
  readonly text: string;
}

function styleFrom(value: string | true | undefined, plain: number, numbers: boolean, tty: boolean): Style {
  if (plain > 0 || !tty) return { header: false, grid: false, numbers: false };
  if (numbers) return { header: false, grid: false, numbers: true };
  const parts = new Set(typeof value === 'string' ? value.split(',') : ['full']);
  const full = parts.has('full') || parts.has('default');
  return { header: full || parts.has('header') || parts.has('header-filename'), grid: full || parts.has('grid'), numbers: full || parts.has('numbers') };
}

function showAll(text: string): string {
  return text.replace(/ /g, '·').replace(/\t/g, '├──┤').replace(/\n/g, '␊\n');
}

function lineRange(spec: string | true | undefined, total: number): [number, number] {
  if (typeof spec !== 'string') return [1, total];
  const m = /^(\d*):(\d*)$/.exec(spec) ?? /^(\d+)$/.exec(spec);
  if (!m) return [1, total];
  const from = Number(m[1] || 1);
  const to = m[2] === undefined ? from : Number(m[2] || total);
  return [from, to];
}

function render(ctx: Ctx, input: Input, o: { style: Style; color: boolean; lang?: Language; all: boolean; range: string | true | undefined }): string {
  const cols = Math.max(20, Number(ctx.env.get('COLUMNS') ?? DEFAULT_COLUMNS) || DEFAULT_COLUMNS);
  const raw = o.all ? showAll(input.text) : input.text;
  const body = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  const lang = o.lang ?? languageFor(input.name, input.text);
  const lines = (o.color && !o.all ? highlight(body, lang) : body).split('\n');
  const [from, to] = lineRange(o.range, lines.length);
  const g = (s: string): string => (o.color ? `${GRID}${s}${RESET}` : s);
  const rule = (mid: string): string => g(`${'─'.repeat(GUTTER)}${mid}${'─'.repeat(cols - GUTTER - 1)}`);
  const out: string[] = [];
  const name = input.name === '-' ? 'STDIN' : input.name;
  if (o.style.grid) out.push(rule('┬'));
  if (o.style.header) out.push(o.style.grid ? `${' '.repeat(GUTTER)}${g('│')} File: ${name}` : `File: ${name}`);
  if (o.style.grid) out.push(rule('┼'));
  lines.forEach((l, i) => {
    const n = i + 1;
    if (n < from || n > to) return;
    const num = g(String(n).padStart(4));
    if (o.style.grid) out.push(`${num}   ${g('│')} ${l}`);
    else out.push(o.style.numbers ? `${num} ${l}` : l);
  });
  if (o.style.grid) out.push(rule('┴'));
  return `${out.join('\n')}\n`;
}

function* readInput(ctx: Ctx, name: string): Gen<Input | string> {
  if (name === '-') return { name, text: yield* ctx.readAll() };
  try {
    const text = ctx.sh.env.fs.readFile(ctx.resolve(name), ctx.cred);
    return { name, text };
  } catch (e) {
    const why = errMsg(e);
    return why === 'Is a directory' ? `'${name}' is a directory.` : `'${name}': ${why} (os error ${why === 'Permission denied' ? 13 : 2})`;
  }
}

function* bat(ctx: Ctx): Gen<number> {
  const p = gnuOpts(ctx.argv.slice(1), {
    flags: 'pnAPuV', withArg: 'lr',
    long: { plain: 'p', number: 'n', 'show-all': 'A', 'language=': 'l', 'line-range=': 'r', 'style=': 'style', 'color=': 'color', 'paging=': 'paging', 'theme=': 'theme', 'list-languages': 'list', version: 'V', 'decorations=': 'decorations', 'wrap=': 'wrap', 'tabs=': 'tabs' },
  });
  if (p.error) return usageError(ctx, p.error);
  if (p.opts.has('V')) { ctx.out('bat 0.25.0\n'); return 0; }
  if (p.opts.has('list')) { ctx.out(`${LANGUAGE_LIST.join('\n')}\n`); return 0; }
  const tty = isTty(ctx.fds.get(1));
  const colorOpt = p.opts.get('color');
  const color = colorOpt === 'always' || (colorOpt !== 'never' && tty);
  const langName = p.opts.get('l');
  const lang = typeof langName === 'string' ? languageByName(langName) : undefined;
  if (typeof langName === 'string' && !lang) { ctx.err(`[bat error]: unknown syntax: '${langName}'\n`); return 1; }
  const plain = (p.multi.get('p')?.length ?? 0) + (p.opts.has('p') ? 1 : 0);
  const decorated = p.opts.get('decorations') === 'always' || tty;
  const style = styleFrom(p.opts.get('style'), plain, p.opts.has('n'), decorated);
  let status = 0;
  for (const name of p.operands.length ? p.operands : ['-']) {
    const input = yield* readInput(ctx, name);
    if (typeof input === 'string') { ctx.err(`[bat error]: ${input}\n`); status = 1; continue; }
    ctx.out(render(ctx, input, { style, color, lang, all: p.opts.has('A'), range: p.opts.get('r') }));
  }
  return status;
}

function whereis(ctx: Ctx): number {
  const p = gnuOpts(ctx.argv.slice(1), { flags: 'bmsul' });
  if (p.error) return usageError(ctx, p.error);
  if (p.opts.has('l')) {
    ctx.out([...BIN_DIRS.map((d) => `bin: ${d}`), 'man: /usr/share/man/man1', 'man: /usr/share/man/man8', ...EXTRA_DIRS.map((d) => `bin: ${d}`)].join('\n') + '\n');
    return 0;
  }
  const only = ['b', 'm', 's'].filter((k) => p.opts.has(k));
  const want = (k: string): boolean => only.length === 0 || only.includes(k);
  const fs = ctx.sh.env.fs;
  for (const name of p.operands) {
    const found: string[] = [];
    if (want('b')) {
      found.push(...BIN_DIRS.map((d) => `${d}/${name}`).filter((f) => fs.tryLookup(f)?.kind === 'file'));
      found.push(...EXTRA_DIRS.map((d) => `${d}/${name}`).filter((f) => fs.exists(f)));
      if (name === 'bash' && fs.exists('/etc/bash.bashrc')) found.push('/etc/bash.bashrc');
    }
    const section = want('m') ? manSection(name) : undefined;
    if (section) found.push(`/usr/share/man/man${section}/${name}.${section}.gz`);
    ctx.out(`${name}:${found.map((f) => ` ${f}`).join('')}\n`);
  }
  return 0;
}

export const BAT_TOOLS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['batcat', bat], ['whereis', whereis]]);
