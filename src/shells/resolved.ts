/**
 * systemd-resolved's runtime state of a host: the DNS server and domains set with `resolvectl dns|domain` (netplan does
 * not keep them) and its transaction counter. A real change of the device's IP settings (address, gateway, DNS,
 * netplan search list), as a new link setup in networkd, drops them; a DHCP renewal with the same lease does not.
 * `resolvectl revert` drops them too.
 */
import type { Host } from '../devices/host.ts';

interface Override {
  /** The IP settings it was set over, by value. */
  readonly base: string;
  /** null: no server (resolvectl dns eth0 ""). */
  readonly dns?: number | null;
  readonly domains?: readonly string[];
}

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

export function countTransaction(host: Host): void {
  transactions.set(host, (transactions.get(host) ?? 0) + 1);
}

export const transactionCount = (host: Host): number => transactions.get(host) ?? 0;
