/** IPv4 helpers. Addresses are unsigned 32-bit numbers. */

export interface IpWithPrefix {
  readonly ip: number;
  readonly prefix: number;
}

const OCTET_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const MAX_PREFIX = 32;

export function parseIp(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET_RE.test(part)) return null;
    value = value * 256 + Number(part);
  }
  return value >>> 0;
}

export function formatIp(value: number): string {
  const v = value >>> 0;
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

export function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  return (0xffffffff << (MAX_PREFIX - prefix)) >>> 0;
}

export function formatMask(prefix: number): string {
  return formatIp(prefixToMask(prefix));
}

/** Accepts "255.255.255.0" or "/24". Returns the prefix length or null. */
export function parseMask(text: string): number | null {
  if (text.startsWith('/')) {
    const body = text.slice(1);
    if (!/^\d{1,2}$/.test(body)) return null;
    const prefix = Number(body);
    return prefix <= MAX_PREFIX ? prefix : null;
  }
  const mask = parseIp(text);
  if (mask === null) return null;
  for (let prefix = 0; prefix <= MAX_PREFIX; prefix++) {
    if (prefixToMask(prefix) === mask) return prefix;
  }
  return null;
}

export function networkOf(ip: number, prefix: number): number {
  return (ip & prefixToMask(prefix)) >>> 0;
}

export function broadcastOf(ip: number, prefix: number): number {
  return (networkOf(ip, prefix) | (~prefixToMask(prefix) >>> 0)) >>> 0;
}

export function inSubnet(ip: number, network: number, prefix: number): boolean {
  return networkOf(ip, prefix) === networkOf(network, prefix);
}

/** Classful default prefix, used by IOS when a mask is omitted. */
export function classfulPrefix(ip: number): number {
  const first = ip >>> 24;
  if (first < 128) return 8;
  if (first < 192) return 16;
  if (first < 224) return 24;
  return MAX_PREFIX;
}

export function parseIpWithMask(ipText: string, maskText: string): IpWithPrefix | null {
  const ip = parseIp(ipText);
  const prefix = parseMask(maskText);
  if (ip === null || prefix === null) return null;
  return { ip, prefix };
}

export function isUsableHost(ip: number, prefix: number): boolean {
  if (prefix >= 31) return true;
  return ip !== networkOf(ip, prefix) && ip !== broadcastOf(ip, prefix);
}

export const BROADCAST_IP = 0xffffffff;
