/** declare typeset local export readonly unset set shopt. */
import type { CommandFn, Ctx, DeclArg } from '../types.ts';
import type { Interp } from '../interp.ts';
import { SET_OPTIONS, SET_LETTERS } from '../options.ts';
import type { SetOption } from '../options.ts';
import type { Attr, Var } from '../vars.ts';
import { VarError, isName, scalarOf } from '../vars.ts';
import { declareLine } from '../params.ts';
import { builtinError } from '../io.ts';
import { parseOpts, badOption, shellQuote } from './util.ts';
import { functionText } from '../deparse.ts';

const DECLARE_USAGE = 'declare [-aAfFgiIlnrtux] [name[=value] ...] or declare -p [-aAfFilnrtux] [name ...]';
const ATTR_LETTERS: readonly Attr[] = ['a', 'A', 'i', 'l', 'n', 'r', 't', 'u', 'x'];

function printVars(ctx: Ctx, filter: (v: Var) => boolean, prefix = ''): number {
  for (const [name, v] of ctx.sh.vars.visible()) {
    if (filter(v)) ctx.out(`${prefix}${declareLine(name, v.attrs, v.value)}\n`.replace(/^declare /, prefix ? '' : 'declare '));
  }
  return 0;
}

function applyDecl(sh: Interp, name: string, d: DeclArg | undefined, attrs: { add: Set<Attr>; remove: Set<Attr> }, local: boolean): void {
  if (!isName(name)) throw new VarError(`\`${d ? `${name}=${d.value ?? ''}` : name}': not a valid identifier`);
  const v = sh.vars.declare(name, local);
  if (v.attrs.has('r') && (d || attrs.remove.size)) throw new VarError(`${name}: readonly variable`);
  for (const a of attrs.remove) if (a !== 'r') v.attrs.delete(a);
  for (const a of attrs.add) if (a !== 'r') v.attrs.add(a);
  if (attrs.add.has('l')) v.attrs.delete('u');
  if (attrs.add.has('u')) v.attrs.delete('l');
  if (attrs.add.has('a') && !v.value) v.value = { t: 'arr', v: new Map() };
  if (attrs.add.has('A') && (!v.value || v.value.t !== 'assoc')) {
    if (v.value?.t === 'arr' && v.value.v.size) throw new VarError(`${name}: cannot convert indexed to associative array`);
    v.value = { t: 'assoc', v: new Map() };
  }
  if (d?.array) sh.vars.setArray(name, d.array.map((e) => ({ key: e.key !== undefined && !v.attrs.has('A') ? String(sh.arith.eval(e.key)) : e.key, value: v.attrs.has('i') ? String(sh.arith.eval(e.value)) : e.value })), v.attrs.has('A'), d.append);
  else if (d?.index !== undefined) sh.vars.setElement(name, v.attrs.has('A') ? d.index : Number(sh.arith.eval(d.index)), d.value ?? '', d.append);
  else if (d) sh.vars.set(name, d.value ?? '', { append: d.append, arith: (s) => String(sh.arith.eval(s)) });
  if (attrs.add.has('r')) v.attrs.add('r');
}

function declareCommon(ctx: Ctx, mode: 'declare' | 'local' | 'export' | 'readonly'): number {
  const sh = ctx.sh;
  const spec = mode === 'export' ? 'fnp' : mode === 'readonly' ? 'aAfp' : 'aAfFgiIlnprtux';
  const p = parseOpts(ctx.argv.slice(1), spec, mode === 'declare' || mode === 'local');
  if (p.bad) return badOption(ctx, p.bad, mode === 'export' ? 'export [-fn] [name[=value] ...] or export -p' : mode === 'readonly' ? 'readonly [-aAf] [name[=value] ...] or readonly -p' : DECLARE_USAGE);
  if (mode === 'local' && sh.vars.depth() === 0) return builtinError(ctx, 'can only be used in a function');
  const add = new Set<Attr>(ATTR_LETTERS.filter((a) => p.flags.has(a)));
  const remove = new Set<Attr>(ATTR_LETTERS.filter((a) => p.plus.has(a)));
  if (mode === 'export') (p.flags.has('n') ? remove : add).add('x');
  if (mode === 'readonly') add.add('r');
  if (p.flags.has('f') || p.flags.has('F')) return functions(ctx, p.rest, p.flags.has('F'), mode);
  const firstIndex = ctx.argv.length - p.rest.length;
  if (!p.rest.length || p.flags.has('p')) return listDeclared(ctx, p.rest, add, mode);
  let status = 0;
  const local = mode === 'local' || (mode === 'declare' && sh.vars.depth() > 0 && !p.flags.has('g'));
  p.rest.forEach((arg, i) => {
    const d = ctx.decl?.get(firstIndex + i);
    try {
      applyDecl(sh, d?.name ?? arg, d, { add, remove }, local);
    } catch (e) {
      if (!(e instanceof VarError)) throw e;
      builtinError(ctx, e.message);
      status = 1;
    }
  });
  return status;
}

function listDeclared(ctx: Ctx, names: readonly string[], attrs: Set<Attr>, mode: string): number {
  const sh = ctx.sh;
  if (!names.length) {
    if (mode === 'export') return printVars(ctx, (v) => v.attrs.has('x'));
    if (mode === 'readonly') return printVars(ctx, (v) => v.attrs.has('r'));
    if (!attrs.size && !ctx.argv.includes('-p')) {
      for (const [name, v] of sh.vars.visible()) if (v.value) ctx.out(`${setLine(name, v)}\n`);
      return 0;
    }
    return printVars(ctx, (v) => [...attrs].every((a) => v.attrs.has(a) || (a === 'a' && v.value?.t === 'arr') || (a === 'A' && v.value?.t === 'assoc')));
  }
  let status = 0;
  for (const n of names) {
    const v = sh.vars.get(n);
    if (!v) { builtinError(ctx, `${n}: not found`); status = 1; continue; }
    ctx.out(`${declareLine(n, v.attrs, v.value)}\n`);
  }
  return status;
}

function functions(ctx: Ctx, names: readonly string[], namesOnly: boolean, mode: string): number {
  const sh = ctx.sh;
  const list = names.length ? names : [...sh.functions.keys()].sort();
  let status = 0;
  for (const n of list) {
    const def = sh.functions.get(n);
    if (!def) { status = 1; if (names.length && mode !== 'declare') builtinError(ctx, `${n}: not a function`); continue; }
    if (mode === 'readonly') { sh.readonlyFunctions.add(n); continue; }
    if (mode === 'export') { sh.exportedFunctions.add(n); continue; }
    ctx.out(namesOnly ? `declare -f ${n}\n` : `${functionText(def)}\n`);
  }
  return status;
}

/** `set` listing format: name=value with single quotes, arrays as ([0]="…"). */
export function setLine(name: string, v: Var): string {
  if (v.value?.t === 'str') return `${name}=${shellQuote(v.value.v)}`;
  return declareLine(name, v.attrs, v.value).replace(/^declare -\S+ /, '');
}

function unset(ctx: Ctx): number {
  const p = parseOpts(ctx.argv.slice(1), 'fvn');
  if (p.bad) return badOption(ctx, p.bad, 'unset [-f] [-v] [-n] [name ...]');
  const sh = ctx.sh;
  let status = 0;
  for (const arg of p.rest) {
    if (p.flags.has('f') || (!p.flags.has('v') && !sh.vars.get(arg) && sh.functions.has(arg))) {
      if (sh.readonlyFunctions.has(arg)) { builtinError(ctx, `${arg}: cannot unset: readonly function`); status = 1; } else sh.functions.delete(arg);
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$/.exec(arg);
    if (!m) { builtinError(ctx, `\`${arg}': not a valid identifier`); status = 1; continue; }
    try {
      const v = sh.vars.get(m[1] ?? '');
      const key = m[2] === undefined ? undefined : v?.value?.t === 'assoc' ? sh.expander.word(m[2]) : m[2] === '@' || m[2] === '*' ? undefined : Number(sh.arith.eval(m[2]));
      sh.vars.unset(m[1] ?? '', key);
    } catch (e) {
      if (!(e instanceof VarError)) throw e;
      builtinError(ctx, e.message.replace(': readonly variable', ': cannot unset: readonly variable'));
      status = 1;
    }
  }
  return status;
}

function setOptionsListing(ctx: Ctx, asCommands: boolean): number {
  for (const name of SET_OPTIONS) {
    const on = ctx.sh.opt(name);
    ctx.out(asCommands ? `set ${on ? '-' : '+'}o ${name}\n` : `${name.padEnd(15)}\t${on ? 'on' : 'off'}\n`);
  }
  return 0;
}

function set(ctx: Ctx): number {
  const sh = ctx.sh;
  const args = ctx.argv.slice(1);
  if (!args.length) {
    for (const [name, v] of sh.vars.visible()) if (v.value) ctx.out(`${setLine(name, v)}\n`);
    return 0;
  }
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { sh.args = args.slice(i + 1); return 0; }
    if (a === '-' ) { sh.opts.set('xtrace', false); sh.opts.set('verbose', false); sh.args = args.slice(i + 1); return 0; }
    if (!/^[-+]/.test(a)) break;
    const on = a[0] === '-';
    for (const c of a.slice(1)) {
      if (c === 'o') {
        const name = args[++i];
        if (name === undefined) return setOptionsListing(ctx, !on);
        if (!(SET_OPTIONS as readonly string[]).includes(name)) return builtinError(ctx, `${name}: invalid option name`);
        sh.opts.set(name as SetOption, on);
        continue;
      }
      const opt = SET_LETTERS[c];
      if (!opt) return badOption(ctx, `${a[0]}${c}`, 'set [-abefhkmnptuvxBCEHPT] [-o option-name] [--] [-] [arg ...]');
      sh.opts.set(opt, on);
    }
  }
  if (i < args.length) sh.args = args.slice(i);
  return 0;
}

function shopt(ctx: Ctx): number {
  const sh = ctx.sh;
  const p = parseOpts(ctx.argv.slice(1), 'pqsuo');
  if (p.bad) return badOption(ctx, p.bad, 'shopt [-pqsu] [-o] [optname ...]');
  const useSet = p.flags.has('o');
  const all = useSet ? [...SET_OPTIONS] as string[] : [...sh.shopt.keys()].sort();
  const get = (n: string): boolean | undefined => (useSet ? ((SET_OPTIONS as readonly string[]).includes(n) ? sh.opt(n as SetOption) : undefined) : sh.shopt.get(n));
  const names = p.rest.length ? p.rest : all;
  let status = 0;
  for (const n of names) {
    const cur = get(n);
    if (cur === undefined) { builtinError(ctx, `${n}: invalid ${useSet ? 'option name' : 'shell option name'}`); status = 1; continue; }
    if (p.flags.has('s') || p.flags.has('u')) {
      if (!p.rest.length) { if (cur === p.flags.has('s')) printShopt(ctx, n, cur, true, useSet); continue; }
      if (useSet) sh.opts.set(n as SetOption, p.flags.has('s'));
      else sh.shopt.set(n, p.flags.has('s'));
      continue;
    }
    if (!cur) status = 1;
    if (!p.flags.has('q')) printShopt(ctx, n, cur, p.flags.has('p'), useSet);
  }
  return status;
}

function printShopt(ctx: Ctx, n: string, on: boolean, asCommand: boolean, useSet: boolean): void {
  ctx.out(asCommand ? `${useSet ? 'set' : 'shopt'} ${useSet ? (on ? '-o' : '+o') : on ? '-s' : '-u'} ${n}\n` : `${n.padEnd(15)}\t${on ? 'on' : 'off'}\n`);
}

export const VARS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([
  ['declare', (c) => declareCommon(c, 'declare')], ['typeset', (c) => declareCommon(c, 'declare')], ['local', (c) => declareCommon(c, 'local')],
  ['export', (c) => declareCommon(c, 'export')], ['readonly', (c) => declareCommon(c, 'readonly')], ['unset', unset], ['set', set], ['shopt', shopt],
]);

export { scalarOf };
