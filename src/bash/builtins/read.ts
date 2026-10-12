/** read, mapfile/readarray, getopts. */
import type { CommandFn, Ctx, Gen, Source } from '../types.ts';
import { builtinError, readLineFrom } from '../io.ts';
import { isName } from '../vars.ts';
import { parseOpts, badOption, flagStr } from './util.ts';

interface Ch {
  readonly c: string;
  readonly esc: boolean;
}

/** Reads one record: up to `delim` (or `n` characters). Returns null at end of input with nothing read. */
function* readRecord(src: Source | undefined, delim: string, n: number | undefined, exact: boolean, prompt: string, secret: boolean): Gen<{ text: string; eof: boolean } | null> {
  if (src?.kind === 'data') {
    if (src.pos >= src.data.length) return null;
    let end = src.pos;
    const limit = n === undefined ? Infinity : n;
    let count = 0;
    while (end < src.data.length && count < limit && (exact || src.data[end] !== delim)) { end++; count++; }
    const text = src.data.slice(src.pos, end);
    const hitDelim = end < src.data.length && src.data[end] === delim && !exact && count < limit;
    src.pos = hitDelim ? end + 1 : end;
    return { text, eof: !hitDelim && (n === undefined || count < limit) && src.pos >= src.data.length };
  }
  const first = yield* readLineFrom(src, prompt, secret);
  if (first === null) return null;
  let text = first.text;
  if (delim !== '\n') {
    while (!text.includes(delim)) {
      const more = yield* readLineFrom(src, '', secret);
      if (more === null) return { text, eof: true };
      text += `\n${more.text}`;
    }
    text = text.slice(0, text.indexOf(delim));
  }
  return { text: n === undefined ? text : Array.from(text).slice(0, n).join(''), eof: false };
}

/** Backslash processing of read without -r (escaped characters are never separators). */
function unescape(text: string, raw: boolean): Ch[] {
  const out: Ch[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] ?? '';
    if (!raw && c === '\\' && i + 1 < chars.length) { out.push({ c: chars[++i] ?? '', esc: true }); continue; }
    if (!raw && c === '\\') continue;
    out.push({ c, esc: false });
  }
  return out;
}

/** Splits into at most `max` fields (the last one keeps the rest of the line). */
export function splitRead(chars: readonly Ch[], ifs: string, max: number): string[] {
  const isWs = (ch: Ch): boolean => !ch.esc && ifs.includes(ch.c) && /\s/.test(ch.c);
  const isSep = (ch: Ch): boolean => !ch.esc && ifs.includes(ch.c);
  const fields: string[] = [];
  let i = 0;
  while (i < chars.length && isWs(chars[i] as Ch)) i++;
  while (i < chars.length) {
    if (fields.length === max - 1) {
      let end = chars.length;
      while (end > i && isWs(chars[end - 1] as Ch)) end--;
      fields.push(chars.slice(i, end).map((c) => c.c).join(''));
      return fields;
    }
    let field = '';
    while (i < chars.length && !isSep(chars[i] as Ch)) field += (chars[i++] as Ch).c;
    fields.push(field);
    while (i < chars.length && isWs(chars[i] as Ch)) i++;
    if (i < chars.length && isSep(chars[i] as Ch)) {
      i++;
      while (i < chars.length && isWs(chars[i] as Ch)) i++;
    }
  }
  return fields;
}

function* readBuiltin(ctx: Ctx): Gen<number> {
  const p = parseOpts(ctx.argv.slice(1), 'ersa:d:i:n:N:p:t:u:E');
  if (p.bad) return badOption(ctx, p.bad, 'read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]');
  const sh = ctx.sh;
  const names = p.rest;
  for (const n of [...names, flagStr(p, 'a') ?? 'REPLY']) if (!isName(n)) return builtinError(ctx, `\`${n}': not a valid identifier`);
  const fd = flagStr(p, 'u') !== undefined ? Number(flagStr(p, 'u')) : 0;
  const src = ctx.fds.get(fd)?.read;
  if (!src) return builtinError(ctx, `${fd}: invalid file descriptor: Bad file descriptor`);
  if (flagStr(p, 't') === '0') return src.kind === 'data' && src.pos < src.data.length ? 0 : 1;
  const delim = flagStr(p, 'd') !== undefined ? (flagStr(p, 'd') || '\0') : '\n';
  const nArg = flagStr(p, 'N') ?? flagStr(p, 'n');
  const raw = p.flags.has('r');
  let rec = yield* readRecord(src, delim, nArg === undefined ? undefined : Number(nArg), flagStr(p, 'N') !== undefined, flagStr(p, 'p') ?? '', p.flags.has('s'));
  if (rec === null) {
    for (const n of names) sh.trySetVar(n, '');
    if (!names.length && !flagStr(p, 'a')) sh.trySetVar('REPLY', '');
    return 1;
  }
  while (!raw && rec && rec.text.endsWith('\\') && !rec.text.endsWith('\\\\') && delim === '\n' && nArg === undefined) {
    const more: { text: string; eof: boolean } | null = yield* readRecord(src, delim, undefined, false, '', p.flags.has('s'));
    rec = { text: rec.text.slice(0, -1) + (more?.text ?? ''), eof: more ? more.eof : true };
    if (!more) break;
  }
  const chars = unescape(rec.text, raw);
  const ifs = sh.vars.get('IFS') ? sh.getVar('IFS') ?? '' : ' \t\n';
  const arrayName = flagStr(p, 'a');
  if (arrayName) {
    sh.vars.unset(arrayName);
    sh.vars.setArray(arrayName, splitRead(chars, ifs, Infinity).map((value) => ({ value })), false);
  } else if (!names.length) {
    if (!sh.trySetVar('REPLY', chars.map((c) => c.c).join(''))) return 1;
  } else {
    const fields = splitRead(chars, ifs, names.length);
    for (let i = 0; i < names.length; i++) if (!sh.trySetVar(names[i] ?? '', fields[i] ?? '')) return 1;
  }
  return rec.eof ? 1 : 0;
}

function* mapfile(ctx: Ctx): Gen<number> {
  const p = parseOpts(ctx.argv.slice(1), 'd:n:O:s:tu:C:c:');
  if (p.bad) return badOption(ctx, p.bad, 'mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]');
  const sh = ctx.sh;
  const name = p.rest[0] ?? 'MAPFILE';
  if (!isName(name)) return builtinError(ctx, `\`${name}': not a valid identifier`);
  const src = ctx.fds.get(flagStr(p, 'u') !== undefined ? Number(flagStr(p, 'u')) : 0)?.read;
  const delim = flagStr(p, 'd') !== undefined ? (flagStr(p, 'd') || '\0') : '\n';
  const max = Number(flagStr(p, 'n') ?? 0) || Infinity;
  let skip = Number(flagStr(p, 's') ?? 0);
  const origin = Number(flagStr(p, 'O') ?? 0);
  if (flagStr(p, 'O') === undefined) sh.vars.unset(name);
  const items: { key: number; value: string }[] = [];
  while (items.length < max) {
    const rec = yield* readRecord(src, delim, undefined, false, '', false);
    if (rec === null) break;
    if (skip > 0) { skip--; continue; }
    items.push({ key: origin + items.length, value: p.flags.has('t') || rec.eof ? rec.text : rec.text + delim });
    if (rec.eof) break;
  }
  sh.vars.setArray(name, items, false, true);
  return 0;
}

function getopts(ctx: Ctx): number {
  const sh = ctx.sh;
  const [spec, name, ...given] = ctx.argv.slice(1);
  if (spec === undefined || name === undefined) {
    builtinError(ctx, 'usage: getopts optstring name [arg ...]', 2);
    return 2;
  }
  const args = given.length ? given : sh.args;
  const silent = spec.startsWith(':');
  let optind = Number(sh.getVar('OPTIND') ?? '1') || 1;
  if (optind !== sh.getoptsState.optind || optind === 1 && sh.getoptsState.optind !== 1) sh.getoptsState = { optind, pos: 1 };
  const arg = args[optind - 1];
  const done = (): number => { sh.trySetVar(name, '?'); sh.setVar('OPTIND', String(optind)); sh.getoptsState = { optind, pos: 1 }; return 1; };
  if (arg === undefined || !arg.startsWith('-') || arg === '-') return done();
  if (arg === '--') { optind++; return done(); }
  const c = arg[sh.getoptsState.pos] ?? '';
  let pos = sh.getoptsState.pos + 1;
  const next = (): void => {
    if (pos >= arg.length) { optind++; pos = 1; }
    sh.setVar('OPTIND', String(optind));
    sh.getoptsState = { optind, pos };
  };
  const at = c === ':' ? -1 : spec.indexOf(c);
  if (at < 0) {
    if (silent) sh.setVar('OPTARG', c);
    else { ctx.err(`${sh.arg0}: illegal option -- ${c}\n`); sh.vars.unset('OPTARG'); }
    sh.trySetVar(name, '?');
    next();
    return 0;
  }
  if (spec[at + 1] === ':') {
    let value: string | undefined = arg.slice(pos);
    if (value === '') { value = args[optind]; optind++; }
    pos = arg.length;
    if (value === undefined) {
      if (silent) { sh.trySetVar(name, ':'); sh.setVar('OPTARG', c); }
      else { ctx.err(`${sh.arg0}: option requires an argument -- ${c}\n`); sh.trySetVar(name, '?'); sh.vars.unset('OPTARG'); }
      next();
      return 0;
    }
    sh.setVar('OPTARG', value);
  } else sh.vars.unset('OPTARG');
  sh.trySetVar(name, c);
  next();
  return 0;
}

export const READ: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['read', readBuiltin], ['mapfile', mapfile], ['readarray', mapfile], ['getopts', getopts]]);
