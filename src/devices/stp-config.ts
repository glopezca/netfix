/** Spanning tree configuration of a 2960 (PVST+): mode, bridge priority per VLAN and port settings. */

import { vlanRanges } from '../core/vlans.ts';

export const DEFAULT_BRIDGE_PRIORITY = 32768;
export const DEFAULT_PORT_PRIORITY = 128;
export const BRIDGE_PRIORITY_STEP = 4096;
export const PORT_PRIORITY_STEP = 16;
/** Short path costs (IEEE 802.1D-1998), the 2960 default. */
const COST_FAST = 19;
const COST_GIGABIT = 4;

export type StpMode = 'pvst' | 'rapid-pvst';


export class StpConfig {
  mode: StpMode = 'pvst';
  /** Configured bridge priority by VLAN (only the ones changed). */
  priorities = new Map<number, number>();
  /** `no spanning-tree vlan N`. */
  disabled = new Set<number>();
  costs = new Map<string, number>();
  portPriorities = new Map<string, number>();
  portfast = new Set<string>();
  bpduguard = new Set<string>();

  reset(): void {
    this.mode = 'pvst';
    this.priorities = new Map();
    this.disabled = new Set();
    this.costs = new Map();
    this.portPriorities = new Map();
    this.portfast = new Set();
    this.bpduguard = new Set();
  }

  priority(vlan: number): number | null {
    return this.disabled.has(vlan) ? null : this.priorities.get(vlan) ?? DEFAULT_BRIDGE_PRIORITY;
  }

  cost(port: string): number {
    return this.costs.get(port) ?? (port.startsWith('Gigabit') ? COST_GIGABIT : COST_FAST);
  }

  portPriority(port: string): number {
    return this.portPriorities.get(port) ?? DEFAULT_PORT_PRIORITY;
  }

  /** Global lines of the running-config, after `spanning-tree mode`. */
  configLines(): string[] {
    const byPriority = new Map<number, number[]>();
    for (const [vlan, p] of this.priorities) byPriority.set(p, [...(byPriority.get(p) ?? []), vlan]);
    return [
      `spanning-tree mode ${this.mode}`,
      'spanning-tree extend system-id',
      ...(this.disabled.size ? [`no spanning-tree vlan ${vlanRanges([...this.disabled])}`] : []),
      ...[...byPriority].sort((a, b) => Math.min(...a[1]) - Math.min(...b[1])).map(([p, vlans]) => `spanning-tree vlan ${vlanRanges(vlans)} priority ${p}`),
    ];
  }

  ifaceLines(port: string): string[] {
    const cost = this.costs.get(port);
    const prio = this.portPriorities.get(port);
    return [
      ...(prio !== undefined ? [` spanning-tree port-priority ${prio}`] : []),
      ...(cost !== undefined ? [` spanning-tree cost ${cost}`] : []),
      ...(this.portfast.has(port) ? [' spanning-tree portfast'] : []),
      ...(this.bpduguard.has(port) ? [' spanning-tree bpduguard enable'] : []),
    ];
  }
}
