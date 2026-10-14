/** X25519 against RFC 7748 §6.1 and the key format of wg genkey/pubkey. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeKey, genKey, pubKey, publicKeyOf, x25519 } from '../../src/core/x25519.ts';

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const bin = (s: string): Uint8Array => Uint8Array.from((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));

test('RFC 7748 Alice/Bob public keys and shared secret', () => {
  const a = bin('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const b = bin('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  assert.equal(hex(publicKeyOf(a)), '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  assert.equal(hex(publicKeyOf(b)), 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  const shared = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
  assert.equal(hex(x25519(a, publicKeyOf(b))), shared);
  assert.equal(hex(x25519(b, publicKeyOf(a))), shared);
});

test('genkey gives 44-character base64 keys whose pubkey is stable; bad input is rejected', () => {
  const k = genKey();
  assert.match(k, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(pubKey(k), pubKey(k));
  assert.equal(pubKey('nope'), null);
  assert.equal(decodeKey('AAAA'), null);
});
