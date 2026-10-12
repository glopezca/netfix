/** Command resolution (function → builtin → PATH) and execution of functions, programs and scripts. */
import type { DeclArg, Fds, Gen, CommandFn } from './types.ts';
import { DiscardSignal, ExitSignal, ReturnSignal } from './types.ts';
import type { FunctionDef } from './ast.ts';
import type { Interp } from './interp.ts';
import { BUILTINS } from './builtins/index.ts';
import { canAccess, FsError } from './vfs.ts';
import { findInPath, programName } from './path.ts';
import { execCompound } from './exec-compound.ts';
import { writeSink, makeCtx, isGen } from './io.ts';

export type Resolved =
  | { readonly kind: 'function'; readonly def: FunctionDef }
  | { readonly kind: 'builtin'; readonly fn: CommandFn }
  | { readonly kind: 'program'; readonly fn: CommandFn; readonly path: string }
  | { readonly kind: 'script'; readonly path: string }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

/** Deeper recursion would overflow the JavaScript stack of the browser. */
const MAX_FUNCNEST = 200;

export { findInPath, programName };

function fromFile(sh: Interp, path: string, shown: string): Resolved {
  const node = sh.env.fs.tryLookup(path, sh.cred);
  if (!node) return { kind: 'error', status: 127, message: `${shown}: No such file or directory` };
  if (node.kind === 'dir') return { kind: 'error', status: 126, message: `${shown}: Is a directory` };
  if (!canAccess(node, sh.cred, 1) || !canAccess(node, sh.cred, 4) && !programName(sh.env.fs.readFile(path))) return { kind: 'error', status: 126, message: `${shown}: Permission denied` };
  const prog = programName(sh.env.fs.readFile(path));
  if (prog === undefined) return { kind: 'script', path };
  const fn = sh.env.commands.get(prog) ?? BUILTINS.get(prog);
  return fn ? { kind: 'program', fn, path } : { kind: 'error', status: 126, message: `${shown}: cannot execute binary file: Exec format error` };
}

export function resolveCommand(sh: Interp, name: string, opts: { noFunctions?: boolean; builtinOnly?: boolean } = {}): Resolved {
  if (name.includes('/')) return fromFile(sh, sh.resolvePath(name), name);
  if (!opts.noFunctions && !opts.builtinOnly) {
    const def = sh.functions.get(name);
    if (def) return { kind: 'function', def };
  }
  const b = BUILTINS.get(name);
  if (b && sh.enabledBuiltin(name)) return { kind: 'builtin', fn: b };
  if (opts.builtinOnly) return { kind: 'error', status: 1, message: `builtin: ${name}: not a shell builtin` };
  const path = findInPath(sh, name);
  if (path) return fromFile(sh, path, name);
  return { kind: 'error', status: 127, message: `${name}: command not found` };
}

export function* runResolved(sh: Interp, r: Resolved, argv: readonly string[], fds: Fds, env: ReadonlyMap<string, string>, decl?: ReadonlyMap<number, DeclArg>): Gen<number> {
  switch (r.kind) {
    case 'error': {
      const handler = r.status === 127 && !(argv[0] ?? '').includes('/') ? sh.functions.get('command_not_found_handle') : undefined;
      if (handler) return yield* callFunction(sh, handler, ['command_not_found_handle', ...argv], fds);
      writeSink(sh, fds.get(2)?.write, r.status === 127 && sh.interactive ? `${r.message}\n` : `${sh.errPrefix()}${r.message}\n`);
      return r.status;
    }
    case 'function': return yield* callFunction(sh, r.def, argv, fds);
    case 'builtin': case 'program': {
      const ctx = { ...makeCtx(sh, argv, fds, env), decl };
      const res = r.fn(ctx);
      return isGen(res) ? yield* res : res;
    }
    case 'script': return yield* runScript(sh, r.path, argv[0] ?? r.path, argv.slice(1), fds, env);
  }
}

export function* callFunction(sh: Interp, def: FunctionDef, argv: readonly string[], fds: Fds): Gen<number> {
  const nest = Number(sh.getVar('FUNCNEST') ?? MAX_FUNCNEST) || MAX_FUNCNEST;
  if (sh.funcNames.length >= Math.min(nest, MAX_FUNCNEST)) {
    sh.error(`${def.name}: maximum function nesting level exceeded (${Math.min(nest, MAX_FUNCNEST)})`);
    throw new DiscardSignal(1);
  }
  const savedArgs = sh.args;
  sh.args = argv.slice(1);
  sh.funcNames.unshift(def.name);
  sh.vars.setArray('FUNCNAME', [...sh.funcNames, ...(sh.interactive ? [] : ['main'])].map((value) => ({ value })), false);
  sh.vars.pushScope();
  try {
    return yield* execCompound(sh, def.body, fds);
  } catch (e) {
    if (e instanceof ReturnSignal) return e.code;
    throw e;
  } finally {
    sh.vars.popScope();
    sh.funcNames.shift();
    sh.args = savedArgs;
    if (sh.funcNames.length) sh.vars.setArray('FUNCNAME', sh.funcNames.map((value) => ({ value })), false);
    else sh.vars.unset('FUNCNAME');
  }
}

/** `./script`, `bash script`: a non-interactive child shell (shebang lines honoured). */
export function* runScript(sh: Interp, path: string, arg0: string, args: readonly string[], fds: Fds, env: ReadonlyMap<string, string>): Gen<number> {
  let content: string;
  try {
    content = sh.env.fs.readFile(path, sh.cred);
  } catch (e) {
    const msg = e instanceof FsError ? e.message : String(e);
    writeSink(sh, fds.get(2)?.write, `${sh.errPrefix()}${arg0}: ${msg}\n`);
    return 126;
  }
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(content);
  const interp = shebang ? (shebang[1]?.endsWith('/env') ? shebang[2] ?? '' : shebang[1] ?? '').split('/').pop() ?? '' : 'bash';
  if (!['bash', 'sh', 'dash', ''].includes(interp)) {
    writeSink(sh, fds.get(2)?.write, `${sh.errPrefix()}${arg0}: ${shebang?.[1] ?? interp}: bad interpreter: No such file or directory\n`);
    return 126;
  }
  return yield* sh.spawn(arg0, args, env).runScriptText(content, fds);
}
