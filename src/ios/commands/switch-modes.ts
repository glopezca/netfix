/** Mode table for 2960 switches: VLANs, MAC table, SVI ping and DHCP snooping. */
import type { CommandDef } from '../parser.ts';
import type { Cli, ModeTable } from '../device.ts';
import type { Switch } from '../../devices/switch.ts';
import { DEFAULT_VLANS, SWITCH_PORTS } from '../../devices/switch-ports.ts';
import { EXEC_USER, EXEC_PRIV, GLOBAL, LINE_MODE, endConfig } from './common.ts';
import { SWITCH_PORT_IF, SWITCH_IP_IF } from './iface.ts';
import { iosPing, showArp } from './net-exec.ts';
import { parseIp } from '../../core/ip.ts';
import { formatMacCisco } from '../../core/mac.ts';
import { shortIfaceName } from '../interfaces.ts';
import { parseVlanList } from '../../core/vlans.ts';
import { STP_EXEC, STP_GLOBAL, STP_IF } from './stp.ts';
import { showInterfacesTrunk } from '../show-trunk.ts';
import { showInterfacesStatus } from '../show-status.ts';

type Def = CommandDef<Cli<Switch>>;

function showMacTable(sw: Switch): string[] {
  const rows = [...sw.macTable.values()].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
  return [
    '          Mac Address Table',
    '-------------------------------------------',
    '',
    'Vlan    Mac Address       Type        Ports',
    '----    -----------       --------    -----',
    '',
    ...rows.map((r) => `${String(r.vlan).padStart(4)}    ${formatMacCisco(r.mac).padEnd(18)}DYNAMIC     ${shortIfaceName(r.port)}`),
  ];
}

function wrapPorts(ports: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ports.length; i += 4) out.push(ports.slice(i, i + 4).join(', '));
  return out.length ? out : [''];
}

function showVlanBrief(sw: Switch): string[] {
  const lines = [
    'VLAN Name                             Status    Ports',
    '---- -------------------------------- --------- -------------------------------',
  ];
  for (const [id, name] of [...sw.vlans.entries()].sort((a, b) => a[0] - b[0])) {
    const ports = SWITCH_PORTS.filter((p) => {
      const cfg = sw.iface(p);
      return cfg && !sw.isTrunk(p) && cfg.accessVlan === id;
    }).map(shortIfaceName);
    const [first, ...rest] = wrapPorts(ports);
    const status = DEFAULT_VLANS.has(id) && id !== 1 ? 'act/unsup' : 'active';
    lines.push(`${String(id).padEnd(5)}${name.padEnd(33)}${status.padEnd(10)}${first}`);
    for (const r of rest) lines.push(`${''.padEnd(48)}${r}`);
  }
  return lines;
}

function pingHost(sw: Switch): { stack: Switch['stack']; hooks: Switch['hooks']; sourceFor: (t: string) => number | undefined } {
  return { stack: sw.stack, hooks: sw.hooks, sourceFor: (t) => parseIp(t) ?? undefined };
}

const SW_EXEC: readonly Def[] = [
  {
    syntax: 'show {mac-address-table | mac address-table}',
    run: (cli) => {
      cli.device.syncStp();
      cli.out(...showMacTable(cli.device));
    },
  },
  { syntax: 'show vlan [brief]', run: (cli) => cli.out(...showVlanBrief(cli.device)) },
  { syntax: 'show interfaces trunk', run: (cli) => cli.out(...showInterfacesTrunk(cli.device)) },
  { syntax: 'show interfaces status [err-disabled]', run: (cli, m) => cli.out(...showInterfacesStatus(cli.device).filter((l, i) => i < 2 || !m.has('err-disabled') || l.includes('err-disabled'))) },
  { syntax: 'show ip dhcp snooping', run: (cli) => cli.out(...cli.device.snooping.show()) },
  { syntax: 'show ip dhcp snooping binding', run: (cli) => cli.out(...cli.device.snooping.showBindings()) },
  { syntax: 'ping <WORD:target> [repeat <1-2147483647:n>]', run: (cli, m) => iosPing(cli, pingHost(cli.device), m.get('target') ?? '', Number(m.get('n') ?? 5)) },
  {
    syntax: 'show {arp | ip arp}',
    run: (cli) => {
      const own = cli.device.l3Ifaces().filter((i) => i.up).flatMap((i) => i.addrs.map((a) => ({ ip: a.ip, mac: i.mac, iface: i.name })));
      cli.out(...showArp(cli.device.stack, own, cli.device.clock.now()));
    },
  },
];

const SW_PRIV: readonly Def[] = [
  ...SW_EXEC,
  { syntax: 'clear {mac-address-table | mac address-table} [dynamic]', run: (cli) => cli.device.macTable.clear() },
  { syntax: 'clear ip dhcp snooping binding [*]', run: (cli) => cli.device.snooping.bindings.clear() },
];

function snoopVlans(cli: Cli<Switch>, text: string, add: boolean): void {
  const ids = parseVlanList(text);
  if (!ids) {
    cli.out('% Invalid VLAN list');
    return;
  }
  const s = cli.device.snooping;
  s.vlans = new Set(add ? [...s.vlans, ...ids] : [...s.vlans].filter((v) => !ids.includes(v)));
}

const SW_GLOBAL: readonly Def[] = [
  {
    syntax: 'vlan <1-4094:id>',
    run: (cli, m) => {
      const id = Number(m.get('id'));
      if (id >= 1002 && id <= 1005) {
        cli.out(`Default VLAN ${id} may not have its name changed.`);
        return;
      }
      cli.device.ensureVlan(id);
      cli.session.vlan = id;
      cli.session.enterMode('config-vlan');
    },
    noRun: (cli, m) => {
      const id = Number(m.get('id'));
      if (DEFAULT_VLANS.has(id)) cli.out(`%Default VLAN ${id} may not be deleted.`);
      else {
        cli.device.vlans.delete(id);
        cli.device.stpChanged();
      }
    },
  },
  {
    syntax: 'ip default-gateway <A.B.C.D:gw>',
    run: (cli, m) => { cli.device.defaultGateway = parseIp(m.get('gw') ?? '') ?? undefined; },
    noRun: (cli) => { cli.device.defaultGateway = undefined; },
  },
  { syntax: 'ip dhcp snooping', run: (cli) => { cli.device.snooping.enabled = true; }, noRun: (cli) => { cli.device.snooping.enabled = false; } },
  {
    syntax: 'ip dhcp snooping vlan <LINE:vlans>',
    help: { vlans: 'DHCP Snooping vlan first number or vlan range, example: 1,3-5,7,9-11' },
    run: (cli, m) => snoopVlans(cli, m.get('vlans') ?? '', true),
    noRun: (cli, m) => snoopVlans(cli, m.get('vlans') ?? '', false),
  },
  {
    syntax: 'ip dhcp snooping information option [allow-untrusted]',
    run: (cli) => { cli.device.snooping.option82 = true; },
    noRun: (cli) => { cli.device.snooping.option82 = false; },
  },
  { syntax: 'ip dhcp snooping database <WORD:url>', run: (cli, m) => { cli.device.snooping.database = m.get('url'); }, noRun: (cli) => { cli.device.snooping.database = undefined; } },
  { syntax: 'ip dhcp snooping verify mac-address', run: (cli) => { cli.device.snooping.verifyMac = true; }, noRun: (cli) => { cli.device.snooping.verifyMac = false; } },
];

function eachPort(cli: Cli<Switch>, fn: (port: string) => void): void {
  for (const p of cli.session.ifaces) if (cli.device.iface(p)?.switchport) fn(p);
}

const SW_SNOOP_IF: readonly Def[] = [
  {
    syntax: 'ip dhcp snooping trust',
    run: (cli) => eachPort(cli, (p) => cli.device.snooping.trusted.add(p)),
    noRun: (cli) => eachPort(cli, (p) => cli.device.snooping.trusted.delete(p)),
  },
  {
    syntax: 'ip dhcp snooping limit rate <1-2048:pps>',
    run: (cli, m) => eachPort(cli, (p) => cli.device.snooping.rateLimits.set(p, Number(m.get('pps')))),
    noRun: (cli) => eachPort(cli, (p) => cli.device.snooping.rateLimits.delete(p)),
  },
];

const VLAN_MODE: readonly Def[] = [
  {
    syntax: 'name <WORD:name>',
    run: (cli, m) => { if (cli.session.vlan !== undefined) cli.device.vlans.set(cli.session.vlan, m.get('name') ?? ''); },
    noRun: (cli) => { const id = cli.session.vlan; if (id !== undefined) cli.device.vlans.set(id, `VLAN${String(id).padStart(4, '0')}`); },
  },
  { syntax: 'exit', run: (cli) => { cli.session.vlan = undefined; cli.session.enterMode('config'); } },
  { syntax: 'end', run: (cli) => endConfig(cli) },
];

export const switchModeTable: ModeTable<Switch> = {
  user: [...EXEC_USER, ...SW_EXEC, ...STP_EXEC],
  exec: [...EXEC_PRIV, ...SW_PRIV, ...STP_EXEC],
  config: [...GLOBAL, ...SW_GLOBAL, ...STP_GLOBAL],
  'config-if': [...SWITCH_PORT_IF, ...SWITCH_IP_IF, ...SW_SNOOP_IF, ...STP_IF],
  'config-if-range': [...SWITCH_PORT_IF, ...SW_SNOOP_IF, ...STP_IF],
  'config-line': [...LINE_MODE],
  'config-vlan': [...VLAN_MODE],
};

