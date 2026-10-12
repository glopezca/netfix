/** Data types of the IOS DHCP server: bindings, conflicts, exclusions, request context and statistics counters. */
import type { IpWithPrefix } from '../core/ip.ts';
import type { DhcpMessage } from '../net/packets.ts';

export interface Binding {
  readonly ip: number;
  readonly pool: string;
  readonly clientId?: string;
  readonly mac: string;
  readonly type: 'Automatic' | 'Manual';
  /** null = infinite lease. */
  readonly expiresAt: number | null;
  readonly iface: string;
  readonly hostname?: string;
}

export interface Conflict {
  readonly ip: number;
  readonly method: 'Ping' | 'Gratuitous ARP';
  readonly detectedAt: number;
}

export interface ExcludedRange {
  readonly low: number;
  readonly high: number;
}

export interface ServerContext {
  readonly ifaceName: string;
  /** Addresses of the interface the request arrived on (primary first). */
  readonly ifaceAddrs: readonly IpWithPrefix[];
  /** Every address configured on the router: never handed out. */
  readonly ownIps: readonly number[];
  readonly now: number;
  ipInUse(ip: number): boolean;
  log(line: string): void;
  /** `ip dhcp relay information trusted` on the receiving interface. */
  readonly relayTrusted?: boolean;
}

export interface ServerReply {
  readonly msg: DhcpMessage;
  /** Where the router must send the reply. */
  readonly via: 'broadcast' | 'unicast' | 'relay';
}

export const RECEIVED = ['BOOTREQUEST', 'DHCPDISCOVER', 'DHCPREQUEST', 'DHCPDECLINE', 'DHCPRELEASE', 'DHCPINFORM'] as const;
export const SENT = ['BOOTREPLY', 'DHCPOFFER', 'DHCPACK', 'DHCPNAK'] as const;
export type ReceivedCounter = (typeof RECEIVED)[number];
export type SentCounter = (typeof SENT)[number];


export function zeroCounters<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}


export function bump<K extends string>(counters: Readonly<Record<K, number>>, key: NoInfer<K>): Record<K, number> {
  const next: Record<K, number> = { ...counters };
  next[key] = (counters[key] ?? 0) + 1;
  return next;
}
