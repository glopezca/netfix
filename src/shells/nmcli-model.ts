/** What nmcli shows of a host: device states, routes per device, and the overview of `nmcli` without arguments. */
import type { Host } from '../devices/host.ts';
import type { NicInfo } from '../devices/host-nics.ts';
import { formatIp } from '../core/ip.ts';
import { routeLines } from './linux-ip.ts';
import { configuredSearchDomains } from './net-tools.ts';

const FOOTER = 'Use "nmcli device show" to get complete information about known devices and\n"nmcli connection show" to get an overview on active connection profiles.\n\nConsult nmcli(1) and nmcli-examples(7) manual pages for complete usage details.';

export type NicState = 'connected' | 'unavailable' | 'disconnected';
type Field = readonly [label: string, value: string];
/** What a command prints: a table (header first) or blocks of fields. */
type Output = { readonly table: readonly (readonly string[])[] } | { readonly blocks: readonly (readonly Field[])[] };

export const stateOf = (n: NicInfo): NicState => (!n.adminUp ? 'disconnected' : n.up ? 'connected' : 'unavailable');
const STATE_CODE: Readonly<Record<NicState, string>> = { connected: '100 (connected)', unavailable: '20 (unavailable)', disconnected: '30 (disconnected)' };
export const nmMac = (m: string): string => (m.match(/../g) ?? []).join(':').toUpperCase();
export const conName = (n: NicInfo): string => `netplan-${n.linux}`;

/** The routes of a device, from `ip route`: [destination, next hop]. */
export function routesOf(host: Host, dev: string): [string, string][] {
  return routeLines(host).filter((l) => new RegExp(`(^| )dev ${dev}( |$)`).test(l)).map((l) => {
    const words = l.split(' ');
    const dst = words[0] === 'default' ? '0.0.0.0/0' : words[0] ?? '';
    return [dst, words[1] === 'via' ? words[2] ?? '0.0.0.0' : '0.0.0.0'];
  });
}

function overviewOf(host: Host, n: NicInfo): string[] {
  const s = stateOf(n);
  const head = s === 'connected' ? `${n.linux}: connected to ${conName(n)}` : `${n.linux}: ${s}`;
  const routes = routesOf(host, n.linux);
  const ip = n.ip !== undefined && s === 'connected' ? [
    ...(routes.some(([d]) => d === '0.0.0.0/0') ? ['\tip4 default'] : []), `\tinet4 ${formatIp(n.ip)}/${n.prefix ?? 32}`,
    ...routes.map(([d, via]) => (d === '0.0.0.0/0' ? `\troute4 default via ${via} metric 100` : `\troute4 ${d} metric 100`))] : [];
  return [head, '\t"Intel 82540EM"', `\tethernet (e1000), ${nmMac(n.mac)}, hw, mtu 1500`, ...ip, ''];
}

/** `nmcli` without arguments: each device, lo, the DNS configuration and the hint. */
export function nmcliOverview(host: Host): string {
  const nics = host.nics();
  const lo = ['lo: connected (externally) to lo', '\t"lo"', '\tloopback (unknown), 00:00:00:00:00:00, sw, mtu 65536', '\tinet4 127.0.0.1/8', '\tinet6 ::1/128', '\troute6 ::1/128 metric 256', ''];
  const search = configuredSearchDomains(host);
  const dns = host.config.dns === undefined ? [] : ['DNS configuration:', `\tservers: ${formatIp(host.config.dns)}`,
    ...(search.length ? [`\tdomains: ${search.join(' ')}`] : []), `\tinterface: ${nics[0]?.linux ?? 'eth0'}`, ''];
  return [...nics.flatMap((n) => overviewOf(host, n)), ...lo, ...dns, FOOTER].join('\n');
}
