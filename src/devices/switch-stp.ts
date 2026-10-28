/** Spanning tree on one 2960: its bridge for the network computation, its ports' states, and BPDU guard. */
import type { DeviceHooks } from './hooks.ts';
import type { IfaceConfig } from '../ios/interfaces.ts';
import type { StpConfig } from './stp-config.ts';
import type { StpBridge, StpResult, StpVlan } from '../net/stp.ts';
import { forwardingKeys } from '../net/stp.ts';
import { PVST_MAC } from '../net/packets.ts';
import { SWITCH_PORTS, DEFAULT_VLANS } from './switch-ports.ts';

/** What spanning tree needs from the switch. */
export interface StpSwitch {
  readonly id: string;
  readonly baseMac: string;
  readonly hooks: DeviceHooks;
  readonly vlans: ReadonlyMap<number, string>;
  readonly macTable: Map<string, { readonly vlan: number }>;
  readonly stp: StpConfig;
  iface(name: string): IfaceConfig | undefined;
  portUp(port: string): boolean;
  isTrunk(port: string): boolean;
}

/** `switchport trunk allowed vlan`: whether a trunk carries this VLAN (all of them by default). */
export const allows = (cfg: IfaceConfig, vlan: number): boolean => cfg.trunkAllowed?.includes(vlan) ?? true;

export class SwitchStp {
  private readonly sw: StpSwitch;
  /** The last spanning tree seen, and the forwarding ports of each VLAN in the whole network then. */
  private seen: { readonly tree: StpResult; readonly keys: ReadonlyMap<number, string> } | undefined;

  constructor(sw: StpSwitch) {
    this.sw = sw;
  }

  bridge(): StpBridge {
    const sw = this.sw;
    const all = [...sw.vlans.keys()].filter((v) => v === 1 || !DEFAULT_VLANS.has(v));
    const ports = SWITCH_PORTS.flatMap((name, i) => {
      const cfg = sw.iface(name);
      if (!cfg || !sw.portUp(name)) return [];
      const vlans = sw.isTrunk(name) ? all.filter((v) => allows(cfg, v)) : sw.vlans.has(cfg.accessVlan) ? [cfg.accessVlan] : [];
      return [{ name, number: i + 1, cost: sw.stp.cost(name), priority: sw.stp.portPriority(name), edge: sw.stp.portfast.has(name), vlans }];
    });
    return { id: sw.id, mac: sw.baseMac, priority: (v) => sw.stp.priority(v), ports, rapid: sw.stp.mode === 'rapid-pvst' };
  }

  /**
   * The current spanning tree. When it changes, the VLANs whose forwarding ports changed anywhere lose their MAC
   * entries, as every switch does on a topology change notification.
   */
  sync(): StpResult | undefined {
    const tree = this.sw.hooks.stp?.();
    if (!tree || tree === this.seen?.tree) return tree;
    const keys = forwardingKeys(tree);
    const old = this.seen?.keys;
    if (old) for (const [k, e] of this.sw.macTable) if (keys.get(e.vlan) !== old.get(e.vlan)) this.sw.macTable.delete(k);
    this.seen = { tree, keys };
    return tree;
  }

  vlan(vlan: number): StpVlan | undefined {
    return this.sync()?.get(this.sw.id)?.get(vlan);
  }

  /** A port that blocks or listens in this VLAN neither learns nor forwards; one that learns does not forward yet. */
  forwards(port: string, vlan: number): boolean {
    return this.vlan(vlan)?.ports.get(port)?.forwarding ?? true;
  }

  learns(port: string, vlan: number): boolean {
    const state = this.vlan(vlan)?.ports.get(port)?.state;
    return state === undefined || state === 'FWD' || state === 'LRN';
  }

  /** The BPDUs of each VLAN out of the designated ports (tagged on a trunk except in its native VLAN). */
  hello(): void {
    const sw = this.sw;
    const tree = this.sync()?.get(sw.id);
    if (!tree) return;
    for (const [vlan, s] of tree) {
      for (const [port, p] of s.ports) {
        if (p.role !== 'Desg' || p.state === 'BLK') continue;
        const tagged = sw.isTrunk(port) && vlan !== (sw.iface(port)?.nativeVlan ?? 1);
        const bpdu = { vlan, rootPriority: s.root.priority, rootMac: s.root.mac, cost: s.cost, bridgePriority: s.bridge.priority, bridgeMac: s.bridge.mac, port: `${p.priority}.${p.number}` };
        sw.hooks.transmit(port, { src: sw.baseMac, dst: PVST_MAC, ...(tagged ? { vlan } : {}), bpdu });
      }
    }
  }

  /** The cable end shows amber: the port blocks in every VLAN it carries. */
  blocked(port: string): boolean {
    const tree = this.sync()?.get(this.sw.id);
    const states = tree ? [...tree.values()].map((s) => s.ports.get(port)).filter((p) => p !== undefined) : [];
    return states.length > 0 && states.every((p) => !p.forwarding);
  }

  /** BPDU guard on this port (its own, or `portfast bpduguard default` on a portfast port) and BPDUs reach it from a switch. */
  guardTrips(port: string): boolean {
    return this.sw.stp.guarded(port) && this.sw.portUp(port) && this.sw.hooks.peerKind?.(port) === 'switch';
  }
}

/** The console messages of a port that BPDU guard shuts down (IOS 15). */
export function bpduGuardLog(port: string, short: string): string[] {
  return [
    `%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${port} with BPDU Guard enabled. Disabling port.`,
    `%PM-4-ERR_DISABLE: bpduguard error detected on ${short}, putting ${short} in err-disable state`,
    `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${port}, changed state to down`,
    `%LINK-3-UPDOWN: Interface ${port}, changed state to down`,
  ];
}
