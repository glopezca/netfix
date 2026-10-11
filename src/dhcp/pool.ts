/** DHCP pool configuration (immutable records) and pure helpers. */
import type { IpWithPrefix } from '../core/ip.ts';
import { inSubnet, classfulPrefix, networkOf, broadcastOf } from '../core/ip.ts';

export interface Reservation {
  readonly ip: number;
  /** Lowercase hex client identifier, when reserved by `client-id`. */
  readonly clientId?: string;
  /** Original text typed after `client-id … ascii`. */
  readonly asciiText?: string;
  /** MAC (12 hex chars), when reserved by `hardware-address`. */
  readonly mac?: string;
  readonly hwType?: string;
  /** Server-PT (Kea `hw-address`): the MAC matches whatever option 61 the client sends. */
  readonly macAlways?: boolean;
}

export interface PoolOption {
  readonly code: number;
  readonly instance?: number;
  readonly kind: 'ascii' | 'hex' | 'ip';
  readonly value: string;
  readonly ips?: readonly number[];
}

export interface PoolClass {
  readonly name: string;
  readonly ranges: readonly { readonly start: number; readonly end: number }[];
}

export type Lease = { readonly days: number; readonly hours: number; readonly minutes: number } | 'infinite';

export interface UtilizationMark {
  readonly percent: number;
  readonly log: boolean;
}

export interface PoolConfig {
  readonly name: string;
  readonly network?: IpWithPrefix;
  readonly secondaryNetworks: readonly IpWithPrefix[];
  readonly host?: IpWithPrefix;
  readonly clientIdentifier?: string;
  readonly hardwareAddress?: { readonly mac: string; readonly type?: string };
  readonly clientName?: string;
  readonly reservations: readonly Reservation[];
  /** false = automatic bindings are recognised by MAC only (Server-PT, Kea `match-client-id: false`). */
  readonly matchClientId?: boolean;
  readonly reservedOnly: boolean;
  readonly defaultRouters: readonly number[];
  readonly dnsServers: readonly number[];
  readonly domainName?: string;
  readonly netbiosServers: readonly number[];
  readonly netbiosNodeType?: string;
  readonly lease?: Lease;
  readonly options: readonly PoolOption[];
  readonly bootfile?: string;
  readonly nextServers: readonly number[];
  readonly classes: readonly PoolClass[];
  readonly origin?: string;
  readonly importAll: boolean;
  readonly updateArp: boolean;
  readonly renewDenyUnknown: boolean;
  readonly utilizationHigh?: UtilizationMark;
  readonly utilizationLow?: UtilizationMark;
  readonly subnetPrefixLength?: number;
  readonly vrf?: string;
  readonly accounting?: string;
  readonly relaySources: readonly IpWithPrefix[];
  readonly relayDestinations: readonly number[];
}

export function newPool(name: string): PoolConfig {
  return {
    name,
    secondaryNetworks: [],
    reservations: [],
    reservedOnly: false,
    defaultRouters: [],
    dnsServers: [],
    netbiosServers: [],
    options: [],
    nextServers: [],
    classes: [],
    importAll: false,
    updateArp: false,
    renewDenyUnknown: false,
    relaySources: [],
    relayDestinations: [],
  };
}

export const DEFAULT_LEASE_SECONDS = 86400;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
export const INFINITE_LEASE = 0xffffffff;

export function leaseSeconds(lease: Lease | undefined): number {
  if (lease === undefined) return DEFAULT_LEASE_SECONDS;
  if (lease === 'infinite') return INFINITE_LEASE;
  return lease.days * SECONDS_PER_DAY + lease.hours * SECONDS_PER_HOUR + lease.minutes * SECONDS_PER_MINUTE;
}

export function isHostPool(pool: PoolConfig): boolean {
  return pool.host !== undefined;
}

/** Prefix of the subnet mask handed out to manual-binding clients. */
export function hostPrefix(pool: PoolConfig): number | undefined {
  return pool.host ? pool.host.prefix : undefined;
}

/** All networks served by a pool (primary first). */
export function poolNetworks(pool: PoolConfig): IpWithPrefix[] {
  return pool.network ? [pool.network, ...pool.secondaryNetworks] : [];
}

export function poolContains(pool: PoolConfig, ip: number): boolean {
  return poolNetworks(pool).some((n) => inSubnet(ip, n.ip, n.prefix));
}

/** Address range (first usable .. last usable) of a network. */
export function usableRange(net: IpWithPrefix): { first: number; last: number } {
  const network = networkOf(net.ip, net.prefix);
  if (net.prefix >= 31) return { first: network, last: broadcastOf(net.ip, net.prefix) };
  return { first: network + 1, last: broadcastOf(net.ip, net.prefix) - 1 };
}

export function totalAddresses(pool: PoolConfig): number {
  if (pool.host) return 1;
  return poolNetworks(pool).reduce((n, net) => {
    const r = usableRange(net);
    return n + (r.last - r.first + 1);
  }, 0);
}

type Inheritable = Pick<PoolConfig,
  'defaultRouters' | 'dnsServers' | 'domainName' | 'netbiosServers' | 'netbiosNodeType' | 'lease' | 'options' | 'bootfile' | 'nextServers'>;

/** The address a pool is "about", used to find its parent pools. */
function anchor(pool: PoolConfig): IpWithPrefix | undefined {
  return pool.host ?? pool.network;
}

/**
 * IOS pool inheritance: a pool inherits any parameter it does not set from pools whose
 * network contains it (host pools from their network pool, subnets from supernets).
 */
export function effectiveParams(pool: PoolConfig, all: readonly PoolConfig[]): Inheritable {
  const own = anchor(pool);
  const parents = own
    ? all
      .filter((p) => p !== pool && p.network && p.network.prefix < (pool.host ? 33 : own.prefix) && inSubnet(own.ip, p.network.ip, p.network.prefix))
      .sort((a, b) => (b.network?.prefix ?? 0) - (a.network?.prefix ?? 0))
    : [];
  const chain = [pool, ...parents];
  const pickArr = <K extends 'defaultRouters' | 'dnsServers' | 'netbiosServers' | 'nextServers'>(k: K): PoolConfig[K] =>
    chain.find((p) => p[k].length > 0)?.[k] ?? pool[k];
  const pick = <K extends 'domainName' | 'netbiosNodeType' | 'lease' | 'bootfile'>(k: K): PoolConfig[K] =>
    chain.find((p) => p[k] !== undefined)?.[k];
  const codes = new Map<number, PoolOption>();
  for (const p of [...chain].reverse()) for (const o of p.options) codes.set(o.code, o);
  return {
    defaultRouters: pickArr('defaultRouters'),
    dnsServers: pickArr('dnsServers'),
    netbiosServers: pickArr('netbiosServers'),
    nextServers: pickArr('nextServers'),
    domainName: pick('domainName'),
    netbiosNodeType: pick('netbiosNodeType'),
    lease: pick('lease'),
    bootfile: pick('bootfile'),
    options: [...codes.values()],
  };
}

/** Subnet prefix for a host pool when the mask was omitted (classful, like IOS). */
export function defaultHostPrefix(ip: number): number {
  return classfulPrefix(ip);
}

export const NETBIOS_NODE_TYPES: Readonly<Record<string, number>> = { 'b-node': 1, 'p-node': 2, 'm-node': 4, 'h-node': 8 };
