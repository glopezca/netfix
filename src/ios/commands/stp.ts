/** Spanning tree commands of a 2960: global (mode, VLAN priorities), per interface and the show commands. */
import type { CommandDef } from '../parser.ts';
import type { Cli } from '../device.ts';
import type { Switch } from '../../devices/switch.ts';
import { parseVlanList } from '../../core/vlans.ts';
import { BRIDGE_PRIORITY_STEP, PORT_PRIORITY_STEP } from '../../devices/stp-config.ts';
import { showStp, showStpInterface, showStpSummary, showStpVlan, rootPriority } from '../show-stp.ts';

type Def = CommandDef<Cli<Switch>>;

const PRIORITY_ERROR = [
  '% Bridge Priority must be in increments of 4096.',
  '% Allowed values are:',
  '  0     4096  8192  12288 16384 20480 24576 28672',
  '  32768 36864 40960 45056 49152 53248 57344 61440',
];

const PORT_PRIORITY_ERROR = [
  '% Port Priority in increments of 16 is required',
  '% Allowed values are:',
  '  0   16  32  48  64  80  96  112 128 144 160 176 192 208 224 240',
];

const PORTFAST_WARNING = [
  '%Warning: portfast should only be enabled on ports connected to a single',
  ' host. Connecting hubs, concentrators, switches, bridges, etc... to this',
  ' interface  when portfast is enabled, can cause temporary bridging loops.',
  ' Use with CAUTION',
  '',
];

/** Applies `change` to each VLAN of the list, or says the list is wrong. */
function eachVlan(cli: Cli<Switch>, text: string, change: (vlan: number) => void): void {
  const ids = parseVlanList(text);
  if (!ids) {
    cli.out('% Invalid VLAN list');
    return;
  }
  for (const v of ids) change(v);
  cli.device.stpChanged();
}

function eachPort(cli: Cli<Switch>, fn: (port: string) => void): void {
  for (const p of cli.session.ifaces) if (cli.device.iface(p)?.switchport) fn(p);
  cli.device.stpChanged();
}

function setPriority(cli: Cli<Switch>, vlans: string, value: number): void {
  if (value % BRIDGE_PRIORITY_STEP !== 0) {
    cli.out(...PRIORITY_ERROR);
    return;
  }
  eachVlan(cli, vlans, (v) => cli.device.stp.priorities.set(v, value));
}

export const STP_EXEC: readonly Def[] = [
  { syntax: 'show spanning-tree', run: (cli) => cli.out(...showStp(cli.device)) },
  { syntax: 'show spanning-tree vlan <1-4094:vlan>', run: (cli, m) => cli.out(...showStpVlan(cli.device, Number(m.get('vlan')))) },
  { syntax: 'show spanning-tree summary', run: (cli) => cli.out(...showStpSummary(cli.device)) },
  { syntax: 'show spanning-tree interface <IFACE:if>', run: (cli, m) => cli.out(...showStpInterface(cli.device, m.get('if') ?? '')) },
];

export const STP_GLOBAL: readonly Def[] = [
  {
    syntax: 'spanning-tree mode {pvst | rapid-pvst}',
    run: (cli, m) => { cli.device.stp.mode = m.has('rapid-pvst') ? 'rapid-pvst' : 'pvst'; },
    noRun: (cli) => { cli.device.stp.mode = 'pvst'; },
  },
  {
    syntax: 'spanning-tree vlan <WORD:vlans> priority <0-61440:p>',
    run: (cli, m) => setPriority(cli, m.get('vlans') ?? '', Number(m.get('p'))),
    noRun: (cli, m) => eachVlan(cli, m.get('vlans') ?? '', (v) => cli.device.stp.priorities.delete(v)),
  },
  {
    syntax: 'spanning-tree vlan <WORD:vlans> root {primary | secondary}',
    run: (cli, m) => eachVlan(cli, m.get('vlans') ?? '', (v) => cli.device.stp.priorities.set(v, rootPriority(cli.device, v, m.has('primary')))),
    noRun: (cli, m) => eachVlan(cli, m.get('vlans') ?? '', (v) => cli.device.stp.priorities.delete(v)),
  },
  // After priority and root: in the no form the prefixes of those overwrite this one, and `no spanning-tree vlan N` must disable.
  {
    syntax: 'spanning-tree vlan <WORD:vlans>',
    help: { vlans: 'VLAN IDs of the spanning tree instances' },
    run: (cli, m) => eachVlan(cli, m.get('vlans') ?? '', (v) => cli.device.stp.disabled.delete(v)),
    noRun: (cli, m) => eachVlan(cli, m.get('vlans') ?? '', (v) => cli.device.stp.disabled.add(v)),
  },
  { syntax: 'spanning-tree <LINE:rest>', run: () => undefined, noRun: () => undefined },
];

export const STP_IF: readonly Def[] = [
  {
    syntax: 'spanning-tree portfast [{trunk | disable | edge [trunk] | default}]',
    run: (cli, m) => {
      if (m.has('disable')) return eachPort(cli, (p) => cli.device.stp.portfast.delete(p));
      cli.out(...PORTFAST_WARNING);
      eachPort(cli, (p) => {
        cli.device.stp.portfast.add(p);
        if (cli.device.isTrunk(p) && !m.has('trunk')) cli.out(`%Portfast has been configured on ${p} but will only`, ' have effect when the interface is in a non-trunking mode.');
      });
    },
    noRun: (cli) => eachPort(cli, (p) => cli.device.stp.portfast.delete(p)),
  },
  {
    syntax: 'spanning-tree bpduguard {enable | disable}',
    run: (cli, m) => eachPort(cli, (p) => (m.has('enable') ? cli.device.stp.bpduguard.add(p) : cli.device.stp.bpduguard.delete(p))),
    noRun: (cli) => eachPort(cli, (p) => cli.device.stp.bpduguard.delete(p)),
  },
  {
    syntax: 'spanning-tree cost <1-200000000:cost>',
    run: (cli, m) => eachPort(cli, (p) => cli.device.stp.costs.set(p, Number(m.get('cost')))),
    noRun: (cli) => eachPort(cli, (p) => cli.device.stp.costs.delete(p)),
  },
  {
    syntax: 'spanning-tree port-priority <0-240:prio>',
    run: (cli, m) => {
      const prio = Number(m.get('prio'));
      if (prio % PORT_PRIORITY_STEP !== 0) cli.out(...PORT_PRIORITY_ERROR);
      else eachPort(cli, (p) => cli.device.stp.portPriorities.set(p, prio));
    },
    noRun: (cli) => eachPort(cli, (p) => cli.device.stp.portPriorities.delete(p)),
  },
];
