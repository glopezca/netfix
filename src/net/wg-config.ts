/**
 * WireGuard configuration: the `wg setconf` format ([Interface] PrivateKey/ListenPort, [Peer] PublicKey/
 * PresharedKey/AllowedIPs/Endpoint/PersistentKeepalive) plus the keys wg-quick adds (Address, DNS, MTU,
 * Table, PreUp/PostUp/PreDown/PostDown, SaveConfig). Immutable records; errors use wg's wording.
 */
import { formatIp, parseIp } from '../core/ip.ts';
import { decodeKey } from '../core/x25519.ts';

export interface Cidr {
  readonly ip: number;
  readonly prefix: number;
}

export interface Endpoint {
  readonly ip: number;
  readonly port: number;
}

export interface WgPeerConfig {
  readonly publicKey: string;
  readonly presharedKey?: string;
  readonly allowedIps: readonly Cidr[];
  readonly endpoint?: Endpoint;
  readonly keepalive?: number;
}

export interface WgConfig {
  readonly privateKey?: string;
  readonly listenPort?: number;
  readonly peers: readonly WgPeerConfig[];
}

export interface WgQuickConfig {
  readonly wg: WgConfig;
  readonly addresses: readonly Cidr[];
  readonly dns: readonly string[];
  readonly mtu?: number;
  readonly table?: string;
  readonly hooks: { readonly preUp: readonly string[]; readonly postUp: readonly string[]; readonly preDown: readonly string[]; readonly postDown: readonly string[] };
  readonly saveConfig: boolean;
}

export const WG_DEFAULT_PORT = 51820;
export const WG_MAX_PEERS = 64;
const MAX_PORT = 65535;
const MAX_KEEPALIVE = 65535;
const MAX_PREFIX = 32;
const PARSE_ERROR = 'Configuration parsing error';

export function parseCidr(text: string): Cidr | null {
  const [addr, len] = text.trim().split('/');
  const ip = parseIp(addr ?? '');
  const prefix = len === undefined ? MAX_PREFIX : Number(len);
  if (ip === null || !Number.isInteger(prefix) || prefix < 0 || prefix > MAX_PREFIX || (len !== undefined && !/^\d+$/.test(len))) return null;
  return { ip, prefix };
}

export const cidrText = (c: Cidr): string => `${formatIp(c.ip)}/${c.prefix}`;

export function parseEndpoint(text: string): Endpoint | null {
  const m = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(text.trim());
  const ip = m ? parseIp(m[1] ?? '') : null;
  const port = Number(m?.[2]);
  return ip !== null && port >= 1 && port <= MAX_PORT ? { ip, port } : null;
}

const keyError = (v: string): string => `Key is not the correct length or format: \`${v}'\n${PARSE_ERROR}`;

type Section = 'none' | 'interface' | 'peer';

interface Draft {
  wg: WgConfig;
  quick: Omit<WgQuickConfig, 'wg'>;
}

function setPeer(d: Draft, change: (p: WgPeerConfig) => WgPeerConfig): void {
  const last = d.wg.peers[d.wg.peers.length - 1];
  if (last) d.wg = { ...d.wg, peers: [...d.wg.peers.slice(0, -1), change(last)] };
}

function interfaceKey(d: Draft, key: string, value: string, quick: boolean): string | null {
  const k = key.toLowerCase();
  if (k === 'privatekey') return decodeKey(value) ? ((d.wg = { ...d.wg, privateKey: value.trim() }), null) : keyError(value);
  if (k === 'listenport') {
    const port = Number(value);
    return /^\d+$/.test(value) && port <= MAX_PORT ? ((d.wg = { ...d.wg, listenPort: port }), null) : `Listen port is invalid: \`${value}'\n${PARSE_ERROR}`;
  }
  if (!quick) return null;
  const hooks = d.quick.hooks;
  if (k === 'address') {
    const list = value.split(',').map((v) => v.trim()).filter(Boolean);
    const parsed = list.map(parseCidr);
    const bad = list.find((_, i) => parsed[i] === null);
    if (bad !== undefined) return `Error: any valid prefix is expected rather than "${bad}".`;
    d.quick = { ...d.quick, addresses: [...d.quick.addresses, ...parsed.filter((c): c is Cidr => c !== null)] };
  } else if (k === 'dns') d.quick = { ...d.quick, dns: [...d.quick.dns, ...value.split(',').map((v) => v.trim()).filter(Boolean)] };
  else if (k === 'mtu') d.quick = { ...d.quick, mtu: Number(value) };
  else if (k === 'table') d.quick = { ...d.quick, table: value };
  else if (k === 'saveconfig') d.quick = { ...d.quick, saveConfig: value === 'true' };
  else if (k === 'preup') d.quick = { ...d.quick, hooks: { ...hooks, preUp: [...hooks.preUp, value] } };
  else if (k === 'postup') d.quick = { ...d.quick, hooks: { ...hooks, postUp: [...hooks.postUp, value] } };
  else if (k === 'predown') d.quick = { ...d.quick, hooks: { ...hooks, preDown: [...hooks.preDown, value] } };
  else if (k === 'postdown') d.quick = { ...d.quick, hooks: { ...hooks, postDown: [...hooks.postDown, value] } };
  return null;
}

const QUICK_KEYS = ['address', 'dns', 'mtu', 'table', 'saveconfig', 'preup', 'postup', 'predown', 'postdown'];

function peerKey(d: Draft, key: string, value: string): string | null {
  const k = key.toLowerCase();
  if (k === 'publickey') return decodeKey(value) ? (setPeer(d, (p) => ({ ...p, publicKey: value.trim() })), null) : keyError(value);
  if (k === 'presharedkey') return decodeKey(value) ? (setPeer(d, (p) => ({ ...p, presharedKey: value.trim() })), null) : keyError(value);
  if (k === 'allowedips') {
    const list = value.split(',').map((v) => v.trim()).filter(Boolean);
    const parsed = list.map(parseCidr);
    const bad = list.find((_, i) => parsed[i] === null);
    if (bad !== undefined) return `Unable to parse IP address: \`${bad}'\n${PARSE_ERROR}`;
    setPeer(d, (p) => ({ ...p, allowedIps: [...p.allowedIps, ...parsed.filter((c): c is Cidr => c !== null)] }));
    return null;
  }
  if (k === 'endpoint') {
    const ep = parseEndpoint(value);
    return ep ? (setPeer(d, (p) => ({ ...p, endpoint: ep })), null) : `Name or service not known: \`${value}'\n${PARSE_ERROR}`;
  }
  if (k === 'persistentkeepalive') {
    const n = value === 'off' ? 0 : Number(value);
    if (!/^(\d+|off)$/.test(value) || n > MAX_KEEPALIVE) return `Persistent keepalive interval is neither 0/off nor 1-65535: \`${value}'\n${PARSE_ERROR}`;
    setPeer(d, (p) => ({ ...p, keepalive: n || undefined }));
    return null;
  }
  return '';
}

function parseLine(d: Draft, section: Section, raw: string, quick: boolean): string | null {
  const eq = raw.indexOf('=');
  const key = eq < 0 ? '' : raw.slice(0, eq).trim();
  const value = eq < 0 ? '' : raw.slice(eq + 1).trim();
  if (eq < 0 || section === 'none') return `Line unrecognized: \`${raw.replace(/\s+/g, '')}'\n${PARSE_ERROR}`;
  const err = section === 'interface' ? interfaceKey(d, key, value, quick) : peerKey(d, key, value);
  const known = section === 'interface' ? ['privatekey', 'listenport', 'fwmark', ...(quick ? QUICK_KEYS : [])] : null;
  if (err === '' || (known && !known.includes(key.toLowerCase()))) return `Line unrecognized: \`${raw.replace(/\s+/g, '')}'\n${PARSE_ERROR}`;
  return err;
}

/** Parses a wg-quick file (`quick`) or a `wg setconf` file; returns the config or the error text. */
export function parseWgConf(text: string, quick = true): WgQuickConfig | string {
  const d: Draft = { wg: { peers: [] }, quick: { addresses: [], dns: [], hooks: { preUp: [], postUp: [], preDown: [], postDown: [] }, saveConfig: false } };
  let section: Section = 'none';
  for (const line of text.split('\n')) {
    const raw = line.replace(/#.*$/, '').trim();
    if (!raw) continue;
    if (/^\[interface\]$/i.test(raw)) { section = 'interface'; continue; }
    if (/^\[peer\]$/i.test(raw)) {
      if (d.wg.peers.length >= WG_MAX_PEERS) return `Too many peers\n${PARSE_ERROR}`;
      section = 'peer';
      d.wg = { ...d.wg, peers: [...d.wg.peers, { publicKey: '', allowedIps: [] }] };
      continue;
    }
    const err = parseLine(d, section, raw, quick);
    if (err) return err;
  }
  if (d.wg.peers.some((p) => !p.publicKey)) return `A peer is missing a public key\n${PARSE_ERROR}`;
  return { wg: d.wg, ...d.quick };
}

/** `wg showconf`: the running configuration in setconf format. */
export function formatWgConf(c: WgConfig): string[] {
  const head = ['[Interface]', ...(c.listenPort !== undefined ? [`ListenPort = ${c.listenPort}`] : []), ...(c.privateKey ? [`PrivateKey = ${c.privateKey}`] : [])];
  const peers = c.peers.flatMap((p) => [
    '', '[Peer]', `PublicKey = ${p.publicKey}`,
    ...(p.presharedKey ? [`PresharedKey = ${p.presharedKey}`] : []),
    ...(p.allowedIps.length ? [`AllowedIPs = ${p.allowedIps.map(cidrText).join(', ')}`] : []),
    ...(p.endpoint ? [`Endpoint = ${formatIp(p.endpoint.ip)}:${p.endpoint.port}`] : []),
    ...(p.keepalive ? [`PersistentKeepalive = ${p.keepalive}`] : []),
  ]);
  return [...head, ...peers];
}

export function inCidr(c: Cidr, ip: number): boolean {
  if (c.prefix === 0) return true;
  const mask = (0xffffffff << (MAX_PREFIX - c.prefix)) >>> 0;
  return ((ip & mask) >>> 0) === ((c.ip & mask) >>> 0);
}

export function networkCidr(c: Cidr): Cidr {
  const mask = c.prefix === 0 ? 0 : (0xffffffff << (MAX_PREFIX - c.prefix)) >>> 0;
  return { ip: (c.ip & mask) >>> 0, prefix: c.prefix };
}
