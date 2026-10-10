/** MAC address and DHCP client-identifier helpers. MACs are 12 lowercase hex chars. */

const HEX_RE = /^[0-9a-f]+$/;
const MAC_HEX_LEN = 12;
export const BROADCAST_MAC = 'ffffffffffff';

function stripSeparators(text: string): string {
  return text.toLowerCase().replace(/[.:\-]/g, '');
}

export function parseMac(text: string): string | null {
  const hex = stripSeparators(text);
  return hex.length === MAC_HEX_LEN && HEX_RE.test(hex) ? hex : null;
}

function groupBy4(hex: string): string {
  return (hex.match(/.{1,4}/g) ?? []).join('.');
}

export function formatMacCisco(mac: string): string {
  return groupBy4(mac);
}

export function formatMacPT(mac: string): string {
  return groupBy4(mac.toUpperCase());
}

/** Parses a hex client identifier such as "0100.1122.3344.55". */
export function parseHexId(text: string): string | null {
  const hex = stripSeparators(text);
  if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) return null;
  return hex;
}

export function formatHexId(hex: string): string {
  return groupBy4(hex.toLowerCase());
}

/** Ethernet client-id (hardware type 01 + MAC), as sent by PCs. */
export function clientIdFromMac(mac: string): string {
  return `01${mac}`;
}

export function asciiToHex(text: string): string {
  return Array.from(text, (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

const LCG_A = 1103515245;
const LCG_C = 12345;
const BYTE = 256;

/** Deterministic unicast MAC derived from a numeric seed (OUI-like prefix 00xx). */
export function macFromSeed(seed: number): string {
  let state = (seed * 2654435761) >>> 0;
  const bytes = [0];
  for (let i = 0; i < 5; i++) {
    state = (Math.imul(state, LCG_A) + LCG_C) >>> 0;
    bytes.push((state >>> 16) % BYTE);
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
