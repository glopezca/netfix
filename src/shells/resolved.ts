/**
 * systemd-resolved's runtime state of a host: the DNS server and domains set with `resolvectl dns|domain` (netplan does
 * not keep them) and its transaction counter. A change of the device's IP configuration, as a new link setup in
 * networkd, drops them; `resolvectl revert` too.
 */
import type { Host } from '../devices/host.ts';

interface Override {
  /** The IP configuration it was set over: when the device gets another one, the override is gone. */
  readonly base: Host['config'];
  readonly dns?: number;
  readonly domains?: readonly string[];
}

const overrides = new WeakMap<Host, Override>();
const transactions = new WeakMap<Host, number>();

function live(host: Host): Override | undefined {
  const o = overrides.get(host);
  if (o && o.base !== host.config) {
    overrides.delete(host);
    return undefined;
  }
  return o;
}

/** The DNS server the resolver uses: the one set with resolvectl, else the device's. */
export const resolvedDns = (host: Host): number | undefined => live(host)?.dns ?? host.config.dns;

/** Domains set with resolvectl, or undefined to use the configured ones. */
export const resolvedDomains = (host: Host): readonly string[] | undefined => live(host)?.domains;

export function setResolvedDns(host: Host, dns: number): void {
  overrides.set(host, { ...live(host), base: host.config, dns });
}

export function setResolvedDomains(host: Host, domains: readonly string[]): void {
  overrides.set(host, { ...live(host), base: host.config, domains });
}

export function revertResolved(host: Host): void {
  overrides.delete(host);
}

export function countTransaction(host: Host): void {
  transactions.set(host, (transactions.get(host) ?? 0) + 1);
}

export const transactionCount = (host: Host): number => transactions.get(host) ?? 0;
