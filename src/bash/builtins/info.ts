/** type hash help enable, and the description used by `command -v/-V`. */
import type { CommandFn, Ctx } from '../types.ts';
import type { Interp } from '../interp.ts';
import { builtinError } from '../io.ts';
import { findInPath } from '../path.ts';
import { parseOpts, badOption } from './util.ts';
import { functionText } from '../deparse.ts';
import { BUILTIN_DOCS } from '../../docs/bash-builtins.ts';

export const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while', 'until', 'do', 'done', 'in', 'function', 'time', '{', '}', '!', '[[', ']]', 'coproc']);

export interface Description {
  readonly kind: 'alias' | 'keyword' | 'function' | 'builtin' | 'file';
  /** `type` text. */
  readonly long: string;
  /** `command -v` text. */
  readonly short: string;
}

/** Every meaning of a name, in lookup order (type -a). */
export function describeAll(sh: Interp, name: string, pathOnly = false): Description[] {
  const out: Description[] = [];
  if (!pathOnly) {
    const alias = sh.aliases.get(name);
    if (alias !== undefined) out.push({ kind: 'alias', long: `${name} is aliased to \`${alias}'`, short: `alias ${name}='${alias.replace(/'/g, "'\\''")}'` });
    if (KEYWORDS.has(name)) out.push({ kind: 'keyword', long: `${name} is a shell keyword`, short: name });
    const def = sh.functions.get(name);
    if (def) out.push({ kind: 'function', long: `${name} is a function\n${functionText(def)}`, short: name });
    if (sh.isBuiltin(name)) out.push({ kind: 'builtin', long: `${name} is a shell builtin`, short: name });
  }
  const path = name.includes('/') ? (sh.env.fs.tryLookup(sh.resolvePath(name), sh.cred)?.kind === 'file' ? name : undefined) : findInPath(sh, name);
  if (path) out.push({ kind: 'file', long: `${name} is ${path}`, short: path });
  return out;
}

function type(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'afptP');
  if (p.bad) return badOption(ctx, p.bad, 'type [-afptP] name [name ...]');
  let status = 0;
  for (const name of p.rest) {
    let all = describeAll(ctx.sh, name, p.flags.has('P'));
    if (p.flags.has('f')) all = all.filter((d) => d.kind !== 'function');
    if (!p.flags.has('a')) all = all.slice(0, 1);
    if (p.flags.has('p') && all[0]?.kind !== 'file') all = [];
    if (!all.length) {
      status = 1;
      if (!p.flags.has('t') && !p.flags.has('p') && !p.flags.has('P')) builtinError(ctx, `${name}: not found`);
      continue;
    }
    for (const d of all) ctx.out(`${p.flags.has('t') ? d.kind : p.flags.has('p') || p.flags.has('P') ? d.short : d.long}\n`);
  }
  return status;
}

function hash(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'rdltp:');
  if (p.bad) return badOption(ctx, p.bad, 'hash [-lr] [-p pathname] [-dt] [name ...]');
  const sh = ctx.sh;
  if (p.flags.has('r')) { sh.hashed.clear(); return 0; }
  if (!p.rest.length) {
    if (!sh.hashed.size) { ctx.out('hash: hash table empty\n'); return 0; }
    ctx.out(`hits\tcommand\n${[...sh.hashed].map(([, v]) => `   1\t${v}`).join('\n')}\n`);
    return 0;
  }
  let status = 0;
  for (const n of p.rest) {
    const path = findInPath(sh, n);
    if (!path) { builtinError(ctx, `${n}: not found`); status = 1; continue; }
    sh.hashed.set(n, path);
  }
  return status;
}

function help(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'dms');
  if (p.bad) return badOption(ctx, p.bad, 'help [-dms] [pattern ...]');
  if (!p.rest.length) {
    ctx.out('GNU bash, version 5.3.20(1)-release (x86_64-pc-linux-gnu) — netsim\n');
    ctx.out('Órdenes internas (builtins). Escribe `help nombre` para ver una, o abre la pestaña Documentación.\n\n');
    const names = Object.keys(BUILTIN_DOCS).sort();
    for (let i = 0; i < names.length; i += 2) ctx.out(`${(BUILTIN_DOCS[names[i] ?? '']?.synopsis ?? '').slice(0, 38).padEnd(40)}${BUILTIN_DOCS[names[i + 1] ?? '']?.synopsis.slice(0, 38) ?? ''}\n`);
    return 0;
  }
  let status = 0;
  for (const pat of p.rest) {
    const hits = Object.entries(BUILTIN_DOCS).filter(([n]) => n === pat || (pat.includes('*') && new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(n)));
    if (!hits.length) { builtinError(ctx, `no help topics match \`${pat}'.  Try \`help help' or \`man -k ${pat}' or \`info ${pat}'.`); status = 1; continue; }
    for (const [n, d] of hits) {
      if (p.flags.has('s')) ctx.out(`${n}: ${d.synopsis}\n`);
      else if (p.flags.has('d')) ctx.out(`${n} - ${d.summary}\n`);
      else ctx.out(`${n}: ${d.synopsis}\n    ${d.summary}\n${d.detail ? `\n${d.detail.split('\n').map((l) => `    ${l}`).join('\n')}\n` : ''}`);
    }
  }
  return status;
}

function enable(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'anpsf:d');
  if (p.bad) return badOption(ctx, p.bad, 'enable [-a] [-dnps] [-f filename] [name ...]');
  const sh = ctx.sh;
  if (!p.rest.length) {
    for (const n of sh.builtinNames()) {
      const off = sh.disabledBuiltins.has(n);
      if (p.flags.has('a') || (p.flags.has('n') ? off : !off)) ctx.out(`enable ${off ? '-n ' : ''}${n}\n`);
    }
    return 0;
  }
  let status = 0;
  for (const n of p.rest) {
    if (!sh.isBuiltin(n, true)) { builtinError(ctx, `${n}: not a shell builtin`); status = 1; continue; }
    if (p.flags.has('n')) sh.disabledBuiltins.add(n);
    else sh.disabledBuiltins.delete(n);
  }
  return status;
}

export const INFO: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['type', type], ['hash', hash], ['help', help], ['enable', enable]]);
