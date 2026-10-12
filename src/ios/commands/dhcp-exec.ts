/** Exec-mode DHCP commands: show, clear and debug. */
import type { CommandDef } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { parseIp } from '../../core/ip.ts';
import { showBindings, showPools, showStatistics, showConflicts, showDatabase } from '../../dhcp/show.ts';

type Def = CommandDef<Cli<Router>>;

const now = (cli: Cli<Router>): number => cli.device.clock.now();

function debugFlag(cli: Cli<Router>, which: 'events' | 'packet', on: boolean): void {
  const s = cli.device.dhcp;
  if (which === 'events') s.debugEvents = on;
  else s.debugPacket = on;
  cli.out(`DHCP server ${which === 'events' ? 'event' : 'packet'} debugging is ${on ? 'on' : 'off'}.`);
}

export const DHCP_EXEC_USER: readonly Def[] = [
  {
    syntax: 'show ip dhcp binding [<A.B.C.D:ip>]',
    run: (cli, m) => cli.out(...showBindings(cli.device.dhcp, now(cli), m.get('ip') ? parseIp(m.get('ip') ?? '') ?? undefined : undefined)),
  },
  { syntax: 'show ip dhcp pool [<WORD:name>]', help: { name: 'Pool name' }, run: (cli, m) => cli.out(...showPools(cli.device.dhcp, now(cli), m.get('name'))) },
  { syntax: 'show ip dhcp server statistics', run: (cli) => cli.out(...showStatistics(cli.device.dhcp)) },
  { syntax: 'show ip dhcp conflict', run: (cli) => cli.out(...showConflicts(cli.device.dhcp)) },
  { syntax: 'show ip dhcp database', run: (cli) => cli.out(...showDatabase(cli.device.dhcp)) },
];

export const DHCP_EXEC_PRIV: readonly Def[] = [
  ...DHCP_EXEC_USER,
  {
    syntax: 'clear ip dhcp binding {* | <A.B.C.D:ip>}',
    help: { ip: 'IP address of DHCP binding' },
    run: (cli, m) => {
      const ip = m.get('ip') ? parseIp(m.get('ip') ?? '') ?? undefined : undefined;
      if (!cli.device.dhcp.clearBindings(ip)) cli.out(`% Binding for ${m.get('ip')} not found.`);
    },
  },
  {
    syntax: 'clear ip dhcp conflict {* | <A.B.C.D:ip>}',
    run: (cli, m) => {
      const ip = m.get('ip') ? parseIp(m.get('ip') ?? '') ?? undefined : undefined;
      if (!cli.device.dhcp.clearConflicts(ip)) cli.out(`% Conflict for ${m.get('ip')} not found.`);
    },
  },
  { syntax: 'clear ip dhcp server statistics', run: (cli) => cli.device.dhcp.clearStatistics() },
  { syntax: 'debug ip dhcp server {events | packet}', run: (cli, m) => debugFlag(cli, m.has('events') ? 'events' : 'packet', true) },
  { syntax: 'no debug ip dhcp server {events | packet}', run: (cli, m) => debugFlag(cli, m.has('events') ? 'events' : 'packet', false) },
  { syntax: 'undebug ip dhcp server {events | packet}', run: (cli, m) => debugFlag(cli, m.has('events') ? 'events' : 'packet', false) },
  {
    syntax: '{undebug all | no debug all}',
    run: (cli) => {
      cli.device.dhcp.debugEvents = false;
      cli.device.dhcp.debugPacket = false;
      cli.device.debugNat = false;
      cli.out('All possible debugging has been turned off');
    },
  },
  {
    syntax: 'show debugging',
    run: (cli) => {
      const s = cli.device.dhcp;
      const lines = ['DHCP server:'];
      if (s.debugEvents) lines.push('  DHCP server event debugging is on.');
      if (s.debugPacket) lines.push('  DHCP server packet debugging is on.');
      cli.out(...(lines.length > 1 ? lines : []));
    },
  },
];
