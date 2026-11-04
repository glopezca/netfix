/**
 * The checking tools of bind9-utils (BIND 9.20): named-checkzone, named-compilezone and named-checkconf, over the files
 * of the host (zone-check.ts and named-conf-check.ts do the checking). They write what they find to stdout, as the
 * real tools do, and end with status 1 when something is wrong.
 */
import type { CommandFn, Ctx } from '../bash/types.ts';
import { FsError } from '../bash/vfs.ts';
import type { Host } from '../devices/host.ts';
import type { ConfReader } from '../services/named-conf-parse.ts';
import { checkNamedConf, loadConfZones } from '../services/named-conf-check.ts';
import { checkZone, dumpZone } from '../services/zone-check.ts';
import { anyInstalled } from './apt-state.ts';

export const BIND_VERSION = '9.20.4-3ubuntu1-Ubuntu';
const BIND_TOOLS = ['bind9-utils', 'bind9utils', 'bind9'];

/** How isc_result names the reasons a file cannot be read or written (anything else is ISC_R_UNEXPECTED). */
function reason(e: unknown): string {
  if (!(e instanceof FsError)) return 'unexpected error';
  if (e.code === 'ENOENT') return 'file not found';
  if (e.code === 'EACCES') return 'permission denied';
  return 'unexpected error';
}

/** Reads files of the host as the user (relative paths from the working directory). */
export function fileReader(ctx: Ctx, dir?: string): ConfReader {
  return (path) => {
    try {
      return ctx.sh.env.fs.readFile(ctx.resolve(dir && !path.startsWith('/') ? `${dir}/${path}` : path), ctx.cred);
    } catch (e) {
      return { error: reason(e) };
    }
  };
}

/** False (and Ubuntu's command-not-found hint) when no package that brings the program is installed. */
export function toolInstalled(ctx: Ctx, host: Host, packages: readonly string[], hint: string): boolean {
  if (anyInstalled(host, packages)) return true;
  ctx.err(`Command '${ctx.argv[0] ?? ''}' not found, but can be installed with:\nsudo apt install ${hint}\n`);
  return false;
}

interface Opts { readonly flags: ReadonlySet<string>; readonly values: ReadonlyMap<string, string>; readonly rest: readonly string[]; readonly bad?: string }

/** getopt: grouped flags (-qD), values glued or apart (-o out, -oout), and `--` or the first operand ends them. */
function getopt(args: readonly string[], flags: string, valued: string): Opts {
  const set = new Set<string>();
  const values = new Map<string, string>();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') { i++; break; }
    if (!a.startsWith('-') || a === '-') break;
    for (let k = 1; k < a.length; k++) {
      const c = a[k] ?? '';
      if (valued.includes(c)) {
        const v = k + 1 < a.length ? a.slice(k + 1) : args[++i];
        if (v === undefined) return { flags: set, values, rest: [], bad: c };
        values.set(c, v);
        break;
      }
      if (!flags.includes(c)) return { flags: set, values, rest: [], bad: c };
      set.add(c);
    }
  }
  return { flags: set, values, rest: args.slice(i) };
}

const MODES = '(ignore|warn|fail)';
const zoneUsage = (prog: string): string => `usage: ${prog} [-djqvD] [-c class] [-f inputformat] [-F outputformat] [-J filename] [-s (full|relative)] [-t directory] [-w directory] [-k ${MODES}] [-m ${MODES}] [-n ${MODES}] [-r ${MODES}] [-i (full|full-sibling|local|local-sibling|none)] [-M ${MODES}] [-S ${MODES}] [-W (ignore|warn)] [-o filename] zonename filename\n`;

function usageError(ctx: Ctx, prog: string, usage: string, bad: string | undefined, valued: string): number {
  if (bad !== undefined) ctx.err(valued.includes(bad) ? `${prog}: option requires an argument -- ${bad}\n` : `${prog}: illegal option -- ${bad}\n`);
  ctx.err(usage);
  return 1;
}

/** named-compilezone -o: the zone in canonical form, to a file or to stdout with `-`. */
function writeDump(ctx: Ctx, out: string, body: string, say: (s: string) => void): boolean {
  if (out === '-') { ctx.out(body); return true; }
  try {
    ctx.sh.env.fs.writeFile(ctx.resolve(out), body, ctx.cred);
    say(`dump zone to ${out}...done\n`);
    return true;
  } catch (e) {
    say(`dump zone to ${out}...failed: ${reason(e)}\n`);
    return false;
  }
}

const ZONE_VALUED = 'cfFJstwkmnriMSWoLlT';

function zoneTool(host: Host, prog: 'named-checkzone' | 'named-compilezone'): CommandFn {
  return (ctx) => {
    if (!toolInstalled(ctx, host, BIND_TOOLS, 'bind9-utils')) return 127;
    const o = getopt(ctx.argv.slice(1), 'djqvDh', ZONE_VALUED);
    if (o.flags.has('v')) { ctx.out(`${BIND_VERSION}\n`); return 0; }
    const [zone, file] = o.rest;
    if (o.bad !== undefined || o.flags.has('h') || zone === undefined || file === undefined) return usageError(ctx, prog, zoneUsage(prog), o.bad, ZONE_VALUED);
    const out = o.values.get('o');
    const compile = prog === 'named-compilezone';
    if (compile && out === undefined) { ctx.err('output file required, but not specified\n'); ctx.err(zoneUsage(prog)); return 1; }
    const quiet = o.flags.has('q');
    // With the zone on stdout, the messages go to stderr.
    const say = (s: string): void => { if (!quiet) (out === '-' || (!compile && o.flags.has('D')) ? ctx.err(s) : ctx.out(s)); };
    const read = fileReader(ctx, o.values.get('w'));
    const text = read(file);
    const r = typeof text === 'string' ? checkZone(zone, file, text, undefined, read) : checkZone(zone, file, undefined, text.error);
    for (const l of r.lines) say(`${l}\n`);
    if (!r.ok) return 1;
    if (compile || o.flags.has('D')) {
      if (!writeDump(ctx, out ?? '-', dumpZone(r.records), say)) return 1;
    }
    say('OK\n');
    return 0;
  };
}

export const namedCheckzone = (host: Host): CommandFn => zoneTool(host, 'named-checkzone');
export const namedCompilezone = (host: Host): CommandFn => zoneTool(host, 'named-compilezone');

const CONF_USAGE = 'usage: named-checkconf [-achijlvz] [-p [-x]] [-t directory] [named.conf]\n';
export const NAMED_CONF_PATH = '/etc/bind/named.conf';

export function namedCheckconf(host: Host): CommandFn {
  return (ctx) => {
    if (!toolInstalled(ctx, host, BIND_TOOLS, 'bind9-utils')) return 127;
    const o = getopt(ctx.argv.slice(1), 'achijlvzpx', 't');
    if (o.bad !== undefined) return usageError(ctx, 'named-checkconf', CONF_USAGE, o.bad, 't');
    if (o.flags.has('h')) { ctx.err(CONF_USAGE); return 0; }
    if (o.flags.has('v')) { ctx.out(`${BIND_VERSION}\n`); return 0; }
    const read = fileReader(ctx);
    const conf = checkNamedConf(o.rest[0] ?? NAMED_CONF_PATH, read);
    if (conf.errors.length > 0) { ctx.out(`${conf.errors.join('\n')}\n`); return 1; }
    // -l: «name class view type», one line per zone.
    if (o.flags.has('l')) for (const z of conf.zones) ctx.out(`${z.name} IN _default ${z.type ?? ''}\n`);
    if (!o.flags.has('z')) return 0;
    const zones = loadConfZones(conf, read);
    if (zones.lines.length > 0) ctx.out(`${zones.lines.join('\n')}\n`);
    return zones.ok ? 0 : 1;
  };
}
