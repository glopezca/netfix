/** File descriptors, sinks and the command context handed to builtins and programs. */
import type { Ctx, Fd, Fds, Gen, LineRead, Sink, Source } from './types.ts';
import type { Interp } from './interp.ts';
import { FsError, normalize } from './vfs.ts';

export function isGen(r: number | Gen<number>): r is Gen<number> {
  return typeof r === 'object';
}

/** A descriptor connected to a terminal (ls columns, grep colours, test -t, tty). */
export function isTty(fd: Fd | undefined): boolean {
  return (fd?.write?.kind === 'term' && !fd.write.notty) || fd?.read?.kind === 'tty';
}

export function ttyFds(): Fds {
  return new Map<number, Fd>([[0, { read: { kind: 'tty' } }], [1, { write: { kind: 'term' } }], [2, { write: { kind: 'term' } }]]);
}

export function bufferSink(): Extract<Sink, { kind: 'buf' }> {
  return { kind: 'buf', chunks: [] };
}

export function dataSource(data: string): Source {
  return { kind: 'data', data, pos: 0 };
}

export function writeSink(sh: Interp, sink: Sink | undefined, text: string): void {
  if (!sink || text === '') return;
  switch (sink.kind) {
    case 'term':
      sh.countOutput(text.length);
      sh.term(text);
      return;
    case 'buf':
      sh.countOutput(text.length);
      sink.chunks.push(text);
      return;
    case 'file':
      try {
        sh.env.fs.writeFile(sink.path, text, sh.cred, true);
      } catch (e) {
        if (e instanceof FsError) sh.term(`${sh.errPrefix()}write error: ${e.message}\n`);
        else throw e;
      }
      return;
    case 'null':
      return;
  }
}

export function* readLineFrom(src: Source | undefined, prompt = '', secret = false): Gen<LineRead | null> {
  if (!src || src.kind === 'null') return null;
  if (src.kind === 'tty') {
    const line = yield { kind: 'line', prompt, secret };
    return line === null ? null : { text: line, eof: false };
  }
  if (src.pos >= src.data.length) return null;
  const nl = src.data.indexOf('\n', src.pos);
  if (nl < 0) {
    const text = src.data.slice(src.pos);
    src.pos = src.data.length;
    return { text, eof: true };
  }
  const text = src.data.slice(src.pos, nl);
  src.pos = nl + 1;
  return { text, eof: false };
}

export function* readAllFrom(src: Source | undefined): Gen<string> {
  if (!src || src.kind === 'null') return '';
  if (src.kind === 'data') {
    const rest = src.data.slice(src.pos);
    src.pos = src.data.length;
    return rest;
  }
  const lines: string[] = [];
  for (;;) {
    const l = yield* readLineFrom(src);
    if (l === null) break;
    lines.push(`${l.text}\n`);
  }
  return lines.join('');
}

export function makeCtx(sh: Interp, argv: readonly string[], fds: Fds, env: ReadonlyMap<string, string>): Ctx {
  const name = argv[0] ?? 'bash';
  return {
    sh,
    argv,
    fds,
    env,
    cred: sh.cred,
    cwd: sh.cwd,
    out: (t) => writeSink(sh, fds.get(1)?.write, t),
    err: (t) => writeSink(sh, fds.get(2)?.write, t),
    fail(msg, code = 1) {
      writeSink(sh, fds.get(2)?.write, `${name}: ${msg}\n`);
      return code;
    },
    readLine: (prompt, secret) => readLineFrom(fds.get(0)?.read, prompt, secret),
    readAll: () => readAllFrom(fds.get(0)?.read),
    resolve: (p) => normalize(p, sh.cwd),
  };
}

/** Error from a builtin: `bash: name: msg` (interactive) or `script: line N: name: msg`. */
export function builtinError(ctx: Ctx, msg: string, code = 1): number {
  ctx.err(`${ctx.sh.errPrefix()}${ctx.argv[0] ?? ''}: ${msg}\n`);
  return code;
}
