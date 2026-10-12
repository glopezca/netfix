/** Test harness: a tiny host with a VFS and a non-interactive bash. */
import { Vfs, ROOT } from '../../src/bash/vfs.ts';
import { Interp } from '../../src/bash/interp.ts';
import { initVariables } from '../../src/bash/startup.ts';
import { ttyFds } from '../../src/bash/io.ts';
import type { CommandFn, HostEnv, UserInfo } from '../../src/bash/types.ts';
import { seedRootfs } from '../../src/bash/rootfs.ts';
import { COREUTILS } from '../../src/bash/coreutils/index.ts';
import { ExitSignal } from '../../src/bash/types.ts';

export const USER: UserInfo = { name: 'alumno', uid: 1000, gid: 1000, home: '/home/alumno', shell: '/bin/bash', groups: [1000] };

export const ROOT_USER: UserInfo = { name: 'root', uid: 0, gid: 0, home: '/root', shell: '/bin/bash', groups: [0] };
export const NOW = Date.UTC(2026, 9, 11, 21, 30, 0);

export function makeEnv(extra: ReadonlyMap<string, CommandFn> = new Map()): HostEnv {
  const fs = new Vfs(() => NOW);
  const commands = new Map([...COREUTILS, ...extra]);
  seedRootfs(fs, { hostname: 'pc0', users: [ROOT_USER, USER], programs: [...commands.keys()] });
  fs.seed('/etc/hostname', { kind: 'file', content: 'pc0\n' });
  void ROOT;
  return { hostname: 'pc0', fs, users: () => [ROOT_USER, USER], commands, now: () => NOW };
}

export interface RunResult {
  readonly out: string;
  readonly status: number;
}

/** Runs a script as `bash script` with cwd /tmp; answers interactive reads with `input` lines. */
export function runScript(src: string, opts: { env?: HostEnv; input?: string[]; args?: string[]; tty?: boolean } = {}): RunResult {
  const env = opts.env ?? makeEnv();
  let out = '';
  const sh = new Interp(env, USER, { interactive: false, term: (t) => { out += t; } });
  initVariables(sh);
  sh.cwd = '/tmp';
  sh.setVar('PWD', '/tmp', { export: true });
  sh.arg0 = 'script.sh';
  sh.args = opts.args ?? [];
  const input = [...(opts.input ?? [])];
  const fds = opts.tty ? ttyFds() : new Map([[0, { read: opts.input ? { kind: 'tty' as const } : { kind: 'null' as const } }], [1, { write: { kind: 'term' as const, notty: true } }], [2, { write: { kind: 'term' as const, notty: true } }]]);
  const gen = sh.runScriptText(src, fds);
  let r = gen.next(null);
  while (!r.done) {
    const ask = r.value;
    if (ask.kind === 'line') out += ask.prompt;
    r = gen.next(ask.kind === 'line' ? input.shift() ?? null : null);
  }
  return { out, status: r.value };
}

export { ExitSignal };
