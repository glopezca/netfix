/** find: tests, actions and operators of GNU findutils on the virtual file system. */
import type { Ctx, Gen } from '../types.ts';
import type { StatInfo } from '../vfs.ts';
import { normalize, canAccess } from '../vfs.ts';
import { matchPattern } from '../glob.ts';
import { errMsg } from './common.ts';
import { modeString, lsDate } from './ls.ts';
import { compile } from './regex.ts';

type Node =
  | { k: 'and' | 'or'; l: Node; r: Node }
  | { k: 'not'; e: Node }
  | { k: 'test'; name: string; arg: string }
  | { k: 'exec'; argv: string[]; plus: boolean }
  | { k: 'true' };

interface Visit {
  readonly path: string;
  readonly abs: string;
  readonly name: string;
  readonly depth: number;
  readonly st: StatInfo;
}

class FindError extends Error {}

const WITH_ARG = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-type', '-size', '-perm', '-user', '-group', '-newer', '-mtime', '-mmin', '-regex', '-iregex', '-printf', '-maxdepth', '-mindepth', '-uid', '-gid', '-links', '-fprint']);
const NO_ARG = new Set(['-print', '-print0', '-delete', '-empty', '-prune', '-quit', '-ls', '-true', '-false', '-readable', '-writable', '-executable', '-depth', '-xdev', '-follow', '-nouser', '-nogroup']);

function parseExpr(tokens: string[]): { node: Node; hasAction: boolean; opts: Map<string, string> } {
  let i = 0;
  let hasAction = false;
  const opts = new Map<string, string>();
  const or = (): Node => { let l = and(); while (tokens[i] === '-o' || tokens[i] === '-or') { i++; l = { k: 'or', l, r: and() }; } return l; };
  const and = (): Node => {
    let l = not();
    while (i < tokens.length && tokens[i] !== '-o' && tokens[i] !== '-or' && tokens[i] !== ')') {
      if (tokens[i] === '-a' || tokens[i] === '-and') i++;
      l = { k: 'and', l, r: not() };
    }
    return l;
  };
  const not = (): Node => {
    if (tokens[i] === '!' || tokens[i] === '-not') { i++; return { k: 'not', e: not() }; }
    return primary();
  };
  const primary = (): Node => {
    const t = tokens[i++];
    if (t === undefined) throw new FindError('expected an expression');
    if (t === '(') { const e = or(); if (tokens[i++] !== ')') throw new FindError("invalid expression; I was expecting to find a ')' somewhere but did not see one."); return e; }
    if (t === '-exec' || t === '-execdir' || t === '-ok') {
      hasAction = true;
      const argv: string[] = [];
      while (i < tokens.length && tokens[i] !== ';' && !(tokens[i] === '+' && tokens[i - 1] === '{}')) argv.push(tokens[i++] ?? '');
      const end = tokens[i++];
      if (end === undefined) throw new FindError(`missing argument to \`${t}'`);
      return { k: 'exec', argv, plus: end === '+' };
    }
    if (t === '-maxdepth' || t === '-mindepth') { opts.set(t, tokens[i++] ?? '0'); return { k: 'true' }; }
    if (t === '-depth') { opts.set('-depth', '1'); return { k: 'true' }; }
    if (WITH_ARG.has(t)) {
      const arg = tokens[i++];
      if (arg === undefined) throw new FindError(`missing argument to \`${t}'`);
      if (t === '-printf' || t === '-fprint') hasAction = true;
      return { k: 'test', name: t, arg };
    }
    if (NO_ARG.has(t)) {
      if (['-print', '-print0', '-delete', '-ls', '-quit'].includes(t)) hasAction = true;
      return { k: 'test', name: t, arg: '' };
    }
    throw new FindError(t.startsWith('-') ? `unknown predicate \`${t}'` : `paths must precede expression: \`${t}'`);
  };
  if (!tokens.length) return { node: { k: 'true' }, hasAction, opts };
  const node = or();
  if (i < tokens.length) throw new FindError(`unexpected extra predicate '${tokens[i] ?? ''}'`);
  return { node, hasAction, opts };
}

function cmpNum(spec: string, value: number): boolean {
  const n = Number(spec.replace(/^[+-]/, ''));
  return spec.startsWith('+') ? value > n : spec.startsWith('-') ? value < n : value === n;
}

function sizeTest(spec: string, bytes: number): boolean {
  const m = /^([+-]?)(\d+)([bckwMG]?)$/.exec(spec);
  if (!m) return false;
  const unit = { b: 512, c: 1, w: 2, k: 1024, M: 1048576, G: 1073741824, '': 512 }[m[3] as 'b'] ?? 512;
  return cmpNum(`${m[1]}${m[2]}`, Math.ceil(bytes / unit));
}

type Parsed = ReturnType<typeof parseExpr>;

function typeMatches(spec: string, kind: StatInfo['kind']): boolean {
  const map: Readonly<Record<string, StatInfo['kind']>> = { f: 'file', d: 'dir', l: 'link', c: 'dev' };
  return spec.split(',').some((t) => map[t] === kind);
}

function permMatches(spec: string, mode: number): boolean {
  const want = parseInt(spec.replace(/^[-/]/, ''), 8);
  const m = mode & 0o7777;
  return spec.startsWith('-') ? (m & want) === want : spec.startsWith('/') ? (m & want) !== 0 : m === want;
}

/** One run of find: the walk, the expression and the -exec ... + batches. */
class FindRun {
  status = 0;
  private quit = false;
  private pruned = false;
  private readonly batches = new Map<Node, string[]>();
  private readonly ctx: Ctx;
  private readonly parsed: Parsed;
  private readonly maxDepth: number;
  private readonly minDepth: number;
  private readonly post: boolean;

  constructor(ctx: Ctx, parsed: Parsed, post: boolean) {
    this.ctx = ctx;
    this.parsed = parsed;
    this.maxDepth = Number(parsed.opts.get('-maxdepth') ?? Infinity);
    this.minDepth = Number(parsed.opts.get('-mindepth') ?? 0);
    this.post = post;
  }

  private owner(id: number, group: boolean): string {
    const u = this.ctx.sh.env.users().find((x) => (group ? x.gid : x.uid) === id);
    return u?.name ?? String(id);
  }

  /** Tests that only look at the file. */
  private matches(name: string, arg: string, v: Visit): boolean | undefined {
    const fs = this.ctx.sh.env.fs;
    const users = this.ctx.sh.env.users();
    const now = this.ctx.sh.env.now();
    switch (name) {
      case '-name': return matchPattern(arg, v.name);
      case '-iname': return matchPattern(arg, v.name, { nocase: true });
      case '-path': case '-wholename': return matchPattern(arg, v.path);
      case '-ipath': return matchPattern(arg, v.path, { nocase: true });
      case '-regex': return compile(`^(?:${arg})$`, { extended: false }).test(v.path);
      case '-iregex': return compile(`^(?:${arg})$`, { extended: false, icase: true }).test(v.path);
      case '-type': return typeMatches(arg, v.st.kind);
      case '-size': return sizeTest(arg, v.st.size);
      case '-empty': return v.st.kind === 'dir' ? fs.readdir(v.abs, this.ctx.cred).length === 0 : v.st.kind === 'file' && v.st.size === 0;
      case '-perm': return permMatches(arg, v.st.mode);
      case '-user': return users.find((u) => u.name === arg)?.uid === v.st.uid || String(v.st.uid) === arg;
      case '-group': return users.find((u) => u.name === arg)?.gid === v.st.gid || String(v.st.gid) === arg;
      case '-uid': return cmpNum(arg, v.st.uid);
      case '-gid': return cmpNum(arg, v.st.gid);
      case '-newer': try { return v.st.mtime > fs.stat(this.ctx.resolve(arg), this.ctx.cred).mtime; } catch { throw new FindError(`‘${arg}’: No such file or directory`); }
      case '-mtime': return cmpNum(arg, Math.floor((now - v.st.mtime) / 86_400_000));
      case '-mmin': return cmpNum(arg, Math.floor((now - v.st.mtime) / 60_000));
      case '-readable': return canAccess(v.st, this.ctx.cred, 4);
      case '-writable': return canAccess(v.st, this.ctx.cred, 2);
      case '-executable': return canAccess(v.st, this.ctx.cred, 1);
      case '-false': return false;
      default: return undefined;
    }
  }

  private printf(fmt: string, v: Visit): string {
    const fields: Readonly<Record<string, string>> = {
      p: v.path, P: v.path, f: v.name, s: String(v.st.size), d: String(v.depth), m: (v.st.mode & 0o777).toString(8),
      u: this.owner(v.st.uid, false), h: v.path.includes('/') ? v.path.slice(0, v.path.lastIndexOf('/')) : '.', '%': '%',
    };
    return fmt.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%([pfsdmuhP%])/g, (_m, c: string) => fields[c] ?? '');
  }

  /** Actions (they print, delete or stop the walk) and the remaining tests. */
  private test(name: string, arg: string, v: Visit): boolean {
    const m = this.matches(name, arg, v);
    if (m !== undefined) return m;
    const ctx = this.ctx;
    switch (name) {
      case '-print': ctx.out(`${v.path}\n`); return true;
      case '-print0': ctx.out(`${v.path}\0`); return true;
      case '-ls': ctx.out(`${String(1000 + v.name.length).padStart(8)}      4 ${modeString(v.st)}   1 ${this.owner(v.st.uid, false)} ${this.owner(v.st.gid, true)} ${String(v.st.size).padStart(8)} ${lsDate(v.st.mtime, ctx.sh.env.now())} ${v.path}\n`); return true;
      case '-printf': ctx.out(this.printf(arg, v)); return true;
      case '-delete':
        try { ctx.sh.env.fs.remove(v.abs, ctx.cred, false, true); } catch (e) { ctx.err(`find: cannot delete ‘${v.path}’: ${errMsg(e)}\n`); this.status = 1; }
        return true;
      case '-prune': this.pruned = true; return true;
      case '-quit': this.quit = true; return true;
      default: return true;
    }
  }

  private *evalNode(n: Node, v: Visit): Gen<boolean> {
    switch (n.k) {
      case 'true': return true;
      case 'and': return (yield* this.evalNode(n.l, v)) && (yield* this.evalNode(n.r, v));
      case 'or': return (yield* this.evalNode(n.l, v)) || (yield* this.evalNode(n.r, v));
      case 'not': return !(yield* this.evalNode(n.e, v));
      case 'exec': {
        if (n.plus) { this.batches.set(n, [...(this.batches.get(n) ?? []), v.path]); return true; }
        return (yield* this.ctx.sh.invoke(n.argv.map((a) => a.split('{}').join(v.path)), this.ctx.fds)) === 0;
      }
      case 'test': return this.test(n.name, n.arg, v);
    }
  }

  private *check(v: Visit): Gen<void> {
    if (v.depth < this.minDepth) return;
    const ok = yield* this.evalNode(this.parsed.node, v);
    if (ok && !this.parsed.hasAction) this.ctx.out(`${v.path}\n`);
  }

  *visit(abs: string, path: string, depth: number): Gen<void> {
    if (this.quit) return;
    const { ctx } = this;
    ctx.sh.tick();
    let st: StatInfo;
    try { st = ctx.sh.env.fs.stat(abs, ctx.cred, false); } catch (e) { ctx.err(`find: ‘${path}’: ${errMsg(e)}\n`); this.status = 1; return; }
    const v: Visit = { path, abs, name: depth === 0 ? path : abs.slice(abs.lastIndexOf('/') + 1), depth, st };
    this.pruned = false;
    if (!this.post) yield* this.check(v);
    if (st.kind === 'dir' && depth < this.maxDepth && !this.pruned) {
      let names: string[] = [];
      try { names = ctx.sh.env.fs.readdir(abs, ctx.cred); } catch (e) { ctx.err(`find: ‘${path}’: ${errMsg(e)}\n`); this.status = 1; }
      for (const n of names) yield* this.visit(normalize(n, abs), `${path.replace(/\/$/, '')}/${n}`, depth + 1);
    }
    if (this.post) yield* this.check(v);
  }

  *flush(): Gen<void> {
    for (const [n, paths] of this.batches) if (n.k === 'exec') yield* this.ctx.sh.invoke(n.argv.flatMap((a) => (a === '{}' ? paths : [a])), this.ctx.fds);
  }
}

export function* find(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  const firstExpr = args.findIndex((a) => a.startsWith('-') || a === '!' || a === '(');
  const starts = firstExpr < 0 ? args : args.slice(0, firstExpr);
  let parsed: Parsed;
  try { parsed = parseExpr(firstExpr < 0 ? [] : args.slice(firstExpr)); } catch (e) { ctx.err(`find: ${errMsg(e)}\n`); return 1; }
  const run = new FindRun(ctx, parsed, parsed.opts.has('-depth') || args.includes('-delete'));
  try {
    for (const s of starts.length ? starts : ['.']) yield* run.visit(ctx.resolve(s), s, 0);
    yield* run.flush();
  } catch (e) {
    if (e instanceof FindError) { ctx.err(`find: ${e.message}\n`); return 1; }
    throw e;
  }
  return run.status;
}
