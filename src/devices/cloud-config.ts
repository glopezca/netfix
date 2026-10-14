/**
 * Settings of the ISP cloud: each port is a customer line (cable, xDSL or FTTx) that either hands a
 * public /29 to the customer's router (DHCP) or acts as the operator's router (LAN, DHCP, NAT, port
 * forwarding). Domains registered at the ISP are published by the public DNS servers 8.8.8.8/8.8.4.4.
 */
import { t } from '../i18n/t.ts';
import { formatIp, inSubnet, networkOf, parseIp } from '../core/ip.ts';

export const CLOUD_PORTS = ['Coaxial0', 'Coaxial1', 'DSL0', 'DSL1', 'Fibra0', 'Fibra1'] as const;
export type CloudPortName = (typeof CLOUD_PORTS)[number];
export type AccessType = 'cable' | 'xdsl' | 'fttx';
export type LineMode = 'public' | 'router';

export interface PortForward {
  readonly proto: 'tcp' | 'udp';
  readonly port: number;
  readonly ip: number;
  readonly toPort: number;
}

export interface CloudPortSettings {
  readonly mode: LineMode;
  /** Contracted speeds in Mbit/s (informative). */
  readonly down: number;
  readonly up: number;
  /** Operator router: LAN address of the router and prefix. */
  readonly lanIp: number;
  readonly lanPrefix: number;
  readonly forwards: readonly PortForward[];
  /** Router mode: the gateway is the customers' DNS and relays to Google (dnsmasq-style). */
  readonly dnsRelay?: boolean;
}

export interface CloudDomain {
  /** Registered domain (e.g. sede2.es). */
  readonly name: string;
  /** a: the DNS publishes name and *.name → ip; ns: delegated to the DNS server at ip. */
  readonly kind: 'a' | 'ns';
  readonly ip: number;
}

export interface CloudSettings {
  readonly isp: string;
  /** Public /16 of the ISP: port i uses x.y.(i+1).0/29. */
  readonly block: number;
  readonly ports: Readonly<Record<CloudPortName, CloudPortSettings>>;
  readonly domains: readonly CloudDomain[];
}

export const BLOCK_PREFIX = 16;
export const LINE_PREFIX = 29;
const LAN_DEFAULT = parseIp('192.168.1.1') ?? 0;
const LAN_PREFIX = 24;
const MAX_FORWARDS = 32;
const MAX_DOMAINS = 32;
const MAX_SPEED = 100_000;

export function accessOf(port: string): AccessType {
  if (port.startsWith('Coaxial')) return 'cable';
  if (port.startsWith('DSL')) return 'xdsl';
  return 'fttx';
}

export const ACCESS_LABEL: Readonly<Record<AccessType, string>> = { cable: 'Cable (DOCSIS 3.1)', xdsl: 'xDSL (VDSL2)', fttx: 'FTTH (GPON)' };
const SPEEDS: Readonly<Record<AccessType, readonly [number, number]>> = { cable: [600, 60], xdsl: [100, 10], fttx: [1000, 1000] };

export function defaultPort(port: string): CloudPortSettings {
  const [down, up] = SPEEDS[accessOf(port)];
  return { mode: 'router', down, up, lanIp: LAN_DEFAULT, lanPrefix: LAN_PREFIX, forwards: [] };
}

export function defaultCloud(isp: string, block: number): CloudSettings {
  const ports = Object.fromEntries(CLOUD_PORTS.map((p) => [p, defaultPort(p)])) as Record<CloudPortName, CloudPortSettings>;
  return { isp, block, ports, domains: [] };
}

/** Customer /29 of a port: network, gateway (.1) and first customer address (.2). */
export function lineSubnet(block: number, port: string): { net: number; gw: number; customer: number } {
  const i = Math.max(0, CLOUD_PORTS.indexOf(port as CloudPortName));
  const net = (block + (i + 1) * 256) >>> 0;
  return { net, gw: net + 1, customer: net + 2 };
}

/** The ISP's own router in the core: x.y.0.1. */
export function ispHop(block: number): number {
  return (block + 1) >>> 0;
}

/** Ranges a cloud cannot use as public block or delegate a domain to (private, special, emulated Internet). */
const RESERVED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.168.0.0', 16], ['224.0.0.0', 3], ['8.8.0.0', 16], ['34.160.0.0', 16], ['93.184.0.0', 16], ['142.250.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24],
];

export function reservedAddress(ip: number): boolean {
  return RESERVED.some(([net, prefix]) => inSubnet(ip, parseIp(net) ?? 0, prefix));
}

export function validDomain(name: string): string | null {
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) return t('cloud.err.domain');
  return null;
}

export function validatePort(p: CloudPortSettings): string | null {
  if (!Number.isInteger(p.down) || !Number.isInteger(p.up) || p.down < 1 || p.up < 1 || p.down > MAX_SPEED || p.up > MAX_SPEED) return t('cloud.err.speed');
  if (p.lanPrefix < 8 || p.lanPrefix > 30) return t('cloud.err.lanMask');
  const net = networkOf(p.lanIp, p.lanPrefix);
  if (p.lanIp === net || p.lanIp === (net | (0xffffffff >>> p.lanPrefix)) >>> 0) return t('cloud.err.lanIp');
  if (p.forwards.length > MAX_FORWARDS) return t('cloud.err.forwards');
  for (const f of p.forwards) {
    if (![f.port, f.toPort].every((n) => Number.isInteger(n) && n >= 1 && n <= 65535)) return t('cloud.err.ports');
    if (!inSubnet(f.ip, p.lanIp, p.lanPrefix) || f.ip === p.lanIp) return t('cloud.err.forwardLan', { ip: formatIp(f.ip) });
  }
  const dup = p.forwards.find((f, i) => p.forwards.findIndex((g) => g.proto === f.proto && g.port === f.port) !== i);
  return dup ? `El puerto ${dup.proto.toUpperCase()} ${dup.port} ya está redirigido.` : null;
}

export function validateCloud(s: CloudSettings, otherBlocks: readonly number[] = []): string | null {
  if (!s.isp.trim() || s.isp.length > 40) return t('cloud.err.isp');
  if (networkOf(s.block, BLOCK_PREFIX) !== s.block) return t('cloud.err.block');
  if (reservedAddress(s.block)) return t('cloud.err.reserved', { net: formatIp(s.block) });
  if (otherBlocks.includes(s.block)) return t('cloud.err.used', { net: formatIp(s.block) });
  if (s.domains.length > MAX_DOMAINS) return t('cloud.err.domains');
  for (const d of s.domains) {
    const bad = validDomain(d.name);
    if (bad) return bad;
    if (reservedAddress(d.ip)) return t('cloud.err.domainIp', { name: d.name, ip: formatIp(d.ip) });
  }
  for (const p of CLOUD_PORTS) {
    const bad = validatePort(s.ports[p]);
    if (bad) return `${p}: ${bad}`;
  }
  return null;
}

// ------------------------------------------------------------ JSON

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ipOf = (v: unknown, d: number): number => (typeof v === 'string' ? parseIp(v) ?? d : d);
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? v as Record<string, unknown> : {});

export function cloudToJson(s: CloudSettings): unknown {
  const ports = Object.fromEntries(CLOUD_PORTS.map((p) => {
    const c = s.ports[p];
    return [p, { mode: c.mode, down: c.down, up: c.up, lanIp: formatIp(c.lanIp), lanPrefix: c.lanPrefix, forwards: c.forwards.map((f) => ({ ...f, ip: formatIp(f.ip) })), ...(c.dnsRelay ? { dnsRelay: true } : {}) }];
  }));
  return { isp: s.isp, block: formatIp(s.block), ports, domains: s.domains.map((d) => ({ ...d, ip: formatIp(d.ip) })) };
}

function portFromJson(port: string, v: unknown): CloudPortSettings {
  const d = defaultPort(port);
  const o = obj(v);
  const forwards = (Array.isArray(o.forwards) ? o.forwards : []).slice(0, MAX_FORWARDS).map(obj).map((f) => ({
    proto: f.proto === 'udp' ? 'udp' as const : 'tcp' as const, port: num(f.port, 0), ip: ipOf(f.ip, 0), toPort: num(f.toPort, 0),
  }));
  const p = { mode: o.mode === 'public' ? 'public' as const : 'router' as const, down: num(o.down, d.down), up: num(o.up, d.up), lanIp: ipOf(o.lanIp, d.lanIp), lanPrefix: num(o.lanPrefix, d.lanPrefix), forwards, ...(o.dnsRelay === true ? { dnsRelay: true } : {}) };
  return validatePort(p) ? d : p;
}

/** Settings from an untrusted file; anything invalid falls back to the defaults. */
export function cloudFromJson(v: unknown, fallback: CloudSettings): CloudSettings {
  const o = obj(v);
  const ports = Object.fromEntries(CLOUD_PORTS.map((p) => [p, portFromJson(p, obj(o.ports)[p])])) as Record<CloudPortName, CloudPortSettings>;
  const domains = (Array.isArray(o.domains) ? o.domains : []).slice(0, MAX_DOMAINS).map(obj)
    .map((d) => ({ name: String(d.name ?? '').toLowerCase(), kind: d.kind === 'ns' ? 'ns' as const : 'a' as const, ip: ipOf(d.ip, 0) }))
    .filter((d) => validDomain(d.name) === null && !reservedAddress(d.ip));
  const s = { isp: typeof o.isp === 'string' ? o.isp.slice(0, 40) : fallback.isp, block: ipOf(o.block, fallback.block), ports, domains };
  return validateCloud(s) ? { ...fallback, ports, domains } : s;
}
