/**
 * OpenSSH key formats: public key lines with real wire-format blobs ("ssh-ed25519 AAAAC3Nza…"),
 * openssh-key-v1 private files (optionally protected by a passphrase), SHA256 fingerprints and the
 * randomart box. Every key type carries the same teaching-sized Schnorr key (see schnorr.ts) inside its
 * wire format: there is no Ed25519, ECDSA or RSA arithmetic, but only the holder of the private file
 * can sign, and the public blob is useless to forge a signature.
 */
import { sha256, concatBytes, utf8, toBase64, fromBase64 } from '../core/sha256.ts';
import { schnorrPublic, schnorrSign, schnorrVerify, SCHNORR_BYTES } from '../core/schnorr.ts';

export type KeyType = 'ed25519' | 'ecdsa' | 'rsa';

export interface KeyPair {
  readonly type: KeyType;
  readonly bits: number;
  /** Public key blob (what authorized_keys and known_hosts store, base64-encoded). */
  readonly blob: Uint8Array;
  readonly seed: Uint8Array;
  readonly comment: string;
}

export type Random = (n: number) => Uint8Array;

export const WIRE_NAME: Readonly<Record<KeyType, string>> = { ed25519: 'ssh-ed25519', ecdsa: 'ecdsa-sha2-nistp256', rsa: 'ssh-rsa' };
export const LABEL: Readonly<Record<KeyType, string>> = { ed25519: 'ED25519', ecdsa: 'ECDSA', rsa: 'RSA' };
const SEED_BYTES = 32;
const RSA_E = Uint8Array.of(1, 0, 1);
const MAGIC = utf8('openssh-key-v1\0');
const KDF_ROUNDS = 16;

export const cryptoRandom: Random = (n) => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

// ------------------------------------------------------------ wire encoding

const u32 = (n: number): Uint8Array => Uint8Array.of(n >>> 24 & 0xff, n >>> 16 & 0xff, n >>> 8 & 0xff, n & 0xff);
const str = (b: Uint8Array | string): Uint8Array => {
  const bytes = typeof b === 'string' ? utf8(b) : b;
  return concatBytes(u32(bytes.length), bytes);
};

class Reader {
  private off = 0;
  private readonly b: Uint8Array;

  constructor(b: Uint8Array) {
    this.b = b;
  }

  u32(): number {
    if (this.off + 4 > this.b.length) throw new Error('short');
    const v = ((this.b[this.off] ?? 0) << 24 | (this.b[this.off + 1] ?? 0) << 16 | (this.b[this.off + 2] ?? 0) << 8 | (this.b[this.off + 3] ?? 0)) >>> 0;
    this.off += 4;
    return v;
  }

  bytes(): Uint8Array {
    const n = this.u32();
    if (this.off + n > this.b.length) throw new Error('short');
    const out = this.b.slice(this.off, this.off + n);
    this.off += n;
    return out;
  }

  text(): string {
    return new TextDecoder().decode(this.bytes());
  }

  rest(): Uint8Array {
    return this.b.slice(this.off);
  }
}

/** Expands a seed into `n` bytes (SHA-256 in counter mode). */
function expand(seed: Uint8Array, label: string, n: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; parts.length * 32 < n; i++) parts.push(sha256(concatBytes(utf8(label), seed, u32(i))));
  return concatBytes(...parts).slice(0, n);
}

const RSA_TOP = 0xc5;

function deriveBlob(type: KeyType, bits: number, seed: Uint8Array): Uint8Array {
  const y = schnorrPublic(seed);
  if (type === 'ed25519') return concatBytes(str(WIRE_NAME.ed25519), str(y));
  if (type === 'ecdsa') return concatBytes(str(WIRE_NAME.ecdsa), str('nistp256'), str(concatBytes(Uint8Array.of(4), y, expand(y, 'ecdsa', SCHNORR_BYTES))));
  const n = concatBytes(Uint8Array.of(RSA_TOP), y, expand(y, 'rsa', bits / 8 - 1 - SCHNORR_BYTES));
  return concatBytes(str(WIRE_NAME.rsa), str(RSA_E), str(concatBytes(Uint8Array.of(0), n)));
}

/** The Schnorr public value inside a blob, or null when the blob was not made by deriveBlob. */
function publicValue(blob: Uint8Array): Uint8Array | null {
  try {
    const r = new Reader(blob);
    const name = r.text();
    if (name === WIRE_NAME.ed25519) return r.bytes();
    if (name === WIRE_NAME.ecdsa) {
      r.text();
      const point = r.bytes();
      const y = point.slice(1, 1 + SCHNORR_BYTES);
      return sameBlob(point.slice(1 + SCHNORR_BYTES), expand(y, 'ecdsa', SCHNORR_BYTES)) ? y : null;
    }
    r.bytes();
    const n = r.bytes().slice(1);
    const y = n.slice(1, 1 + SCHNORR_BYTES);
    return n[0] === RSA_TOP && sameBlob(n.slice(1 + SCHNORR_BYTES), expand(y, 'rsa', n.length - 1 - SCHNORR_BYTES)) ? y : null;
  } catch {
    return null;
  }
}

export function generateKey(type: KeyType, bits: number, comment: string, random: Random = cryptoRandom): KeyPair {
  const seed = random(SEED_BYTES);
  return { type, bits, blob: deriveBlob(type, bits, seed), seed, comment };
}

/** Deterministic key (host keys derived from the device). */
export function keyFromSeed(type: KeyType, bits: number, seedText: string, comment: string): KeyPair {
  const seed = sha256(utf8(seedText));
  return { type, bits, blob: deriveBlob(type, bits, seed), seed, comment };
}

function typeOfBlob(blob: Uint8Array): { type: KeyType; bits: number } | null {
  try {
    const r = new Reader(blob);
    const name = r.text();
    if (name === WIRE_NAME.ed25519) return r.bytes().length === 32 ? { type: 'ed25519', bits: 256 } : null;
    if (name === WIRE_NAME.ecdsa) return r.text() === 'nistp256' && r.bytes().length === 65 ? { type: 'ecdsa', bits: 256 } : null;
    if (name === WIRE_NAME.rsa) {
      r.bytes();
      const n = r.bytes();
      return { type: 'rsa', bits: (n.length - (n[0] === 0 ? 1 : 0)) * 8 };
    }
  } catch { /* malformed */ }
  return null;
}

// ------------------------------------------------------------ public keys

export function publicLine(kp: Pick<KeyPair, 'type' | 'blob' | 'comment'>): string {
  return `${WIRE_NAME[kp.type]} ${toBase64(kp.blob)}${kp.comment ? ` ${kp.comment}` : ''}`;
}

export interface PublicKey {
  readonly type: KeyType;
  readonly bits: number;
  readonly blob: Uint8Array;
  readonly comment: string;
}

/** "ssh-ed25519 AAAA… comment": the key type must be the first word (authorized-keys.ts handles options). */
export function parsePublicLine(line: string): PublicKey | null {
  const words = line.trim().split(/\s+/);
  if (!Object.values(WIRE_NAME).includes(words[0] ?? '')) return null;
  const blob = fromBase64(words[1] ?? '');
  const kind = blob ? typeOfBlob(blob) : null;
  if (!blob || !kind || WIRE_NAME[kind.type] !== words[0]) return null;
  return { ...kind, blob, comment: words.slice(2).join(' ') };
}

export function sameBlob(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function fingerprint(blob: Uint8Array): string {
  return `SHA256:${toBase64(sha256(blob), false)}`;
}

// ------------------------------------------------------------ private files

function keystream(pass: string, salt: Uint8Array, n: number): Uint8Array {
  return expand(concatBytes(utf8(pass), salt), 'aes256-ctr', n);
}

function xor(data: Uint8Array, key: Uint8Array): Uint8Array {
  return data.map((v, i) => v ^ (key[i] ?? 0));
}

function wrap(b64: string): string {
  return (b64.match(/.{1,70}/g) ?? []).join('\n');
}

export function privateFile(kp: KeyPair, passphrase: string, random: Random = cryptoRandom): string {
  const check = random(4);
  const blockSize = passphrase ? 16 : 8;
  let section = concatBytes(check, check, str(WIRE_NAME[kp.type]), str(kp.blob), str(kp.seed), str(kp.comment));
  const pad = (blockSize - (section.length % blockSize)) % blockSize;
  section = concatBytes(section, Uint8Array.from({ length: pad }, (_, i) => i + 1));
  const salt = random(16);
  const kdf = passphrase ? concatBytes(str(salt), u32(KDF_ROUNDS)) : new Uint8Array();
  const body = passphrase ? xor(section, keystream(passphrase, salt, section.length)) : section;
  const all = concatBytes(MAGIC, str(passphrase ? 'aes256-ctr' : 'none'), str(passphrase ? 'bcrypt' : 'none'), str(kdf), u32(1), str(kp.blob), str(body));
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrap(toBase64(all))}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function decodeFile(text: string): { cipher: string; kdf: Uint8Array; body: Uint8Array } | null {
  const m = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(text);
  const all = m ? fromBase64((m[1] ?? '').replace(/\s+/g, '')) : null;
  if (!all || !sameBlob(all.slice(0, MAGIC.length), MAGIC)) return null;
  try {
    const r = new Reader(all.slice(MAGIC.length));
    const cipher = r.text();
    r.text();
    const kdf = r.bytes();
    if (r.u32() !== 1) return null;
    r.bytes();
    return { cipher, kdf, body: r.bytes() };
  } catch {
    return null;
  }
}

export function isEncrypted(text: string): boolean {
  return decodeFile(text)?.cipher !== 'none' && decodeFile(text) !== null;
}

/** The key of a private file; 'invalid' (not a key) or 'bad-passphrase' (wrong or missing passphrase). */
export function parsePrivateFile(text: string, passphrase: string): KeyPair | 'invalid' | 'bad-passphrase' {
  const file = decodeFile(text);
  if (!file) return 'invalid';
  let body = file.body;
  if (file.cipher !== 'none') {
    try {
      body = xor(body, keystream(passphrase, new Reader(file.kdf).bytes(), body.length));
    } catch {
      return 'invalid';
    }
  }
  try {
    const r = new Reader(body);
    if (r.u32() !== r.u32()) return file.cipher === 'none' ? 'invalid' : 'bad-passphrase';
    r.text();
    const blob = r.bytes();
    const seed = r.bytes();
    const comment = r.text();
    const kind = typeOfBlob(blob);
    // The public half must come from the private seed: a file with someone else's public key is not a key.
    return kind && sameBlob(blob, deriveBlob(kind.type, kind.bits, seed)) ? { ...kind, blob, seed, comment } : 'invalid';
  } catch {
    return file.cipher === 'none' ? 'invalid' : 'bad-passphrase';
  }
}

// ------------------------------------------------------------ randomart and signatures

const ART = ' .o+=*BOX@%&#/^SE';
const W = 17;
const H = 9;

function center(text: string, fill: string): string {
  const left = Math.floor((W - text.length) / 2);
  return `${fill.repeat(left)}${text}${fill.repeat(W - text.length - left)}`;
}

/** The "drunken bishop" picture that ssh-keygen prints. */
export function randomart(kp: Pick<KeyPair, 'type' | 'bits' | 'blob'>): string[] {
  const field = Array.from({ length: H }, () => new Array<number>(W).fill(0));
  let x = Math.floor(W / 2);
  let y = Math.floor(H / 2);
  for (const byte of sha256(kp.blob)) {
    for (let s = 0; s < 8; s += 2) {
      const step = (byte >> s) & 3;
      x = Math.max(0, Math.min(W - 1, x + (step & 1 ? 1 : -1)));
      y = Math.max(0, Math.min(H - 1, y + (step & 2 ? 1 : -1)));
      const row = field[y];
      if (row) row[x] = Math.min((row[x] ?? 0) + 1, ART.length - 3);
    }
  }
  const startRow = field[Math.floor(H / 2)];
  if (startRow) startRow[Math.floor(W / 2)] = ART.length - 2;
  const endRow = field[y];
  if (endRow) endRow[x] = ART.length - 1;
  return [`+${center(`[${LABEL[kp.type]} ${kp.bits}]`, '-')}+`, ...field.map((r) => `|${r.map((v) => ART[v]).join('')}|`), `+${center('[SHA256]', '-')}+`];
}

/** Signature of `message` (an authentication challenge) with the private key. */
export function signChallenge(kp: Pick<KeyPair, 'seed'>, message: Uint8Array): string {
  return toBase64(schnorrSign(kp.seed, message));
}

/** True when `signature` was made over `message` by the private key of `blob`. */
export function verifySignature(blob: Uint8Array, message: Uint8Array, signature: string): boolean {
  const y = publicValue(blob);
  const sig = fromBase64(signature);
  return y !== null && sig !== null && schnorrVerify(y, message, sig);
}
