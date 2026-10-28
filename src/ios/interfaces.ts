/** Interface naming and configuration records (immutable). */
import type { IpWithPrefix } from '../core/ip.ts';

export const IFACE_TYPES = ['Loopback', 'Ethernet', 'FastEthernet', 'GigabitEthernet', 'Serial', 'Vlan'] as const;
export type IfaceType = (typeof IFACE_TYPES)[number];

const SHORT: Readonly<Record<IfaceType, string>> = {
  GigabitEthernet: 'Gig',
  FastEthernet: 'Fa',
  Ethernet: 'Eth',
  Serial: 'Se',
  Vlan: 'Vlan',
  Loopback: 'Lo',
};

export interface ParsedIfaceName {
  readonly type: IfaceType;
  readonly number: string;
  readonly full: string;
}

/** Parses "g0/0", "gig 0/0", "GigabitEthernet0/0.10", "vlan 1", "lo0". */
export function parseIfaceName(text: string): ParsedIfaceName | null {
  const m = /^([a-z]+)\s*([\d/.:]+)$/i.exec(text.trim());
  if (!m) return null;
  const prefix = (m[1] ?? '').toLowerCase();
  const number = m[2] ?? '';
  const candidates = IFACE_TYPES.filter((t) => t.toLowerCase().startsWith(prefix));
  const type = candidates.length === 1 ? candidates[0] : candidates.find((t) => t.toLowerCase() === prefix);
  if (!type || !/^\d+(\/\d+)*(\.\d+)?$/.test(number)) return null;
  return { type, number, full: `${type}${number}` };
}

export function shortIfaceName(full: string): string {
  const parsed = parseIfaceName(full);
  return parsed ? `${SHORT[parsed.type]}${parsed.number}` : full;
}

export function isSubinterface(full: string): boolean {
  return /\.\d+$/.test(full);
}

export function parentOf(full: string): string {
  return full.replace(/\.\d+$/, '');
}

export type SwitchportMode = 'access' | 'trunk' | 'dynamic auto';

export interface DhcpClientConfig {
  readonly clientIdIface?: string;
  readonly hostname?: string;
}

export interface IfaceConfig {
  readonly name: string;
  readonly description?: string;
  readonly shutdown: boolean;
  readonly address?: IpWithPrefix;
  readonly secondaries: readonly IpWithPrefix[];
  readonly dhcpClient?: DhcpClientConfig;
  readonly helpers: readonly number[];
  readonly encapsulationVlan?: number;
  readonly switchportMode: SwitchportMode;
  readonly accessVlan: number;
  readonly nativeVlan: number;
  /** `switchport trunk allowed vlan`: the VLANs a trunk carries (absent: all). */
  readonly trunkAllowed?: readonly number[];
  readonly speed?: string;
  readonly duplex?: string;
  readonly relayInfoTrusted: boolean;
  /** `ip directed-broadcast`: a directed broadcast for this subnet goes out as a link broadcast (off since IOS 12.0). */
  readonly directedBroadcast?: boolean;
  /** `ip nat inside` / `ip nat outside`. */
  readonly nat?: 'inside' | 'outside';
  /** `ip access-group ACL in|out`. */
  readonly accessIn?: string;
  readonly accessOut?: string;
  /** `crypto map NAME` (IPsec site-to-site). */
  readonly cryptoMap?: string;
  /** true for L2 switch ports (no IP processing). */
  readonly switchport: boolean;
}

export function defaultIface(name: string, opts: { shutdown: boolean; switchport: boolean }): IfaceConfig {
  return {
    name,
    shutdown: opts.shutdown,
    secondaries: [],
    helpers: [],
    switchportMode: 'dynamic auto',
    accessVlan: 1,
    nativeVlan: 1,
    relayInfoTrusted: false,
    switchport: opts.switchport,
  };
}

/** Sort key so that interfaces print in IOS order (type order, then numeric parts). */
export function ifaceSortKey(full: string): string {
  const parsed = parseIfaceName(full);
  if (!parsed) return full;
  const typeIdx = IFACE_TYPES.indexOf(parsed.type);
  const nums = parsed.number.split(/[/.:]/).map((n) => n.padStart(4, '0')).join('.');
  return `${typeIdx}-${nums}`;
}

export function compareIfaces(a: string, b: string): number {
  return ifaceSortKey(a).localeCompare(ifaceSortKey(b));
}
