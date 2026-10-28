/** `show spanning-tree` of a 2960 (IOS 15): per VLAN, by interface, and the summary. */
import type { Switch } from '../devices/switch.ts';
import type { StpVlan } from '../net/stp.ts';
import { formatMacCisco } from '../core/mac.ts';
import { shortIfaceName } from './interfaces.ts';
import { DEFAULT_BRIDGE_PRIORITY } from '../devices/stp-config.ts';

/** Fa0/1, Gi0/1 (as IOS writes ports in spanning tree tables). */
const portName = (name: string): string => shortIfaceName(name).replace(/^Gig/, 'Gi');

const TIMERS = '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec';
const VLAN_RULE = '------------------- ---- --- --------- -------- --------------------------------';

const vlanName = (v: number): string => `VLAN${String(v).padStart(4, '0')}`;

/** The VLANs where this switch runs spanning tree. */
export function stpVlans(sw: Switch): number[] {
  return [...sw.vlans.keys()].sort((a, b) => a - b).filter((v) => sw.stpVlan(v) !== undefined);
}

function portRow(label: string, width: number, p: { role: string; forwarding: boolean; cost: number; priority: number; number: number; edge: boolean }): string {
  return `${label.padEnd(width)} ${p.role} ${p.forwarding ? 'FWD' : 'BLK'} ${String(p.cost).padEnd(9)} ${`${p.priority}.${p.number}`.padEnd(8)} P2p${p.edge ? ' Edge' : ''}`;
}

function rootLines(s: StpVlan): string[] {
  const head = [`  Root ID    Priority    ${s.root.priority}`, `             Address     ${formatMacCisco(s.root.mac)}`];
  if (!s.rootPort) return [...head, '             This bridge is the root', TIMERS];
  const number = s.ports.get(s.rootPort)?.number ?? 0;
  return [...head, `             Cost        ${s.cost}`, `             Port        ${number} (${s.rootPort})`, TIMERS];
}

export function showStpVlan(sw: Switch, vlan: number): string[] {
  const s = sw.stpVlan(vlan);
  if (!s) return [`Spanning tree instance(s) for vlan ${vlan} does not exist.`];
  const base = s.bridge.priority - vlan;
  const ports = [...s.ports].sort((a, b) => a[1].number - b[1].number);
  return [
    vlanName(vlan),
    `  Spanning tree enabled protocol ${sw.stp.mode === 'pvst' ? 'ieee' : 'rstp'}`,
    ...rootLines(s),
    '',
    `  Bridge ID  Priority    ${s.bridge.priority}  (priority ${base} sys-id-ext ${vlan})`,
    `             Address     ${formatMacCisco(s.bridge.mac)}`,
    TIMERS,
    '             Aging Time  300 sec',
    '',
    'Interface           Role Sts Cost      Prio.Nbr Type',
    VLAN_RULE,
    ...ports.map(([name, p]) => portRow(portName(name), 19, p)),
  ];
}

export function showStp(sw: Switch): string[] {
  const vlans = stpVlans(sw);
  if (!vlans.length) return ['No spanning tree instance exists.'];
  return vlans.flatMap((v, i) => [...(i ? [''] : []), ...showStpVlan(sw, v)]);
}

export function showStpInterface(sw: Switch, port: string): string[] {
  const rows = stpVlans(sw).flatMap((v) => {
    const p = sw.stpVlan(v)?.ports.get(port);
    return p ? [portRow(vlanName(v), 19, p)] : [];
  });
  if (!rows.length) return ['no spanning tree info available for ' + port];
  return ['Vlan                Role Sts Cost      Prio.Nbr Type', VLAN_RULE, ...rows];
}

export function showStpSummary(sw: Switch): string[] {
  const vlans = stpVlans(sw);
  const roots = vlans.filter((v) => !sw.stpVlan(v)?.rootPort).map(vlanName);
  const counts = vlans.map((v) => {
    const ports = [...(sw.stpVlan(v)?.ports.values() ?? [])];
    const fwd = ports.filter((p) => p.forwarding).length;
    return { v, blk: ports.length - fwd, fwd };
  });
  const row = (name: string, blk: number, fwd: number): string => `${name.padEnd(22)} ${String(blk).padStart(8)} ${'0'.padStart(9)} ${'0'.padStart(8)} ${String(fwd).padStart(10)} ${String(blk + fwd).padStart(10)}`;
  const rule = '---------------------- -------- --------- -------- ---------- ----------';
  const blk = counts.reduce((n, c) => n + c.blk, 0);
  const fwd = counts.reduce((n, c) => n + c.fwd, 0);
  return [
    `Switch is in ${sw.stp.mode} mode`,
    `Root bridge for: ${roots.length ? roots.join(', ') : 'none'}`,
    'EtherChannel misconfig guard is enabled',
    'Extended system ID           is enabled',
    'Portfast Default             is disabled',
    'PortFast BPDU Guard Default  is disabled',
    'Portfast BPDU Filter Default is disabled',
    'Loopguard Default            is disabled',
    'UplinkFast                   is disabled',
    'BackboneFast                 is disabled',
    'Configured Pathcost method used is short',
    '',
    'Name                   Blocking Listening Learning Forwarding STP Active',
    rule,
    ...counts.map((c) => row(vlanName(c.v), c.blk, c.fwd)),
    rule,
    row(`${counts.length} vlan${counts.length === 1 ? '' : 's'}`, blk, fwd),
  ];
}

/** `spanning-tree vlan N root primary`: 24576, or 4096 below the current root when that is already lower. */
export function rootPriority(sw: Switch, vlan: number, primary: boolean): number {
  if (!primary) return 28672;
  const s = sw.stpVlan(vlan);
  const rootBase = s ? s.root.priority - vlan : DEFAULT_BRIDGE_PRIORITY;
  const own = s && !s.rootPort;
  if (own) return Math.min(24576, rootBase);
  return rootBase > 24576 ? 24576 : Math.max(0, rootBase - 4096);
}
