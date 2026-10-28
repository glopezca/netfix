/** `show interfaces status` of a 2960 (IOS 15): one line per switch port. */
import type { Switch } from '../devices/switch.ts';
import { SWITCH_PORTS } from '../devices/switch-ports.ts';
import { shortIfaceName } from './interfaces.ts';

const MAX_NAME = 18;

function status(sw: Switch, port: string): string {
  if (sw.errDisabled.has(port)) return 'err-disabled';
  if (sw.iface(port)?.shutdown) return 'disabled';
  return sw.ifaceRuntime(port).linkUp ? 'connected' : 'notconnect';
}

export function showInterfacesStatus(sw: Switch): string[] {
  const rows = SWITCH_PORTS.map((port) => {
    const cfg = sw.iface(port);
    const gig = port.startsWith('Gigabit');
    const st = status(sw, port);
    const up = st === 'connected';
    const vlan = sw.isTrunk(port) ? 'trunk' : String(cfg?.accessVlan ?? 1);
    const duplex = up ? 'a-full' : 'auto';
    const speed = up ? (gig ? 'a-1000' : 'a-100') : 'auto';
    const name = (cfg?.description ?? '').slice(0, MAX_NAME);
    return `${shortIfaceName(port).replace(/^Gig/, 'Gi').padEnd(10)}${name.padEnd(19)}${st.padEnd(13)}${vlan.padEnd(11)}${duplex.padStart(6)} ${speed.padStart(6)} ${gig ? '10/100/1000BaseTX' : '10/100BaseTX'}`;
  });
  return ['', 'Port      Name               Status       Vlan       Duplex  Speed Type', ...rows];
}
