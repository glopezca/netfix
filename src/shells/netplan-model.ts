/**
 * netplan documents ⇄ the running network configuration of a host with one or more NICs: addresses or
 * DHCP per ethernet, the default route, routes to networks and the DNS server of the first NIC.
 */
import type { Host } from '../devices/host.ts';
import type { StaticRoute } from '../devices/host-nics.ts';
import { routeTo } from '../devices/host-nics.ts';
import type { YamlMap, YamlValue } from '../core/yaml-lite.ts';
import { formatIp, inSubnet, parseIp } from '../core/ip.ts';

const ETH_KEYS = new Set(['dhcp4', 'dhcp6', 'addresses', 'routes', 'gateway4', 'nameservers', 'optional', 'match', 'set-name', 'mtu', 'macaddress', 'renderer', 'link-local']);

export interface NicWanted {
  readonly dhcp: boolean;
  readonly ip?: number;
  readonly prefix?: number;
}

export interface Wanted {
  /** By Linux interface name. */
  readonly nics: Readonly<Record<string, NicWanted>>;
  readonly gateway?: number;
  readonly dns?: number;
  readonly routes: readonly StaticRoute[];
  /** nameservers.search of the interfaces, in order and without repeats. */
  readonly search: readonly string[];
}

/** Up to 6 search domains, as glibc's resolver (MAXDNSRCH). */
const MAX_SEARCH = 6;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;

/** Valid search domains (lower case, no final dot), or the first invalid one. */
export function searchList(values: readonly unknown[]): { ok: string[] } | { bad: string } {
  const out: string[] = [];
  for (const v of values.slice(0, MAX_SEARCH * 4)) {
    if (out.length >= MAX_SEARCH) break;
    if (typeof v !== 'string' || !DOMAIN_RE.test(v)) return { bad: String(v).slice(0, 80) };
    const d = v.toLowerCase().replace(/\.$/, '');
    if (!out.includes(d)) out.push(d);
  }
  return { ok: out.slice(0, MAX_SEARCH) };
}

/** The configuration a host is running now. */
export function currentWanted(host: Host): Wanted {
  const nics: Record<string, NicWanted> = {};
  for (const n of host.nics()) nics[n.linux] = n.dhcp ? { dhcp: true } : { dhcp: false, ip: n.ip, prefix: n.prefix };
  const c = host.config;
  return { nics, gateway: c.mode === 'dhcp' ? undefined : c.gateway, dns: c.mode === 'dhcp' ? undefined : c.dns, routes: host.staticRoutes, search: host.dnsSearch };
}

/** The nameservers block of the first interface (addresses and search). */
function nameservers(w: Wanted, dhcp: boolean): string {
  const lines = [...(!dhcp && w.dns !== undefined ? [`        addresses: [${formatIp(w.dns)}]`] : []), ...(w.search.length ? [`        search: [${w.search.join(', ')}]`] : [])];
  return lines.length ? `\n      nameservers:\n${lines.join('\n')}` : '';
}

function nicBlock(name: string, n: NicWanted, w: Wanted, first: boolean, inNic: (gw: number) => boolean): string {
  if (n.dhcp) return `    ${name}:\n      dhcp4: true${first ? nameservers(w, true) : ''}\n`;
  const addr = n.ip !== undefined && n.prefix !== undefined ? `\n      addresses:\n        - ${formatIp(n.ip)}/${n.prefix}` : '';
  const routes = [
    ...(w.gateway !== undefined && inNic(w.gateway) ? [`        - to: default\n          via: ${formatIp(w.gateway)}`] : []),
    ...w.routes.filter((r) => inNic(r.via)).map((r) => `        - to: ${formatIp(r.net)}/${r.prefix}\n          via: ${formatIp(r.via)}`),
  ];
  const rt = routes.length ? `\n      routes:\n${routes.join('\n')}` : '';
  const dns = first ? nameservers(w, false) : '';
  return `    ${name}:\n      dhcp4: false${addr}${rt}${dns}\n`;
}

/** The canonical file for a configuration (what cloud-init would write). */
export function generatedNetplan(w: Wanted): string {
  const names = Object.keys(w.nics);
  const blocks = names.map((name, i) => {
    const n = w.nics[name] as NicWanted;
    const owner = (gw: number): string | undefined => names.find((x) => { const m = w.nics[x]; return m?.ip !== undefined && m.prefix !== undefined && inSubnet(gw, m.ip, m.prefix); }) ?? names[0];
    return nicBlock(name, n, w, i === 0, (gw) => owner(gw) === name);
  });
  return `network:\n  version: 2\n  ethernets:\n${blocks.join('')}`;
}

const map = (v: YamlValue | undefined): YamlMap | undefined => (v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
const list = (v: YamlValue | undefined): YamlValue[] => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [v]);
const truthy = (v: YamlValue | undefined): boolean | null => (v === undefined ? false : typeof v !== 'string' ? null : /^(true|yes|on)$/i.test(v) ? true : /^(false|no|off)$/i.test(v) ? false : null);

/** Merges netplan documents: mappings key by key, sequences appended, scalars replaced. */
export function mergeNetplan(a: YamlMap, b: YamlMap): YamlMap {
  const out: Record<string, YamlValue> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    const pm = map(prev);
    const vm = map(v);
    out[k] = pm && vm ? mergeNetplan(pm, vm) : Array.isArray(prev) && Array.isArray(v) ? [...prev, ...v] : v;
  }
  return out;
}

function cidr(text: YamlValue): { ip: number; prefix: number } | null {
  const m = typeof text === 'string' ? /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(text) : null;
  const ip = m ? parseIp(m[1] ?? '') : null;
  return ip === null || Number(m?.[2]) > 32 ? null : { ip, prefix: Number(m?.[2]) };
}

interface Routes {
  gateway?: number;
  routes: StaticRoute[];
  error?: string;
}

function routesOf(eth: YamlMap, acc: Routes): void {
  for (const r of list(eth.routes)) {
    const rm = map(r);
    if (!rm) { acc.error = 'expected mapping (routes)'; return; }
    const gw = typeof rm.via === 'string' ? parseIp(rm.via) : null;
    if (gw === null) { acc.error = `invalid IPv4 address '${String(rm.via)}'`; return; }
    if (rm.to === 'default' || rm.to === '0.0.0.0/0') { acc.gateway = gw; continue; }
    const to = cidr(rm.to ?? '');
    if (!to) { acc.error = `invalid IP family '${String(rm.to)}'`; return; }
    acc.routes.push(routeTo(to.ip, to.prefix, gw));
  }
  if (typeof eth.gateway4 === 'string') acc.gateway = parseIp(eth.gateway4) ?? acc.gateway;
}

function nicOf(name: string, eth: YamlMap): NicWanted | { error: string } {
  const unknown = Object.keys(eth).find((k) => !ETH_KEYS.has(k));
  if (unknown) return { error: `Error in network definition: unknown key '${unknown}'` };
  const dhcp = truthy(eth.dhcp4);
  if (dhcp === null) return { error: `Error in network definition: invalid boolean value '${String(eth.dhcp4)}'` };
  if (dhcp) return { dhcp: true };
  const addrs = list(eth.addresses).map(cidr);
  if (addrs.some((a) => a === null)) return { error: `Error in network definition: malformed address '${String(list(eth.addresses)[addrs.indexOf(null)])}', must be X.X.X.X/NN or X:X:X:X:X:X:X:X/NN` };
  if (addrs.length > 1) return { error: `Netfix: one IPv4 address per interface (${name} has ${addrs.length})` };
  return { dhcp: false, ip: addrs[0]?.ip, prefix: addrs[0]?.prefix };
}

/** The configuration of the host's NICs in a merged document, an error, plus deprecation warnings. */
export function interpretNetplan(doc: YamlMap, nicNames: readonly string[]): { wanted: Wanted; warnings: string[] } | { error: string } {
  const net = map(doc.network);
  if (!net) return { error: 'Error in network definition: expected mapping (check indentation)' };
  if (net.version !== undefined && net.version !== '2') return { error: `Error in network definition: Only version 2 is supported` };
  const eths = map(net.ethernets) ?? {};
  const nics: Record<string, NicWanted> = {};
  const acc: Routes = { routes: [] };
  const warnings: string[] = [];
  let dns: number | undefined;
  const search: unknown[] = [];
  for (const name of nicNames) {
    const eth = map(eths[name]);
    if (!eth) { nics[name] = { dhcp: false }; continue; }
    const n = nicOf(name, eth);
    if ('error' in n) return n;
    if (n.dhcp && name !== nicNames[0]) return { error: `Netfix: dhcp4 only on ${nicNames[0] ?? 'eth0'} (the WAN); use addresses on ${name}` };
    nics[name] = n;
    if (eth.gateway4 !== undefined) warnings.push('`gateway4` has been deprecated, use default routes instead.\nSee the \'Default routes\' section of the documentation for more details.');
    if (!n.dhcp) routesOf(eth, acc);
    if (acc.error) return { error: `Error in network definition: ${acc.error}` };
    search.push(...list(map(eth.nameservers)?.search));
    const dnsText = list(map(eth.nameservers)?.addresses)[0];
    if (dns === undefined && typeof dnsText === 'string') dns = parseIp(dnsText) ?? undefined;
  }
  const domains = searchList(search);
  if ('bad' in domains) return { error: `Error in network definition: invalid search domain '${domains.bad}'` };
  return { wanted: { nics, gateway: acc.gateway, dns, routes: acc.routes, search: domains.ok }, warnings };
}

export function sameWanted(a: Wanted, b: Wanted): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
