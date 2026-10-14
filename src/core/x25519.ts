/**
 * X25519 (RFC 7748) with BigInt: the key agreement WireGuard uses. `wg genkey`/`wg pubkey` therefore
 * give the same keys as the real tools, and both peers derive the same shared secret.
 * Constant time is not a goal here: keys only protect traffic inside the simulator.
 */
import { fromBase64, toBase64 } from './sha256.ts';

const P = (1n << 255n) - 19n;
const A24 = 121665n;
const KEY_BYTES = 32;
const BASE_POINT = 9n;

const mod = (a: bigint): bigint => {
  const r = a % P;
  return r >= 0n ? r : r + P;
};

function modPow(b: bigint, e: bigint): bigint {
  let result = 1n;
  let base = mod(b);
  for (let x = e; x > 0n; x >>= 1n) {
    if (x & 1n) result = (result * base) % P;
    base = (base * base) % P;
  }
  return result;
}

function leToInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i] ?? 0);
  return v;
}

function intToLe(v: bigint): Uint8Array {
  const out = new Uint8Array(KEY_BYTES);
  let x = v;
  for (let i = 0; i < KEY_BYTES; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** RFC 7748 clamping (what `wg genkey` applies to its random bytes). */
export function clamp(k: Uint8Array): Uint8Array {
  const b = Uint8Array.from(k);
  b[0] = (b[0] ?? 0) & 248;
  b[31] = ((b[31] ?? 0) & 127) | 64;
  return b;
}

function ladder(k: bigint, u: bigint): bigint {
  let [x2, z2, x3, z3] = [1n, 0n, u, 1n];
  let swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n;
    if (swap ^ kt) [x2, x3, z2, z3] = [x3, x2, z3, z2];
    swap = kt;
    const a = mod(x2 + z2);
    const aa = (a * a) % P;
    const b = mod(x2 - z2);
    const bb = (b * b) % P;
    const e = mod(aa - bb);
    const da = (mod(x3 - z3) * a) % P;
    const cb = (mod(x3 + z3) * b) % P;
    x3 = modPow(da + cb, 2n);
    z3 = (u * modPow(da - cb, 2n)) % P;
    x2 = (aa * bb) % P;
    z2 = (e * mod(aa + A24 * e)) % P;
  }
  if (swap) [x2, z2] = [x3, z3];
  return (x2 * modPow(z2, P - 2n)) % P;
}

/** X25519(k, u) on raw 32-byte strings. */
export function x25519(scalar: Uint8Array, u: Uint8Array): Uint8Array {
  const uBytes = Uint8Array.from(u);
  uBytes[31] = (uBytes[31] ?? 0) & 127;
  return intToLe(ladder(leToInt(clamp(scalar)), mod(leToInt(uBytes))));
}

export function publicKeyOf(priv: Uint8Array): Uint8Array {
  return x25519(priv, intToLe(BASE_POINT));
}

/** A WireGuard key in base64 (44 characters) → bytes, or null when it is not a valid key. */
export function decodeKey(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/.test(text.trim())) return null;
  const bytes = fromBase64(text.trim());
  return bytes && bytes.length === KEY_BYTES ? bytes : null;
}

export const encodeKey = (bytes: Uint8Array): string => toBase64(bytes);

export function randomKey(): Uint8Array {
  const out = new Uint8Array(KEY_BYTES);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** `wg genkey`: a clamped random private key. */
export const genKey = (): string => encodeKey(clamp(randomKey()));

/** `wg pubkey`: null when the input is not a key. */
export function pubKey(privB64: string): string | null {
  const priv = decodeKey(privB64);
  return priv ? encodeKey(publicKeyOf(priv)) : null;
}
