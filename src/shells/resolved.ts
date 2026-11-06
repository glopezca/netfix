/**
 * systemd-resolved's runtime state of a host: the DNS server and domains set with `resolvectl dns|domain` (netplan does
 * not keep them) and its transaction counter. A real change of the device's IP settings (address, gateway, DNS,
 * netplan search list), as a new link setup in networkd, drops them; a DHCP renewal with the same lease does not.
 * `resolvectl revert` drops them too, with the LLMNR and mDNS set on each link. Beside them, what the daemon read of
 * resolved.conf when it started, and who asks and answers by LLMNR and mDNS on each link.
 */
import type { Host } from '../devices/host.ts';
import { RESOLVED_UNIT, pkgUnitState } from '../net/pkg-units.ts';
import { RESOLVED_DEFAULTS } from './resolved-conf.ts';
import type { ResolvedConf, ResolveSupport } from './resolved-conf.ts';
import { hasSystem } from '../net/device-apps.ts';

interface Override {
  /** The IP settings it was set over, by value. */
  readonly base: string;
  /** null: no server (resolvectl dns eth0 ""). */
  readonly dns?: number | null;
  readonly domains?: readonly string[];
  /** LLMNR and mDNS set per link with `resolvectl llmnr|mdns` (by link name). */
  readonly links?: ReadonlyMap<string, LinkSupport>;
}

export type Protocol = 'llmnr' | 'mdns';
type LinkSupport = Readonly<Partial<Record<Protocol, ResolveSupport>>>;

const overrides = new WeakMap<Host, Override>();
const transactions = new WeakMap<Host, number>();

const settings = (h: Host): string => JSON.stringify([h.config.mode, h.config.ip, h.config.prefix, h.config.gateway, h.config.dns, h.dnsSearch]);

function live(host: Host): Override | undefined {
  const o = overrides.get(host);
  if (o && o.base !== settings(host)) {
    overrides.delete(host);
    return undefined;
  }
  return o;
}

/** The DNS server the resolver uses: the one set with resolvectl (maybe none), else the device's. */
export function resolvedDns(host: Host): number | undefined {
  const o = live(host);
  return o && o.dns !== undefined ? o.dns ?? undefined : host.config.dns;
}

/** Domains set with resolvectl, or undefined to use the configured ones. */
export const resolvedDomains = (host: Host): readonly string[] | undefined => live(host)?.domains;

export function setResolvedDns(host: Host, dns: number | null): void {
  overrides.set(host, { ...live(host), base: settings(host), dns });
}

export function setResolvedDomains(host: Host, domains: readonly string[]): void {
  overrides.set(host, { ...live(host), base: settings(host), domains });
}

export function revertResolved(host: Host): void {
  overrides.delete(host);
}

const configs = new WeakMap<Host, ResolvedConf>();

/** What resolved read of resolved.conf when it last started (the host's boot, or a start or restart of the unit). */
export const resolvedConfig = (host: Host): ResolvedConf => configs.get(host) ?? RESOLVED_DEFAULTS;

export function setResolvedConfig(host: Host, conf: ResolvedConf): void {
  configs.set(host, conf);
}

/** What networkd asks of each link when its .network says nothing: LLMNR=yes, MulticastDNS=no. */
const LINK_DEFAULTS: Readonly<Record<Protocol, ResolveSupport>> = { llmnr: 'yes', mdns: 'no' };
const RANK: Readonly<Record<ResolveSupport, number>> = { no: 0, resolve: 1, yes: 2 };

/** The link's own value (resolvectl llmnr|mdns LINK). */
export const linkSupport = (host: Host, link: string, p: Protocol): ResolveSupport => live(host)?.links?.get(link)?.[p] ?? LINK_DEFAULTS[p];

export function setLinkSupport(host: Host, link: string, p: Protocol, value: ResolveSupport): void {
  const o = live(host);
  const links = new Map(o?.links);
  links.set(link, { ...links.get(link), [p]: value });
  overrides.set(host, { ...o, base: settings(host), links });
}

/**
 * What the link really does, as resolved: the lower of the global value (resolved.conf) and the link's own.
 * «resolve» asks but does not answer; «yes» asks and answers.
 */
export function effectiveSupport(host: Host, link: string, p: Protocol): ResolveSupport {
  const global = resolvedConfig(host)[p];
  const own = linkSupport(host, link, p);
  return RANK[global] <= RANK[own] ? global : own;
}

/** The unit runs (systemctl stop systemd-resolved silences it: no NSS answers, no LLMNR or mDNS). */
export const resolvedRunning = (host: Host): boolean => hasSystem(host, 'linux') && pkgUnitState(host, RESOLVED_UNIT).active;

/** resolved has a scope for the protocol on the link (asks there): it runs, and the link's support is not «no». */
export const resolvedAsks = (host: Host, link: string, p: Protocol): boolean => resolvedRunning(host) && effectiveSupport(host, link, p) !== 'no';

/** resolved answers for the host's name on a stack interface: it runs and the link's support is «yes». */
export const resolvedAnswers = (host: Host, iface: string, p: Protocol): boolean => resolvedRunning(host) && effectiveSupport(host, host.linuxIfName(iface), p) === 'yes';

export function countTransaction(host: Host): void {
  transactions.set(host, (transactions.get(host) ?? 0) + 1);
}

export const transactionCount = (host: Host): number => transactions.get(host) ?? 0;
