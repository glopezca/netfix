/** sysctl (procps-ng 4) and dmesg for the Ubuntu shell. */
import { t } from '../i18n/t.ts';
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { sysctlName, sysctlPath } from '../net/sysctl.ts';
import { applySysctlFile, sysctlFiles, SYSCTL_CONF } from './kernel-files.ts';

const EXIT_ERROR = 255;
const USAGE = `
Usage:
 sysctl [options] [variable[=value] ...]

Options:
  -a, --all            display all variables
  -n, --values         print only values of the given variable(s)
  -e, --ignore         ignore unknown variables errors
  -q, --quiet          do not echo variable set
  -w, --write          enable writing a value to variable
  -p, --load[=<file>]  read values from file
      --system         read values from all system directories
`;

interface Opts {
  values: boolean;
  ignore: boolean;
  quiet: boolean;
  load?: string;
  all: boolean;
  system: boolean;
  args: string[];
}

function parse(argv: readonly string[]): Opts | null {
  const o: Opts = { values: false, ignore: false, quiet: false, all: false, system: false, args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--system') o.system = true;
    else if (a === '-a' || a === '--all' || a === '-A' || a === '-X') o.all = true;
    else if (a === '-p' || a === '--load') o.load = argv[i + 1] && !argv[i + 1]?.startsWith('-') ? argv[++i] : SYSCTL_CONF;
    else if (a.startsWith('--load=')) o.load = a.slice(7);
    else if (a.startsWith('-p') && a.length > 2) o.load = a.slice(2);
    else if (/^-[nweq]+$/.test(a)) {
      if (a.includes('n')) o.values = true;
      if (a.includes('e')) o.ignore = true;
      if (a.includes('q')) o.quiet = true;
    } else if (a.startsWith('-')) return null;
    else o.args.push(a);
  }
  return o;
}

function show(ctx: Ctx, host: Host, o: Opts, name: string): number {
  const v = host.kernel.sysctl.get(name);
  if (v === undefined) {
    if (!o.ignore) ctx.err(`sysctl: cannot stat ${sysctlPath(name)}: No such file or directory\n`);
    return o.ignore ? 0 : EXIT_ERROR;
  }
  ctx.out(o.values ? `${v}\n` : `${name} = ${v}\n`);
  return 0;
}

function write(ctx: Ctx, host: Host, o: Opts, arg: string): number {
  const eq = arg.indexOf('=');
  const name = sysctlName(arg.slice(0, eq).trim());
  const value = arg.slice(eq + 1).trim();
  if (!host.kernel.sysctl.has(name)) {
    if (!o.ignore) ctx.err(`sysctl: cannot stat ${sysctlPath(name)}: No such file or directory\n`);
    return o.ignore ? 0 : EXIT_ERROR;
  }
  if (ctx.cred.uid !== 0) {
    ctx.err(`sysctl: permission denied on key "${name}"\n`);
    return EXIT_ERROR;
  }
  const r = host.kernel.sysctl.set(name, value);
  if (r !== null) {
    ctx.err(r === 'denied' ? `sysctl: permission denied on key "${name}" (${t('host.locked')})\n` : `sysctl: setting key "${name}": Invalid argument\n`);
    return EXIT_ERROR;
  }
  if (!o.quiet) ctx.out(`${name} = ${host.kernel.sysctl.get(name) ?? value}\n`);
  return 0;
}

function load(ctx: Ctx, host: Host, files: readonly string[], announce: boolean, quiet: boolean): number {
  if (ctx.cred.uid !== 0) {
    ctx.err(`sysctl: permission denied on key "${host.kernel.sysctl.names()[0] ?? ''}"\n`);
    return EXIT_ERROR;
  }
  let status = 0;
  for (const f of files) {
    if (announce) ctx.out(`* Applying ${f} ...\n`);
    const r = applySysctlFile(ctx.sh.env.fs, host, ctx.resolve(f));
    if (!quiet && r.applied.length) ctx.out(`${r.applied.join('\n')}\n`);
    if (r.errors.length) {
      ctx.err(`${r.errors.join('\n')}\n`);
      status = EXIT_ERROR;
    }
  }
  return status;
}

export function sysctl(host: Host): CommandFn {
  return (ctx) => {
    const o = parse(ctx.argv.slice(1));
    if (!o) { ctx.err(`sysctl: invalid option\n${USAGE}`); return 1; }
    if (o.system) return load(ctx, host, sysctlFiles(ctx.sh.env.fs), true, o.quiet);
    if (o.load !== undefined) return load(ctx, host, [o.load], false, o.quiet);
    if (o.all) {
      ctx.out(host.kernel.sysctl.names().map((n) => (o.values ? host.kernel.sysctl.get(n) : `${n} = ${host.kernel.sysctl.get(n)}`)).join('\n') + '\n');
      return 0;
    }
    if (!o.args.length) { ctx.err(USAGE.trimStart()); return 1; }
    let status = 0;
    for (const a of o.args) status = Math.max(status, a.includes('=') ? write(ctx, host, o, a) : show(ctx, host, o, sysctlName(a)));
    return status;
  };
}

/** dmesg: kernel log since boot ("[   12.345678] …"); Ubuntu restricts it to root. */
export function dmesg(host: Host): CommandFn {
  return (ctx) => {
    if (ctx.cred.uid !== 0) { ctx.err('dmesg: read kernel buffer failed: Operation not permitted\n'); return 1; }
    const lines = host.kernel.log.map((l) => `[${(l.time / 1000 % 100000).toFixed(6).padStart(12)}] ${l.text}`);
    if (lines.length) ctx.out(`${lines.join('\n')}\n`);
    return 0;
  };
}
