/**
 * Extensions' programs on GNU/Linux (shells/programs.ts): each one the host has, as a /usr/bin program of bash, run
 * with the terminal's user (its credentials, home and working folder) and its output.
 */
import type { CommandFn } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { exitOf, programsOn, userFiles } from './programs.ts';

export function extensionPrograms(host: Host): [string, CommandFn][] {
  return programsOn(host, 'linux').map((def): [string, CommandFn] => [def.name, (ctx) => {
    const env = ctx.sh.env;
    const user = env.users().find((u) => u.uid === ctx.cred.uid);
    const files = userFiles(env.fs, ctx.cred, 'linux', user?.home ?? '/', ctx.cwd);
    return exitOf(def, { host, system: 'linux', argv: ctx.argv, user: user?.name ?? String(ctx.cred.uid), cwd: ctx.cwd, files, out: (t) => ctx.out(t), err: (t) => ctx.err(t) });
  }]);
}
