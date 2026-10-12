/** Exec and global-configuration commands shared by routers and switches. */
import type { CommandDef } from '../parser.ts';
import type { Cli, IosDevice } from '../device.ts';
import { parseIp, formatIp } from '../../core/ip.ts';
import { formatShowClock, parseClockSet } from '../../core/clock.ts';
import { applyConfig } from '../session.ts';
import { secretHash } from '../../core/hash.ts';
import { selectInterface, selectInterfaceRange } from './iface-select.ts';
import { showIpInterfaceBrief, showInterfaces } from './show-iface.ts';
import { HTTP_GLOBAL } from '../http.ts';

type Def = CommandDef<Cli<IosDevice>>;

const MAX_HOSTNAME = 63;

function startupBytes(device: IosDevice): number {
  return (device.startupConfig ?? []).reduce((n, l) => n + l.length + 1, 0);
}

export function renderRunning(device: IosDevice): string[] {
  const body = device.runningConfig();
  const bytes = body.reduce((n, l) => n + l.length + 1, 0);
  return ['Building configuration...', '', `Current configuration : ${bytes} bytes`, ...body];
}

function copyRunStart(cli: Cli): void {
  cli.out('Destination filename [startup-config]? ', 'Building configuration...', '[OK]');
  cli.device.startupConfig = cli.device.runningConfig();
}

function reload(cli: Cli): void {
  const device = cli.device;
  device.resetConfig();
  if (device.startupConfig) applyConfig(device, device.startupConfig);
  cli.session.enterMode('user');
  cli.out('Proceed with reload? [confirm]', '', '%SYS-5-RELOAD: Reload requested by console. Reload Reason: Reload Command.', '', 'Press RETURN to get started!', '');
}

export const EXEC_USER: readonly Def[] = [
  {
    syntax: 'enable',
    run: (cli) => {
      const d = cli.device;
      if (d.enableSecret || d.enablePassword) cli.session.requestPassword(() => cli.session.enterMode('exec'));
      else cli.session.enterMode('exec');
    },
  },
  { syntax: '{exit | logout}', run: (cli) => { cli.session.enterMode('user'); cli.out('', `${cli.device.hostname} con0 is now available`, '', '', '', '', '', 'Press RETURN to get started.', ''); } },
  { syntax: 'show version', run: (cli) => cli.out(...showVersion(cli.device)) },
  { syntax: 'show clock', run: (cli) => cli.out(formatShowClock(cli.device.clock.now())) },
  { syntax: 'show history', run: (cli) => cli.out(...cli.device.history.slice(-10).map((l) => `  ${l}`)) },
  { syntax: 'show ip interface brief', run: (cli) => cli.out(...showIpInterfaceBrief(cli.device)) },
  { syntax: 'show interfaces [<LINE:name>]', run: (cli, m) => cli.out(...showInterfaces(cli.device, m.get('name'))) },
  { syntax: 'terminal length <0-512:n>', run: () => undefined },
];

export const EXEC_PRIV: readonly Def[] = [
  ...EXEC_USER.filter((d) => d.syntax !== 'enable'),
  { syntax: 'enable', run: () => undefined },
  { syntax: 'disable', run: (cli) => cli.session.enterMode('user') },
  { syntax: 'configure terminal', run: (cli) => { cli.out('Enter configuration commands, one per line.  End with CNTL/Z.'); cli.session.enterMode('config'); } },
  { syntax: 'show running-config', run: (cli) => cli.out(...renderRunning(cli.device)) },
  {
    syntax: 'show startup-config',
    run: (cli) => {
      const cfg = cli.device.startupConfig;
      if (!cfg) cli.out('startup-config is not present');
      else cli.out(`Using ${startupBytes(cli.device)} bytes`, ...cfg);
    },
  },
  { syntax: 'copy running-config startup-config', run: copyRunStart },
  { syntax: 'write [memory]', run: (cli) => { cli.out('Building configuration...', '[OK]'); cli.device.startupConfig = cli.device.runningConfig(); } },
  { syntax: '{write erase | erase startup-config}', run: (cli) => { cli.device.startupConfig = null; cli.out('Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', '[OK]', 'Erase of nvram: complete', '%SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram'); } },
  { syntax: 'reload', run: reload },
  {
    syntax: 'clock set <WORD:time> <1-31:day> <WORD:month> <1993-2035:year>',
    run: (cli, m) => {
      const ms = parseClockSet(m.get('time') ?? '', m.get('day') ?? '', m.get('month') ?? '', m.get('year') ?? '');
      if (ms === null) cli.out('% Invalid input detected.');
      else cli.device.clock.set(ms);
    },
  },
];

export const GLOBAL: readonly Def[] = [
  { syntax: 'do <LINE:cmd>', run: (cli, m) => cli.session.runExec(m.get('cmd') ?? '') },
  { syntax: 'exit', help: { exit: 'Exit from configure mode' }, run: (cli) => cli.session.enterMode('exec') },
  { syntax: 'end', run: (cli) => endConfig(cli) },
  {
    syntax: 'hostname <WORD:name>',
    run: (cli, m) => {
      const name = m.get('name') ?? '';
      if (!/^[a-z]/i.test(name) || name.length > MAX_HOSTNAME) cli.out('% Hostname contains one or more illegal characters.');
      else cli.device.hostname = name;
    },
    noRun: (cli) => { cli.device.hostname = cli.device.kind === 'router' ? 'Router' : 'Switch'; },
  },
  { syntax: 'enable secret [0] <WORD:pw>', run: (cli, m) => { cli.device.enableSecret = secretHash(m.get('pw') ?? ''); }, noRun: (cli) => { cli.device.enableSecret = undefined; } },
  { syntax: 'enable secret 5 <WORD:hash>', run: (cli, m) => { cli.device.enableSecret = m.get('hash'); }, hidden: true },
  { syntax: 'enable password <WORD:pw>', run: (cli, m) => { cli.device.enablePassword = m.get('pw'); }, noRun: (cli) => { cli.device.enablePassword = undefined; } },
  { syntax: 'banner motd <LINE:text>', run: (cli, m) => { cli.device.bannerMotd = stripDelimiters(m.get('text') ?? ''); }, noRun: (cli) => { cli.device.bannerMotd = undefined; } },
  { syntax: 'ip domain-lookup', run: (cli) => { cli.device.domainLookup = true; }, noRun: (cli) => { cli.device.domainLookup = false; } },
  { syntax: 'ip domain-name <WORD:name>', run: (cli, m) => { cli.device.domainName = m.get('name'); }, noRun: (cli) => { cli.device.domainName = undefined; } },
  {
    syntax: 'ip name-server <A.B.C.D...:servers>',
    run: (cli, m) => { cli.device.nameServers = [...new Set([...cli.device.nameServers, ...m.all('servers').map((s) => parseIp(s) ?? 0)])]; },
    noRun: (cli) => { cli.device.nameServers = []; },
  },
  { syntax: 'interface range <LINE:spec>', run: (cli, m) => selectInterfaceRange(cli, m.get('spec') ?? '') },
  { syntax: 'interface <LINE:name>', run: (cli, m) => selectInterface(cli, m.get('name') ?? '') },
  { syntax: 'line {console <0-0:n> | vty <0-15:a> [<0-15:b>] | aux <0-0:x>}', run: (cli) => cli.session.enterMode('config-line') },
  { syntax: 'service password-encryption', run: () => undefined, noRun: () => undefined },
  { syntax: 'service timestamps [<LINE:rest>]', run: () => undefined, noRun: () => undefined, hidden: true },
  ...HTTP_GLOBAL,
];

export const LINE_MODE: readonly Def[] = [
  { syntax: 'password <WORD:pw>', run: () => undefined, noRun: () => undefined },
  { syntax: 'login [local]', run: () => undefined, noRun: () => undefined },
  { syntax: 'logging synchronous', run: () => undefined, noRun: () => undefined },
  { syntax: 'exec-timeout <0-35791:m> [<0-2147483:s>]', run: () => undefined, noRun: () => undefined },
  { syntax: 'transport input {ssh | telnet | all | none}', run: () => undefined, noRun: () => undefined },
  { syntax: 'exit', run: (cli) => cli.session.enterMode('config') },
  { syntax: 'end', run: (cli) => endConfig(cli) },
  { syntax: 'do <LINE:cmd>', run: (cli, m) => cli.session.runExec(m.get('cmd') ?? '') },
];

export function endConfig(cli: Cli): void {
  cli.session.endConfig();
}

function stripDelimiters(text: string): string {
  const t = text.trim();
  if (t.startsWith('^C') && t.endsWith('^C') && t.length >= 4) return t.slice(2, -2);
  const delim = t[0];
  if (delim && t.length > 1 && t.endsWith(delim) && !/[a-z0-9]/i.test(delim)) return t.slice(1, -1);
  return t;
}

function showVersion(device: IosDevice): string[] {
  const isRouter = device.kind === 'router';
  const image = isRouter ? 'C2900 Software (C2900-UNIVERSALK9-M), Version 15.1(4)M4' : 'C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4';
  return [
    `Cisco IOS Software, ${image}, RELEASE SOFTWARE (fc2)`,
    'Technical Support: http://www.cisco.com/techsupport',
    'Copyright (c) 1986-2012 by Cisco Systems, Inc.',
    '',
    `${device.hostname} uptime is 0 minutes`,
    `cisco ${device.model} processor with 491520K/32768K bytes of memory.`,
    `${device.ifaces.size} interfaces`,
    '',
    'Configuration register is 0x2102',
  ];
}

export function formatIps(ips: readonly number[]): string {
  return ips.map(formatIp).join(' ');
}
