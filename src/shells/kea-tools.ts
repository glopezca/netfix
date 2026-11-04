/**
 * kea-dhcp4 (Kea 2.6, isc-kea or Ubuntu's kea-dhcp4-server): `-t FILE` checks a configuration as the server would
 * load it (kea-check.ts) and writes the log of that check to stdout and the failure to stderr; -v and -V say the
 * version. The server itself runs as the kea-dhcp4-server unit (systemctl), not in the foreground.
 */
import type { CommandFn, Ctx } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import type { Server } from '../devices/server.ts';
import { runsServices } from '../devices/kinds.ts';
import { checkKeaConf } from '../services/kea-check.ts';
import type { KeaLog } from '../services/kea-check.ts';
import { fileReader, toolInstalled } from './bind-tools.ts';

export const KEA_VERSION = '2.6.3';
const KEA_TOOLS = ['isc-kea', 'isc-kea-dhcp4', 'isc-kea-dhcp4-server', 'kea', 'kea-dhcp4-server'];
/** The process the check runs in: kea-dhcp4 logs «PID.THREAD». */
const PID_TID = '2318.140245170644864';

const USAGE = `Usage: kea-dhcp4 -[v|V|W] [-d] [-{c|t|T} cfgfile] [-p number] [-P number]
  -v: print version number and exit
  -V: print extended version and exit
  -W: display the configuration report and exit
  -d: debug mode with extra verbosity (former -v)
  -c file: specify configuration file
  -t file: check the configuration file syntax and exit
  -T file: check the configuration file doing hooks load and extra checks and exit
  -p number: specify non-standard server port number 1-65535 (useful for testing only)
  -P number: specify non-standard client port number 1-65535 (useful for testing only)
`;

const EXTENDED = `${KEA_VERSION} (tarball)
premium: no
linked with:
log4cplus 2.0.8
OpenSSL 3.5.0 8 Apr 2025
database:
MySQL backend 22.2, library 3.4.2
PostgreSQL backend 22.2, library 170005
Memfile backend 3.0
`;

function usage(ctx: Ctx, message?: string): number {
  if (message) ctx.err(`kea-dhcp4: ${message}\n`);
  ctx.err(USAGE);
  return 1;
}

/** 2026-11-04 10:15:02.137 INFO  [kea-dhcp4.dhcpsrv/2318.140245170644864] MESSAGE */
function logLine(ms: number, l: KeaLog): string {
  const stamp = new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
  return `${stamp} ${l.level.padEnd(5)} [kea-dhcp4.${l.logger}/${PID_TID}] ${l.message}\n`;
}

interface Args { readonly mode?: 'c' | 't' | 'T'; readonly file?: string; readonly flags: ReadonlySet<string>; readonly bad?: string }

function parse(args: readonly string[]): Args {
  const flags = new Set<string>();
  let mode: Args['mode'];
  let file: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '-c' || a === '-t' || a === '-T') {
      mode = a[1] as 'c' | 't' | 'T';
      file = args[++i];
      if (file === undefined) return { flags, bad: `option requires an argument -- '${a[1] ?? ''}'` };
    } else if (a === '-p' || a === '-P') {
      const port = args[++i];
      if (port === undefined || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        return { flags, bad: `${a === '-p' ? 'server' : 'client'} port number must be within 1..65535` };
      }
    } else if (/^-[vVWd]$/.test(a)) flags.add(a[1] ?? '');
    else return { flags, bad: a.startsWith('-') ? `invalid option -- '${a.slice(1)}'` : `extraneous command line information` };
  }
  return { mode, file, flags };
}

function check(ctx: Ctx, file: string, verbose: boolean): number {
  const text = fileReader(ctx)(file);
  const r = checkKeaConf(file, text);
  const now = ctx.sh.env.now();
  for (const l of r.log) ctx.out(logLine(now, l));
  if (r.error !== undefined) { ctx.err(`${r.error}\n`); return 1; }
  if (verbose) ctx.err('Syntax check OK\n');
  return 0;
}

// A Server or GNU/Linux router (a value import of Server would close an import cycle through the shells, as in apt-state.ts).
const dhcpRunning = (host: Host): boolean => runsServices(host.kind) && (host as Server).services.dhcp.enabled;

export function keaDhcp4(host: Host): CommandFn {
  return (ctx) => {
    if (!toolInstalled(ctx, host, KEA_TOOLS, 'kea-dhcp4-server')) return 127;
    const a = parse(ctx.argv.slice(1));
    if (a.bad !== undefined) return usage(ctx, a.bad);
    if (a.flags.has('v')) { ctx.out(`${KEA_VERSION}\n`); return 0; }
    if (a.flags.has('V') || a.flags.has('W')) { ctx.out(EXTENDED); return 0; }
    if (a.file === undefined) return usage(ctx, 'configuration file not specified');
    if (a.mode !== 'c') return check(ctx, a.file, a.flags.has('d'));
    if (dhcpRunning(host)) {
      ctx.err('DHCP4_ALREADY_RUNNING kea-dhcp4 already running? PID file: /run/kea/kea-dhcp4.kea-dhcp4.pid\n');
      return 1;
    }
    ctx.err('kea-dhcp4: en Netfix el servidor DHCP se arranca como servicio: sudo systemctl start kea-dhcp4-server\n');
    return 1;
  };
}
