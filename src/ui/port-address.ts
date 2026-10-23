/**
 * The address shown under an interface's name at the end of its cable: IP/CIDR of a PC, Server or Linux router NIC,
 * of an IOS interface (also learnt by DHCP; for a trunk to a router on a stick, its subinterfaces) or of an ISP cloud
 * line (the operator router's LAN, or the line's gateway when it is public).
 */
import type { Placed } from '../net/topology.ts';
import { formatIp } from '../core/ip.ts';
import { isSubinterface, parentOf } from '../ios/interfaces.ts';
import { effectiveAddress } from '../ios/commands/show-iface.ts';
import { LINE_PREFIX } from '../devices/cloud-config.ts';

/** More would stack too far along the cable. */
const MAX_ADDRESSES = 3;

const cidr = (ip: number | undefined, prefix: number | undefined): string[] => (ip !== undefined && prefix !== undefined ? [`${formatIp(ip)}/${prefix}`] : []);

function iosAddresses(d: Extract<Placed['device'], { kind: 'router' | 'switch' }>, port: string): string[] {
  const own = d.iface(port);
  const mine = own && !own.switchport ? (() => { const a = effectiveAddress(d, own); return cidr(a.ip, a.prefix); })() : [];
  if (mine.length) return mine;
  return d.sortedIfaceNames().filter((n) => isSubinterface(n) && parentOf(n) === port).flatMap((n) => {
    const cfg = d.iface(n);
    if (!cfg) return [];
    const a = effectiveAddress(d, cfg);
    return cidr(a.ip, a.prefix);
  });
}

export function portAddresses(p: Placed, port: string): string[] {
  const d = p.device;
  let list: string[];
  if (d.kind === 'router' || d.kind === 'switch') list = iosAddresses(d, port);
  else if (d.kind === 'cloud') {
    const line = d.lines.get(port as Parameters<typeof d.lines.get>[0]);
    list = !line ? [] : line.settings.mode === 'router' ? cidr(line.settings.lanIp, line.settings.lanPrefix) : cidr(line.line().gw, LINE_PREFIX);
  } else {
    const nic = d.nics().find((n) => n.port === port);
    list = cidr(nic?.ip, nic?.prefix);
  }
  return list.slice(0, MAX_ADDRESSES);
}
