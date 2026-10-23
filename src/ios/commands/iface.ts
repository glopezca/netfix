/** Interface configuration commands (routed ports, SVIs and switch ports). */
import type { CommandDef, Match } from '../parser.ts';
import type { Cli, IosDevice } from '../device.ts';
import type { IfaceConfig, SwitchportMode } from '../interfaces.ts';
import { isSubinterface, parseIfaceName } from '../interfaces.ts';
import { parseIp, parseMask, formatIp, networkOf, inSubnet, isUsableHost, prefixToMask } from '../../core/ip.ts';
import type { IpWithPrefix } from '../../core/ip.ts';
import { endConfig } from './common.ts';

type Def = CommandDef<Cli<IosDevice>>;

function eachIface(cli: Cli, change: (cfg: IfaceConfig) => IfaceConfig): void {
  for (const name of cli.session.ifaces) cli.device.updateIface(name, change);
}

function current(cli: Cli): IfaceConfig | undefined {
  const name = cli.session.ifaces[0];
  return name ? cli.device.iface(name) : undefined;
}

function hexMask(prefix: number): string {
  return `0x${prefixToMask(prefix).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** Returns an IOS error message if the address cannot be assigned, else null. */
export function validateIfaceAddress(device: IosDevice, ifaceName: string, addr: IpWithPrefix): string | null {
  if (!isUsableHost(addr.ip, addr.prefix)) return `Bad mask ${hexMask(addr.prefix)} for address ${formatIp(addr.ip)}`;
  for (const other of device.ifaces.values()) {
    if (other.name === ifaceName) continue;
    const used = [other.address, ...other.secondaries].filter((a): a is IpWithPrefix => a !== undefined);
    const clash = used.some((a) => inSubnet(addr.ip, a.ip, a.prefix) || inSubnet(a.ip, addr.ip, addr.prefix));
    if (clash) return `% ${formatIp(networkOf(addr.ip, addr.prefix))} overlaps with ${other.name}`;
  }
  return null;
}

function setAddress(cli: Cli, m: Match): void {
  const ip = parseIp(m.get('ip') ?? '');
  const prefix = parseMask(m.get('mask') ?? '');
  const name = cli.session.ifaces[0];
  const raw = parseIp(m.get('mask') ?? '');
  // A dotted mask whose ones are not contiguous (255.255.0.255, 192.168.1.0): IOS shows it in hex.
  if (ip !== null && prefix === null && raw !== null) return cli.out(`Bad mask 0x${raw.toString(16).toUpperCase().padStart(8, '0')} for address ${formatIp(ip)}`);
  if (ip === null || prefix === null || !name) return;
  if (rejectOnSwitchport(cli)) return;
  const addr = { ip, prefix };
  const error = validateIfaceAddress(cli.device, name, addr);
  if (error) {
    cli.out(error);
    return;
  }
  if (m.has('secondary')) {
    cli.device.updateIface(name, (c) => ({ ...c, secondaries: [...c.secondaries.filter((s) => s.ip !== ip), addr] }));
    return;
  }
  cli.device.updateIface(name, (c) => ({ ...c, address: addr, dhcpClient: undefined }));
}

function removeAddress(cli: Cli, m: Match): void {
  const ip = parseIp(m.get('ip') ?? '');
  if (m.has('secondary') && ip !== null) {
    eachIface(cli, (c) => ({ ...c, secondaries: c.secondaries.filter((s) => s.ip !== ip) }));
    return;
  }
  eachIface(cli, (c) => ({ ...c, address: undefined, secondaries: [], dhcpClient: undefined }));
}

function rejectOnSwitchport(cli: Cli): boolean {
  if (!current(cli)?.switchport) return false;
  cli.out("% Invalid input detected at '^' marker.", '');
  return true;
}

function setDhcpClient(cli: Cli, m: Match): void {
  if (rejectOnSwitchport(cli)) return;
  const cidIface = m.get('cidif');
  const parsed = cidIface ? parseIfaceName(cidIface) : null;
  if (cidIface && !parsed) {
    cli.out('%Invalid interface type and number');
    return;
  }
  const dhcpClient = { clientIdIface: parsed?.full, hostname: m.get('host') };
  eachIface(cli, (c) => ({ ...c, address: undefined, secondaries: [], dhcpClient }));
}

const exitIf: Def = { syntax: 'exit', help: { exit: 'Exit from interface configuration mode' }, run: (cli) => { cli.session.ifaces = []; cli.session.enterMode('config'); } };
const endIf: Def = { syntax: 'end', run: (cli) => endConfig(cli) };
const doIf: Def = { syntax: 'do <LINE:cmd>', run: (cli, m) => cli.session.runExec(m.get('cmd') ?? '') };

const COMMON_IF: readonly Def[] = [
  exitIf, endIf, doIf,
  { syntax: 'shutdown', run: (cli) => eachIface(cli, (c) => ({ ...c, shutdown: true })), noRun: (cli) => eachIface(cli, (c) => ({ ...c, shutdown: false })) },
  { syntax: 'description <LINE:text>', run: (cli, m) => eachIface(cli, (c) => ({ ...c, description: m.get('text') })), noRun: (cli) => eachIface(cli, (c) => ({ ...c, description: undefined })) },
];

const PHYSICAL_IF: readonly Def[] = [
  { syntax: 'duplex {auto | full | half}', run: (cli, m) => eachIface(cli, (c) => ({ ...c, duplex: ['full', 'half'].find((d) => m.has(d)) })), noRun: (cli) => eachIface(cli, (c) => ({ ...c, duplex: undefined })) },
  { syntax: 'speed {10 | 100 | 1000 | auto}', run: (cli, m) => eachIface(cli, (c) => ({ ...c, speed: ['10', '100', '1000'].find((s) => m.has(s)) })), noRun: (cli) => eachIface(cli, (c) => ({ ...c, speed: undefined })) },
];

export const L3_IF: readonly Def[] = [
  ...COMMON_IF,
  { syntax: 'ip address <A.B.C.D:ip> <A.B.C.D:mask> [secondary]', run: setAddress, noRun: removeAddress },
  {
    syntax: 'ip address dhcp [client-id <IFACE:cidif>] [hostname <WORD:host>]',
    help: { cidif: 'Interface name', host: 'Host name' },
    run: setDhcpClient,
    noRun: removeAddress,
  },
  {
    syntax: 'ip helper-address <A.B.C.D:ip>',
    run: (cli, m) => {
      const ip = parseIp(m.get('ip') ?? '') ?? 0;
      eachIface(cli, (c) => ({ ...c, helpers: c.helpers.includes(ip) ? c.helpers : [...c.helpers, ip] }));
    },
    noRun: (cli, m) => {
      const ip = parseIp(m.get('ip') ?? '');
      eachIface(cli, (c) => ({ ...c, helpers: ip === null ? [] : c.helpers.filter((h) => h !== ip) }));
    },
  },
  {
    syntax: 'ip directed-broadcast',
    run: (cli) => eachIface(cli, (c) => ({ ...c, directedBroadcast: true })),
    noRun: (cli) => eachIface(cli, (c) => ({ ...c, directedBroadcast: undefined })),
  },
  {
    syntax: 'ip dhcp relay information trusted',
    run: (cli) => eachIface(cli, (c) => ({ ...c, relayInfoTrusted: true })),
    noRun: (cli) => eachIface(cli, (c) => ({ ...c, relayInfoTrusted: false })),
  },
];

export const ROUTER_IF: readonly Def[] = [...L3_IF, ...PHYSICAL_IF];

export const ROUTER_SUBIF: readonly Def[] = [
  ...L3_IF,
  {
    syntax: 'encapsulation dot1Q <1-4094:vlan> [native]',
    run: (cli, m) => {
      const cfg = current(cli);
      if (!cfg || !isSubinterface(cfg.name)) return;
      eachIface(cli, (c) => ({ ...c, encapsulationVlan: Number(m.get('vlan')) }));
    },
    noRun: (cli) => eachIface(cli, (c) => ({ ...c, encapsulationVlan: undefined })),
  },
];

function setMode(mode: SwitchportMode): (cfg: IfaceConfig) => IfaceConfig {
  return (c) => ({ ...c, switchportMode: mode });
}

export const SWITCH_PORT_IF: readonly Def[] = [
  ...COMMON_IF,
  ...PHYSICAL_IF,
  {
    syntax: 'switchport mode {access | trunk | dynamic {auto | desirable}}',
    run: (cli, m) => eachIface(cli, setMode(m.has('access') ? 'access' : m.has('trunk') ? 'trunk' : 'dynamic auto')),
    noRun: (cli) => eachIface(cli, setMode('dynamic auto')),
  },
  {
    syntax: 'switchport access vlan <1-4094:vlan>',
    run: (cli, m) => {
      const vlan = Number(m.get('vlan'));
      const dev = cli.device as IosDevice & { ensureVlan?: (id: number) => boolean };
      if (dev.ensureVlan?.(vlan)) cli.out('% Access VLAN does not exist. Creating vlan ' + vlan);
      eachIface(cli, (c) => ({ ...c, accessVlan: vlan }));
    },
    noRun: (cli) => eachIface(cli, (c) => ({ ...c, accessVlan: 1 })),
  },
  { syntax: 'switchport trunk native vlan <1-4094:vlan>', run: (cli, m) => eachIface(cli, (c) => ({ ...c, nativeVlan: Number(m.get('vlan')) })), noRun: (cli) => eachIface(cli, (c) => ({ ...c, nativeVlan: 1 })) },
  { syntax: 'switchport trunk allowed vlan <LINE:list>', run: () => undefined, noRun: () => undefined },
  { syntax: 'switchport nonegotiate', run: () => undefined, noRun: () => undefined },
  { syntax: 'switchport port-security [<LINE:rest>]', run: () => undefined, noRun: () => undefined },
  { syntax: 'spanning-tree portfast [<LINE:rest>]', run: () => undefined, noRun: () => undefined },
];

/** Switches only route on SVIs; the commands are rejected on switch ports. */
export const SWITCH_IP_IF: readonly Def[] = [
  { syntax: 'ip address <A.B.C.D:ip> <A.B.C.D:mask>', run: setAddress, noRun: removeAddress },
  { syntax: 'ip address dhcp [client-id <IFACE:cidif>] [hostname <WORD:host>]', run: setDhcpClient, noRun: removeAddress },
];
