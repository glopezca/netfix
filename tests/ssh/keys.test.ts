/** SHA-256 and the OpenSSH key formats (public lines, openssh-key-v1 private files, fingerprints, randomart). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, toBase64, fromBase64 } from '../../src/core/sha256.ts';
import { generateKey, publicLine, parsePublicLine, fingerprint, privateFile, parsePrivateFile, randomart, isEncrypted, signChallenge, verifySignature } from '../../src/net/ssh-keys.ts';

const fixed = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

test('sha256 matches node:crypto', () => {
  for (const text of ['', 'abc', 'a'.repeat(1000), 'Netfix ✓']) {
    const mine = Buffer.from(sha256(new TextEncoder().encode(text))).toString('hex');
    assert.equal(mine, createHash('sha256').update(text).digest('hex'), text.slice(0, 10));
  }
  assert.deepEqual(fromBase64(toBase64(fixed(50))), fixed(50));
});

test('ed25519, ecdsa and rsa public keys use the real wire format', () => {
  const ed = generateKey('ed25519', 256, 'alumno@pc0', fixed);
  assert.match(publicLine(ed), /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43} alumno@pc0$/);
  assert.match(publicLine(generateKey('ecdsa', 256, 'x', fixed)), /^ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBB/);
  assert.match(publicLine(generateKey('rsa', 3072, 'x', fixed)), /^ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ/);
  const parsed = parsePublicLine(publicLine(ed));
  assert.equal(parsed?.type, 'ed25519');
  assert.equal(parsed?.comment, 'alumno@pc0');
  assert.match(fingerprint(ed.blob), /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(parsePublicLine('ssh-ed25519 AAAAB3NzaC1yc2EAAAADAQAB'), null, 'type and blob must agree');
  assert.equal(parsePublicLine('nonsense'), null);
});

test('private files round-trip, with and without passphrase', () => {
  const kp = generateKey('ed25519', 256, 'alumno@pc0', fixed);
  const plain = privateFile(kp, '', fixed);
  assert.match(plain, /^-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ[\s\S]*\n-----END OPENSSH PRIVATE KEY-----\n$/);
  assert.equal(isEncrypted(plain), false);
  const back = parsePrivateFile(plain, '');
  assert.ok(typeof back !== 'string' && fingerprint(back.blob) === fingerprint(kp.blob));
  const locked = privateFile(kp, 'secreto', fixed);
  assert.equal(isEncrypted(locked), true);
  assert.equal(parsePrivateFile(locked, 'otra'), 'bad-passphrase');
  const opened = parsePrivateFile(locked, 'secreto');
  assert.ok(typeof opened !== 'string' && opened.comment === 'alumno@pc0');
  assert.equal(parsePrivateFile('hola', ''), 'invalid');
});

test('randomart box and simulated signatures', () => {
  const kp = generateKey('ed25519', 256, 'c', fixed);
  const art = randomart(kp);
  assert.equal(art.length, 11);
  assert.equal(art[0], '+--[ED25519 256]--+');
  assert.equal(art[10], '+----[SHA256]-----+');
  assert.ok(art.slice(1, 10).every((l) => /^\|.{17}\|$/.test(l)));
  const challenge = fixed(16);
  const sig = signChallenge(kp, challenge);
  assert.equal(verifySignature(kp.blob, challenge, sig), true);
  assert.equal(verifySignature(generateKey('ed25519', 256, 'c', (n) => fixed(n).reverse()).blob, challenge, sig), false);
});
