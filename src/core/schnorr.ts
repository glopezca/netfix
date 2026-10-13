/**
 * Schnorr signatures over the order-q subgroup of Z_p*, with p = 2q + 1 a 256-bit safe prime (BigInt).
 * Teaching-sized, synchronous and dependency-free: it makes a public key useless for forging a signature
 * inside the simulator. It is NOT meant to protect real data.
 *
 * p was found by searching upward from SHA-256("netfix-ssh-group"); p and q were checked prime with
 * `openssl prime`. g = 4 is a quadratic residue, so it generates the subgroup of prime order q.
 */
import { sha256, concatBytes, utf8 } from './sha256.ts';

const P = 0xebc05ac8af3d023451260aaa746477f47d48a25b91de18237962e63f1fc99157n;
const Q = 0x75e02d64579e811a289305553a323bfa3ea4512dc8ef0c11bcb1731f8fe4c8abn;
const G = 4n;
/** Size of a group element or exponent in bytes. */
export const SCHNORR_BYTES = 32;

function toInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function toBytes(v: bigint): Uint8Array {
  const out = new Uint8Array(SCHNORR_BYTES);
  let x = v;
  for (let i = SCHNORR_BYTES - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  for (let e = exp; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
  }
  return result;
}

/** Hash to an exponent in [1, q-1]. */
function hashToScalar(label: string, ...parts: Uint8Array[]): bigint {
  return (toInt(sha256(concatBytes(utf8(label), ...parts))) % (Q - 1n)) + 1n;
}

function secret(seed: Uint8Array): bigint {
  return hashToScalar('netfix-schnorr-x', seed);
}

/** Public value y = g^x of the key derived from `seed` (32 bytes). */
export function schnorrPublic(seed: Uint8Array): Uint8Array {
  return toBytes(modPow(G, secret(seed), P));
}

function challenge(r: Uint8Array, y: Uint8Array, message: Uint8Array): bigint {
  return toInt(sha256(concatBytes(utf8('netfix-schnorr-e'), r, y, message))) % Q;
}

/** Signature (R ‖ s, 64 bytes); the nonce is derived from the key and the message (no RNG needed). */
export function schnorrSign(seed: Uint8Array, message: Uint8Array): Uint8Array {
  const x = secret(seed);
  const y = toBytes(modPow(G, x, P));
  const k = hashToScalar('netfix-schnorr-k', seed, message);
  const r = toBytes(modPow(G, k, P));
  const s = (k + challenge(r, y, message) * x) % Q;
  return concatBytes(r, toBytes(s));
}

/** g^s = R · y^e (mod p), with R and y in the subgroup. */
export function schnorrVerify(publicValue: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicValue.length !== SCHNORR_BYTES || signature.length !== 2 * SCHNORR_BYTES) return false;
  const y = toInt(publicValue);
  const rBytes = signature.slice(0, SCHNORR_BYTES);
  const r = toInt(rBytes);
  const s = toInt(signature.slice(SCHNORR_BYTES));
  const inGroup = (v: bigint): boolean => v > 1n && v < P && modPow(v, Q, P) === 1n;
  if (!inGroup(y) || !inGroup(r) || s >= Q) return false;
  return modPow(G, s, P) === (r * modPow(y, challenge(rBytes, publicValue, message), P)) % P;
}
