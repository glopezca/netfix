/**
 * Caption under a device in the diagram: its name and, below, what identifies it on the network: the IP/CIDR of each
 * NIC with an address (PC, Server, Linux router), the IOS hostname when it is not the default one, the ISP of a cloud.
 * The host name of a PC is derived from its name, so it is not repeated.
 */
import type { Placed } from '../net/topology.ts';
import { formatIp } from '../core/ip.ts';

/** More would cover the devices below. */
const MAX_LINES = 3;
/** Height of each caption line below the device name. */
export const CAPTION_LINE = 14;
const IOS_DEFAULTS: ReadonlySet<string> = new Set(['Router', 'Switch']);

export interface DeviceCaption {
  readonly name: string;
  readonly extra: readonly string[];
}

function extraLines(p: Placed): string[] {
  const d = p.device;
  if (d.kind === 'cloud') return d.settings.isp && d.settings.isp !== p.label ? [d.settings.isp] : [];
  if (d.kind === 'router' || d.kind === 'switch') return IOS_DEFAULTS.has(d.hostname) || d.hostname === p.label ? [] : [d.hostname];
  return d.nics().flatMap((n) => (n.ip !== undefined && n.prefix !== undefined ? [`${formatIp(n.ip)}/${n.prefix}`] : []));
}

export function deviceCaption(p: Placed): DeviceCaption {
  return { name: p.label, extra: extraLines(p).slice(0, MAX_LINES) };
}
