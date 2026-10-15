/** hostnamectl (systemd-hostnamed) and `hostname`: show and change the static, transient and pretty names. */
import type { CommandFn, Ctx, Gen, HostNames } from '../types.ts';
import { readLineFrom } from '../io.ts';

const SUDO_GROUP = 27;
const MACHINE_ID = '4f8d0c2a9b6e4c1d8e7f3a2b1c0d9e8f';
const ACTION = 'org.freedesktop.hostname1.set-static-hostname';

function names(ctx: Ctx): HostNames {
  return ctx.sh.env.hostnames?.() ?? { static: ctx.sh.env.hostname, transient: ctx.sh.env.hostname };
}

function status(ctx: Ctx): number {
  const n = names(ctx);
  const rows: [string, string][] = [
    ['Static hostname', n.static],
    ...(n.transient !== n.static ? [['Transient hostname', n.transient] as [string, string]] : []),
    ...(n.pretty ? [['Pretty hostname', n.pretty] as [string, string]] : []),
    ['Icon name', 'computer-vm'], ['Chassis', 'vm 🖴'], ['Machine ID', MACHINE_ID], ['Boot ID', `${MACHINE_ID.slice(16)}${MACHINE_ID.slice(0, 16)}`],
    ['Virtualization', 'kvm'], ['Operating System', 'Ubuntu 26.04 LTS'], ['Kernel', 'Linux 6.17.0-14-generic'], ['Architecture', 'x86-64'],
    ['Hardware Vendor', 'Netfix'], ['Hardware Model', ctx.sh.env.hostname.startsWith('server') ? 'Server' : 'PC'],
  ];
  ctx.out(rows.map(([k, v]) => `${k.padStart(16)}: ${v}\n`).join(''));
  return 0;
}

/** polkit, as pkttyagent does in a terminal: administrators confirm with their own password. */
function* authorize(ctx: Ctx): Gen<boolean> {
  if (ctx.cred.uid === 0) return true;
  const me = ctx.sh.env.users().find((u) => u.uid === ctx.cred.uid);
  if (!me?.groups.includes(SUDO_GROUP) || !ctx.sh.controllingTty) return false;
  ctx.out(`==== AUTHENTICATING FOR ${ACTION} ====\nAuthentication is required to set the statically configured local hostname, as well as the pretty hostname.\nAuthenticating as: ${me.name}\n`);
  const expected = ctx.sh.env.password?.(me.name);
  if (expected !== undefined) {
    const line = yield* readLineFrom({ kind: 'tty' }, 'Password: ', true);
    if (line?.text !== expected) {
      ctx.out('==== AUTHENTICATION FAILED ====\n');
      return false;
    }
  }
  ctx.out('==== AUTHENTICATION COMPLETE ====\n');
  return true;
}

function* setName(ctx: Ctx, args: readonly string[]): Gen<number> {
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const value = args.find((a) => !a.startsWith('--'));
  if (value === undefined) { ctx.err('Too few arguments.\n'); return 1; }
  const kinds = (['static', 'transient', 'pretty'] as const).filter((k) => flags.has(`--${k}`));
  const targets = kinds.length ? kinds : (['static'] as const);
  if (!(yield* authorize(ctx))) {
    ctx.err(`Could not set ${targets[0]} hostname: Access denied\n`);
    return 1;
  }
  for (const kind of targets) {
    const err = ctx.sh.env.setHostname ? ctx.sh.env.setHostname(kind, value) : 'Access denied';
    if (err) { ctx.err(`Could not set ${kind} hostname: ${err}\n`); return 1; }
  }
  return 0;
}

function* hostnamectl(ctx: Ctx): Gen<number> {
  const args = ctx.argv.slice(1);
  const verb = args.find((a) => !a.startsWith('-')) ?? 'status';
  const rest = args.slice(args.indexOf(verb) + 1);
  const opts = args.filter((a) => a.startsWith('--'));
  if (verb === 'status') return status(ctx);
  if (verb === 'set-hostname') return yield* setName(ctx, [...opts, ...rest]);
  if (verb === 'hostname' || verb === 'pretty-hostname') {
    const kind = verb === 'pretty-hostname' ? '--pretty' : opts.find((o) => o === '--transient' || o === '--pretty') ?? '--static';
    if (rest.length) return yield* setName(ctx, [kind, ...rest]);
    const n = names(ctx);
    ctx.out(`${kind === '--pretty' ? n.pretty ?? '' : kind === '--transient' ? n.transient : n.static}\n`);
    return 0;
  }
  ctx.err(`Unknown command verb '${verb}'.\n`);
  return 1;
}

/**
 * hostname -f: the canonical name of the host as /etc/hosts gives it (the first name of the line that lists it), as
 * glibc resolves it; Ubuntu does not add the DHCP domain to /etc/hosts, so it is usually the short name.
 */
function canonicalName(ctx: Ctx, name: string): string {
  let hosts = '';
  try {
    hosts = ctx.sh.env.fs.readFile('/etc/hosts', ctx.cred);
  } catch {
    return name;
  }
  for (const line of hosts.split('\n')) {
    const fields = line.replace(/#.*/, '').trim().split(/\s+/).slice(1);
    if (fields.some((f) => f.toLowerCase() === name.toLowerCase())) return fields[0] ?? name;
  }
  return name;
}

/** hostname [-I|-f|-s] [NAME]: setting it (root only) changes the transient name. */
function hostname(ctx: Ctx): number {
  const args = ctx.argv.slice(1);
  if (args.includes('-I') || args.includes('-i')) { ctx.out(`${ctx.sh.env.ipAddress?.() ?? ''} \n`); return 0; }
  const set = args.find((a) => !a.startsWith('-'));
  if (set !== undefined) {
    if (ctx.cred.uid !== 0) { ctx.err('hostname: you must be root to change the host name\n'); return 1; }
    const err = ctx.sh.env.setHostname?.('transient', set) ?? null;
    if (err) { ctx.err('hostname: the specified hostname is invalid\n'); return 1; }
    return 0;
  }
  const name = names(ctx).transient;
  ctx.out(`${args.includes('-f') ? canonicalName(ctx, name) : args.includes('-s') ? name.split('.')[0] ?? name : name}\n`);
  return 0;
}

export const HOSTNAME_TOOLS: ReadonlyMap<string, CommandFn> = new Map<string, CommandFn>([['hostnamectl', hostnamectl], ['hostname', hostname]]);
