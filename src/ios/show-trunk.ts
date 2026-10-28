/** `show interfaces trunk` of a 2960 (IOS 15): the trunks that are up and the VLANs each one carries (n-802.1q: by DTP). */
import type { Switch } from '../devices/switch.ts';
import { SWITCH_PORTS, DEFAULT_VLANS } from '../devices/switch-ports.ts';
import { vlanRanges, MAX_VLAN } from '../core/vlans.ts';
import { shortIfaceName } from './interfaces.ts';

const COL = 12;
const list = (ids: readonly number[]): string => (ids.length ? vlanRanges(ids) : 'none');

export function showInterfacesTrunk(sw: Switch): string[] {
  const trunks = SWITCH_PORTS.filter((p) => sw.isTrunk(p) && sw.ifaceRuntime(p).protocolUp);
  if (!trunks.length) return [];
  const rows = trunks.map((p) => {
    const cfg = sw.iface(p);
    const allowed = cfg?.trunkAllowed ?? Array.from({ length: MAX_VLAN }, (_, i) => i + 1);
    const active = allowed.filter((v) => sw.vlans.has(v) && (v === 1 || !DEFAULT_VLANS.has(v)));
    const forwarding = active.filter((v) => sw.stpVlan(v)?.ports.get(p)?.forwarding ?? true);
    const mode = cfg?.switchportMode === 'trunk' ? 'on' : 'auto';
    return { name: shortIfaceName(p).replace(/^Gig/, 'Gi'), mode, encap: mode === 'on' ? '802.1q' : 'n-802.1q', native: cfg?.nativeVlan ?? 1, allowed, active, forwarding };
  });
  const section = (title: string, pick: (r: (typeof rows)[number]) => readonly number[]): string[] =>
    ['', `${'Port'.padEnd(COL)}${title}`, ...rows.map((r) => `${r.name.padEnd(COL)}${list(pick(r))}`)];
  return [
    'Port        Mode             Encapsulation  Status        Native vlan',
    ...rows.map((r) => `${r.name.padEnd(COL)}${r.mode.padEnd(17)}${r.encap.padEnd(15)}${'trunking'.padEnd(14)}${r.native}`),
    ...section('Vlans allowed on trunk', (r) => r.allowed),
    ...section('Vlans allowed and active in management domain', (r) => r.active),
    ...section('Vlans in spanning tree forwarding state and not pruned', (r) => r.forwarding),
  ];
}
