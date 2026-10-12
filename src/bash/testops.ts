/** Operators shared by `test`/`[` and `[[ ]]`: file tests, string and integer comparisons, regex. */
import { isCatastrophic } from './regex-guard.ts';
import type { Interp } from './interp.ts';
import { canAccess } from './vfs.ts';
import { isTty } from './io.ts';
import { SET_OPTIONS } from './options.ts';
import type { SetOption } from './options.ts';

export const UNARY_OPS = new Set(['-a', '-b', '-c', '-d', '-e', '-f', '-g', '-h', '-k', '-p', '-r', '-s', '-t', '-u', '-w', '-x', '-O', '-G', '-L', '-S', '-N', '-o', '-v', '-R', '-z', '-n']);
export const BINARY_OPS = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-ef', '-nt', '-ot', '=~']);

export class TestError extends Error {}

export function unaryTest(sh: Interp, op: string, arg: string): boolean {
  if (op === '-z') return arg === '';
  if (op === '-n') return arg !== '';
  if (op === '-o') return (SET_OPTIONS as readonly string[]).includes(arg) && sh.opt(arg as SetOption);
  if (op === '-v') return varIsSet(sh, arg);
  if (op === '-R') return sh.vars.get(arg)?.attrs.has('n') ?? false;
  if (op === '-t') {
    return isTty(sh.currentFds.get(Number(arg)));
  }
  const fs = sh.env.fs;
  const path = sh.resolvePath(arg);
  if (arg === '') return false;
  const node = op === '-h' || op === '-L' ? fs.tryLookup(path, sh.cred, false) : fs.tryLookup(path, sh.cred);
  if (!node) return false;
  switch (op) {
    case '-a': case '-e': return true;
    case '-f': return node.kind === 'file';
    case '-d': return node.kind === 'dir';
    case '-h': case '-L': return node.kind === 'link';
    case '-c': return node.kind === 'dev';
    case '-b': case '-p': case '-S': case '-N': return false;
    case '-s': return fs.stat(path, sh.cred).size > 0;
    case '-r': return canAccess(node, sh.cred, 4);
    case '-w': return canAccess(node, sh.cred, 2) && !(node.kind === 'file' && node.generated);
    case '-x': return canAccess(node, sh.cred, 1);
    case '-g': return (node.mode & 0o2000) !== 0;
    case '-u': return (node.mode & 0o4000) !== 0;
    case '-k': return (node.mode & 0o1000) !== 0;
    case '-O': return node.uid === sh.user.uid;
    case '-G': return node.gid === sh.user.gid;
    default: return false;
  }
}

function varIsSet(sh: Interp, spec: string): boolean {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$/.exec(spec);
  if (!m) return false;
  if (sh.dynamic(m[1] ?? '') !== undefined) return true;
  const v = sh.vars.get(m[1] ?? '')?.value;
  if (!v) return false;
  if (m[2] === undefined) return v.t === 'str' || (v.t === 'arr' ? v.v.has(0) : v.v.has('0'));
  if (m[2] === '@' || m[2] === '*') return v.t !== 'str' && v.v.size > 0;
  if (v.t === 'assoc') return v.v.has(m[2]);
  const i = Number(sh.arith.eval(m[2]));
  return v.t === 'arr' ? v.v.has(i) : i === 0;
}

/** Integer operand of test (strict) — [[ ]] evaluates arithmetic instead. */
export function integerOf(text: string, cmd: string): bigint {
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new TestError(`${cmd}: ${text}: integer expression expected`);
  return BigInt(t);
}

export function compareInts(op: string, a: bigint, b: bigint): boolean {
  switch (op) {
    case '-eq': return a === b;
    case '-ne': return a !== b;
    case '-lt': return a < b;
    case '-le': return a <= b;
    case '-gt': return a > b;
    default: return a >= b;
  }
}

export function fileCompare(sh: Interp, op: string, a: string, b: string): boolean {
  const fs = sh.env.fs;
  const sa = fs.tryLookup(sh.resolvePath(a), sh.cred) ? fs.stat(sh.resolvePath(a), sh.cred) : undefined;
  const sb = fs.tryLookup(sh.resolvePath(b), sh.cred) ? fs.stat(sh.resolvePath(b), sh.cred) : undefined;
  if (op === '-ef') return Boolean(sa && sb && fs.realpath(sh.resolvePath(a)) === fs.realpath(sh.resolvePath(b)));
  if (op === '-nt') return Boolean(sa && (!sb || sa.mtime > sb.mtime));
  return Boolean(sb && (!sa || sa.mtime < sb.mtime));
}

const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f', cntrl: '\\x00-\\x1f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e', word: '\\w',
};

/** POSIX ERE (as used by =~, grep -E, sed -E, awk) to a JavaScript RegExp source. */
export function ereToJs(ere: string): string {
  return ere.replace(/\[:([a-z]+):\]/g, (m, c: string) => POSIX_CLASSES[c] ?? m);
}

/** [[ s =~ re ]]: sets BASH_REMATCH; invalid expressions return status 2 (thrown). */
export function regexMatch(sh: Interp, text: string, re: string): boolean {
  let rx: RegExp;
  try {
    const src = ereToJs(re);
    if (isCatastrophic(src)) throw new Error('too complex');
    rx = new RegExp(src, sh.shoptOn('nocasematch') ? 'i' : '');
  } catch {
    throw new TestError('');
  }
  const m = rx.exec(text);
  if (!m) {
    sh.vars.setArray('BASH_REMATCH', [], false);
    return false;
  }
  sh.vars.setArray('BASH_REMATCH', [...m].map((g) => ({ value: g ?? '' })), false);
  return true;
}
