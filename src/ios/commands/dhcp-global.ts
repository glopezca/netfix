/** Global DHCP commands: service dhcp, ip dhcp pool/excluded-address/conflict/ping/... */
import type { CommandDef } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Router } from '../../devices/router.ts';
import { parseIp } from '../../core/ip.ts';
import { newPool } from '../../dhcp/pool.ts';

type Def = CommandDef<Cli<Router>>;

const DEFAULT_PING_PACKETS = 2;
const DEFAULT_PING_TIMEOUT = 500;

function enterPool(cli: Cli<Router>, name: string): void {
  const server = cli.device.dhcp;
  if (!server.pool(name)) server.savePool(newPool(name));
  cli.session.pool = name;
  cli.session.enterMode('dhcp-config');
}

export const DHCP_GLOBAL: readonly Def[] = [
  {
    syntax: 'service dhcp',
    help: { service: 'Modify use of network based services', dhcp: 'Enable DHCP server and relay agent' },
    run: (cli) => { cli.device.dhcp.serviceEnabled = true; },
    noRun: (cli) => { cli.device.dhcp.serviceEnabled = false; },
  },
  {
    syntax: 'ip dhcp pool <WORD:name>',
    help: { name: 'Pool name' },
    run: (cli, m) => enterPool(cli, m.get('name') ?? ''),
    noRun: (cli, m) => {
      const name = m.get('name');
      if (name && !cli.device.dhcp.deletePool(name)) cli.out(`%DHCP pool ${name} does not exist`);
    },
  },
  {
    syntax: 'ip dhcp excluded-address <A.B.C.D:low> [<A.B.C.D:high>]',
    help: { low: 'Low IP address', high: 'High IP address' },
    run: (cli, m) => {
      const low = parseIp(m.get('low') ?? '') ?? 0;
      const high = m.get('high') ? parseIp(m.get('high') ?? '') ?? low : low;
      if (high < low) {
        cli.out('% Invalid address range.');
        return;
      }
      const s = cli.device.dhcp;
      if (!s.excluded.some((r) => r.low === low && r.high === high)) s.excluded = [...s.excluded, { low, high }];
    },
    noRun: (cli, m) => {
      const low = parseIp(m.get('low') ?? '');
      const high = m.get('high') ? parseIp(m.get('high') ?? '') : low;
      const s = cli.device.dhcp;
      const before = s.excluded.length;
      s.excluded = s.excluded.filter((r) => !(r.low === low && r.high === high));
      if (low !== null && s.excluded.length === before) cli.out('% Range not found');
    },
  },
  {
    syntax: 'ip dhcp conflict logging',
    run: (cli) => { cli.device.dhcp.conflictLogging = true; },
    noRun: (cli) => { cli.device.dhcp.conflictLogging = false; },
  },
  {
    syntax: 'ip dhcp ping packets <0-10:n>',
    help: { packets: 'Specify number of ping packets', n: 'Number of ping packets (0 disables ping)' },
    run: (cli, m) => { cli.device.dhcp.pingPackets = Number(m.get('n')); },
    noRun: (cli) => { cli.device.dhcp.pingPackets = DEFAULT_PING_PACKETS; },
  },
  {
    syntax: 'ip dhcp ping timeout <100-10000:ms>',
    help: { ping: 'Specify ping parameters used by DHCP', timeout: 'Specify ping timeout', ms: 'Ping timeout in milliseconds' },
    run: (cli, m) => { cli.device.dhcp.pingTimeoutMs = Number(m.get('ms')); },
    noRun: (cli) => { cli.device.dhcp.pingTimeoutMs = DEFAULT_PING_TIMEOUT; },
  },
  {
    syntax: 'ip dhcp bootp ignore',
    run: (cli) => { cli.device.dhcp.bootpIgnore = true; },
    noRun: (cli) => { cli.device.dhcp.bootpIgnore = false; },
  },
  {
    syntax: 'ip dhcp database <LINE:url>',
    help: { url: 'Database URL and options (timeout, write-delay)' },
    run: (cli, m) => {
      const s = cli.device.dhcp;
      const url = m.get('url') ?? '';
      s.databases = [...s.databases.filter((d) => d.split(' ')[0] !== url.split(' ')[0]), url];
    },
    noRun: (cli, m) => {
      const s = cli.device.dhcp;
      const url = (m.get('url') ?? '').split(' ')[0];
      s.databases = url ? s.databases.filter((d) => d.split(' ')[0] !== url) : [];
    },
  },
  {
    syntax: 'ip dhcp relay information option',
    run: (cli) => { cli.device.dhcp.relayInfoOption = true; },
    noRun: (cli) => { cli.device.dhcp.relayInfoOption = false; },
  },
  {
    syntax: 'ip dhcp relay information trust-all',
    run: (cli) => { cli.device.dhcp.relayInfoTrustAll = true; },
    noRun: (cli) => { cli.device.dhcp.relayInfoTrustAll = false; },
  },
  {
    syntax: 'ip dhcp relay information policy {drop | keep | replace}',
    help: { policy: 'Define reforwarding policy', drop: 'Drop the packet', keep: 'Keep the existing relay information', replace: 'Replace the relay information' },
    run: (cli, m) => { cli.device.dhcp.relayInfoPolicy = ['drop', 'keep', 'replace'].find((p) => m.has(p)); },
    noRun: (cli) => { cli.device.dhcp.relayInfoPolicy = undefined; },
  },
  {
    syntax: 'ip dhcp smart-relay',
    run: (cli) => { cli.device.dhcp.smartRelay = true; },
    noRun: (cli) => { cli.device.dhcp.smartRelay = false; },
  },
  {
    syntax: 'ip dhcp use {vrf {connected | remote} | class [aaa] | subscriber-id client-id | hardware-address client-id}',
    help: { connected: 'Use VRF connected', remote: 'Use VRF remote', aaa: 'Use AAA' },
    run: (cli, m) => {
      const value = useValue(m);
      const s = cli.device.dhcp;
      if (!s.useOptions.includes(value)) s.useOptions = [...s.useOptions, value];
    },
    noRun: (cli, m) => {
      const value = useValue(m);
      const s = cli.device.dhcp;
      s.useOptions = s.useOptions.filter((u) => u !== value);
    },
  },
];

function useValue(m: { has(k: string): boolean }): string {
  if (m.has('vrf')) return `vrf ${m.has('remote') ? 'remote' : 'connected'}`;
  if (m.has('class')) return m.has('aaa') ? 'class aaa' : 'class';
  if (m.has('subscriber-id')) return 'subscriber-id client-id';
  return 'hardware-address client-id';
}
