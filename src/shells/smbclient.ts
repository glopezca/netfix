/**
 * smbclient (package smbclient): an FTP-like client for SMB shares. `-L server` lists the shares; `//server/share`
 * opens one and runs the commands of -c, or reads them at the «smb: \>» prompt. -N logs in anonymously (the guest),
 * -U user%password with a Samba account (without %, it asks for the password).
 */
import type { CommandFn, Ctx, Gen } from '../bash/types.ts';
import type { Host } from '../devices/host.ts';
import { hasPackage } from '../net/host-packages.ts';
import { resolveHostSteps } from './net-tools.ts';
import type { Steps } from '../net/live-wait.ts';
import { stepsIn } from './live-steps.ts';
import { FILE_SERVER, nbnsResolveSteps } from '../net/netbios.ts';
import { winsResolveSteps } from '../net/wins.ts';
import { readHostFile } from '../devices/server-firewall.ts';
import { SMB_CONF, parseSmbConf } from '../services/smb-conf.ts';
import type { NameResolveMethod } from '../services/smb-conf.ts';
import { ANONYMOUS, smbCallSteps } from '../clients/smb-client.ts';
import type { SmbClientStatus, SmbLogin } from '../clients/smb-client.ts';
import { smbCommand } from './smbclient-cmds.ts';
import type { SmbSession } from './smbclient-cmds.ts';

const USAGE = 'Usage: smbclient [-?EgqBNPkV] [-?|--help] [--usage] [-M|--message=HOST] [-I|--ip-address=IP]\n        [-L|--list=HOST] [-c|--command=STRING] [-N|--no-pass] [-U|--user=[DOMAIN/]USERNAME[%PASSWORD]]\n        [-W|--workgroup=WORKGROUP] service <password>\n';
const WORKGROUP = 'WORKGROUP';

interface Options {
  service?: string;
  list?: string;
  anonymous: boolean;
  user?: string;
  commands?: string;
}

const VALUED: Readonly<Record<string, 'list' | 'user' | 'commands' | 'skip'>> = {
  '-L': 'list', '--list': 'list', '-U': 'user', '--user': 'user', '-c': 'commands', '--command': 'commands',
  '-W': 'skip', '--workgroup': 'skip', '-m': 'skip', '--max-protocol': 'skip', '-p': 'skip', '--port': 'skip',
};

function parseArgs(argv: readonly string[]): Options | null {
  const o: Options = { anonymous: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : /^-[LUcWmp]./.test(a) ? a.slice(0, 2) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : flag !== a ? a.slice(2) : undefined;
    if (flag === '-N' || flag === '--no-pass') { o.anonymous = true; continue; }
    const key = VALUED[flag];
    if (key) {
      const value = inline ?? argv[++i];
      if (value === undefined) return null;
      if (key === 'list') o.list = value;
      else if (key === 'user') o.user = value;
      else if (key === 'commands') o.commands = value;
      continue;
    }
    if (a.startsWith('-') || o.service !== undefined) return null;
    o.service = a;
  }
  return o.service !== undefined || o.list !== undefined ? o : null;
}

/** //server/share (or \\server\share) → its two names. */
function service(text: string): { server: string; share: string } | null {
  const m = /^(?:\/\/|\\\\)([^/\\]+)[/\\]([^/\\]+)[/\\]?$/.exec(text);
  return m ? { server: m[1] ?? '', share: m[2] ?? '' } : null;
}

function* credentials(ctx: Ctx, o: Options): Gen<SmbLogin> {
  if (o.anonymous) return ANONYMOUS;
  const given = o.user ?? ctx.env.get('USER') ?? 'root';
  const cut = given.indexOf('%');
  const user = (cut >= 0 ? given.slice(0, cut) : given).replace(/^.*[\\/]/, '');
  if (cut >= 0) return { user, password: given.slice(cut + 1) };
  const line = yield* ctx.readLine(`Password for [${WORKGROUP}\\${user}]:`, true);
  return { user, password: line?.text ?? '' };
}

/** How smbclient words a failed connection, session setup or tree connect. */
function connectError(ctx: Ctx, server: string, status: SmbClientStatus): number {
  if (/CONNECTION_REFUSED|IO_TIMEOUT|HOST_UNREACHABLE/.test(status)) ctx.err(`do_connect: Connection to ${server} failed (Error ${status})\n`);
  else if (status === 'NT_STATUS_LOGON_FAILURE' || status === 'NT_STATUS_ACCOUNT_DISABLED') ctx.err(`session setup failed: ${status}\n`);
  else ctx.err(`tree connect failed: ${status}\n`);
  return 1;
}

/** A NetBIOS name: one label of up to 15 characters. */
const NETBIOS_NAME = /^[^.\s]{1,15}$/;

/** One method of «name resolve order»; smbclient asks NetBIOS for the server's file service, NAME<20>. */
function* resolveBy(host: Host, method: NameResolveMethod, server: string, wins: readonly number[]): Steps<number | undefined> {
  if (method === 'host') {
    const r = yield* resolveHostSteps(host, server, 'linux');
    return r.kind === 'ip' ? r.ip : undefined;
  }
  if (!NETBIOS_NAME.test(server)) return undefined;
  if (method === 'wins') return wins.length ? yield* winsResolveSteps(host, wins, server, FILE_SERVER) : undefined;
  // No lmhosts file is simulated: that method finds nothing.
  return method === 'bcast' ? yield* nbnsResolveSteps(host, server, FILE_SERVER) : undefined;
}

/**
 * Samba's «name resolve order» of smb.conf (lmhosts wins host bcast by default): the «wins server» by unicast, which
 * crosses routers; the system resolver (/etc/hosts, DNS… as nsswitch.conf says); a NetBIOS broadcast, which nmbd answers.
 */
function* serverIp(ctx: Ctx, host: Host, server: string): Steps<number | null> {
  const conf = parseSmbConf(readHostFile(host, SMB_CONF) ?? '');
  for (const method of conf.nameResolveOrder) {
    const ip = yield* resolveBy(host, method, server, conf.winsServers);
    if (ip !== undefined) return ip;
  }
  ctx.err(`do_connect: Connection to ${server} failed (Error NT_STATUS_UNSUCCESSFUL)\n`);
  return null;
}

function* listShares(ctx: Ctx, host: Host, server: string, login: SmbLogin): Steps<number> {
  const ip = yield* serverIp(ctx, host, server);
  if (ip === null) return 1;
  const r = yield* smbCallSteps(host, ip, login, 'IPC$', { op: 'shares' });
  if (r.status !== 'NT_STATUS_OK') return connectError(ctx, server, r.status);
  const line = (a: string, b: string, c: string): string => `\t${a.padEnd(16)}${b.padEnd(10)}${c}`;
  const rows = (r.shares ?? []).map((s) => line(s.name, s.type, s.comment));
  ctx.out(`\n${[line('Sharename', 'Type', 'Comment'), line('---------', '----', '-------'), ...rows].join('\n')}\nSMB1 disabled -- no workgroup available\n`);
  return 0;
}

function* session(ctx: Ctx, s: SmbSession, commands: string | undefined): Gen<number> {
  if (commands !== undefined) {
    let status = 0;
    // As smbclient: every ; ends a command, even inside quotes (process_command_string splits with strchr).
    for (const line of commands.split(';')) {
      const r = yield* stepsIn(s.host.hooks, smbCommand(ctx, s, line.trim()), ctx.sh.liveWaits);
      if (r === 'fail') status = 1;
      if (r === 'quit') break;
    }
    return status;
  }
  ctx.out('Try "help" to get a list of possible commands.\n');
  for (;;) {
    const line = yield* ctx.readLine(`smb: ${s.cwd}> `);
    if (line === null || (yield* stepsIn(s.host.hooks, smbCommand(ctx, s, line.text.trim()), ctx.sh.liveWaits)) === 'quit') return 0;
  }
}

export function smbclient(host: Host): CommandFn {
  return function* run(ctx: Ctx): Gen<number> {
    if (!hasPackage(host, 'smbclient')) {
      ctx.err("Command 'smbclient' not found, but can be installed with:\nsudo apt install smbclient\n");
      return 127;
    }
    const o = parseArgs(ctx.argv.slice(1));
    if (!o) { ctx.err(USAGE); return 1; }
    const login = yield* credentials(ctx, o);
    if (o.list !== undefined) return yield* stepsIn(host.hooks, listShares(ctx, host, o.list.replace(/^(\/\/|\\\\)/, '').replace(/[/\\].*$/, ''), login), ctx.sh.liveWaits);
    const target = service(o.service ?? '');
    if (!target) { ctx.err(`${o.service ?? ''}: Not enough '\\' characters in service\n${USAGE}`); return 1; }
    const ip = yield* stepsIn(host.hooks, serverIp(ctx, host, target.server), ctx.sh.liveWaits);
    if (ip === null) return 1;
    const tree = yield* stepsIn(host.hooks, smbCallSteps(host, ip, login, target.share, { op: 'tree' }), ctx.sh.liveWaits);
    if (tree.status !== 'NT_STATUS_OK') return connectError(ctx, target.server, tree.status);
    return yield* session(ctx, { host, ip, server: target.server, share: target.share, login, cwd: '\\' }, o.commands);
  };
}
