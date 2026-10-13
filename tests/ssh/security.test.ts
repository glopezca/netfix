/**
 * Security properties of the simulated OpenSSH (ECC security review): signatures need the private key,
 * host keys must be proven, challenges are one-time and bound to the client, access rules hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, utf8, concatBytes, toBase64 } from '../../src/core/sha256.ts';
import { schnorrPublic, schnorrSign, schnorrVerify } from '../../src/core/schnorr.ts';
import { generateKey, privateFile, parsePrivateFile, publicLine, signChallenge, verifySignature } from '../../src/net/ssh-keys.ts';
import type { KeyPair } from '../../src/net/ssh-keys.ts';
import { PendingLogins, userAuthMessage } from '../../src/services/ssh-handshake.ts';
import { parseAuthorizedLine } from '../../src/services/authorized-keys.ts';
import { accessDenied, rootRefused } from '../../src/services/ssh-auth.ts';
import { DEFAULT_SSHD } from '../../src/services/sshd-config.ts';
import { loadHostKey } from '../../src/services/ssh-hostkeys.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const counter = (start: number) => (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (start + i * 31) & 0xff);
const msg = utf8('challenge');

test('Schnorr: valid signatures verify; other keys, messages or tampered bytes do not', () => {
  const seed = sha256(utf8('alice'));
  const y = schnorrPublic(seed);
  const sig = schnorrSign(seed, msg);
  assert.equal(schnorrVerify(y, msg, sig), true);
  assert.equal(schnorrVerify(y, utf8('other'), sig), false);
  assert.equal(schnorrVerify(schnorrPublic(sha256(utf8('bob'))), msg, sig), false);
  const tampered = sig.slice();
  tampered[40] = (tampered[40] ?? 0) ^ 1;
  assert.equal(schnorrVerify(y, msg, tampered), false);
  assert.equal(schnorrVerify(y, msg, new Uint8Array(64)), false, 'R = 0 is not in the group');
  assert.equal(schnorrVerify(new Uint8Array(32).fill(0xff), msg, sig), false, 'y ≥ p is rejected');
});

test('the public key alone cannot produce a signature (forgery from public data)', () => {
  const victim = generateKey('ed25519', 256, 'victim', counter(1));
  // What the old scheme accepted: a hash over public data.
  const forged = toBase64(sha256(concatBytes(victim.blob, msg, utf8('netfix-ssh-signature'))));
  assert.equal(verifySignature(victim.blob, msg, forged), false);
  // A private file holding the victim's public blob with another seed is not a key.
  const attacker = generateKey('ed25519', 256, 'victim', counter(2));
  const crafted: KeyPair = { ...attacker, blob: victim.blob };
  assert.equal(parsePrivateFile(privateFile(crafted, '', counter(3)), ''), 'invalid');
  assert.equal(verifySignature(victim.blob, msg, signChallenge(attacker, msg)), false);
  for (const type of ['ed25519', 'ecdsa', 'rsa'] as const) {
    const kp = generateKey(type, type === 'rsa' ? 2048 : 256, '', counter(9));
    assert.equal(verifySignature(kp.blob, msg, signChallenge(kp, msg)), true, type);
  }
});

test('a server cannot load another server\'s public host key as its own', () => {
  const real = generateKey('ed25519', 256, 'root@a', counter(4));
  const rogue = generateKey('ed25519', 256, 'root@b', counter(5));
  assert.equal(loadHostKey(privateFile({ ...rogue, blob: real.blob }, '', counter(6))), null);
  assert.ok(loadHostKey(privateFile(real, '', counter(6))));
});

test('challenges are random, one-time, bound to the client address and expire', () => {
  let call = 0;
  const p = new PendingLogins((n) => counter(++call)(n));
  const c = p.issue(ip('10.0.0.10'), 0);
  assert.notEqual(p.issue(ip('10.0.0.10'), 0), c);
  assert.deepEqual(p.check(c, ip('10.0.0.11'), 0), { ok: false, reason: 'unknown' }, 'other client');
  assert.equal(p.check(c, ip('10.0.0.10'), 1000).ok, true);
  assert.equal(p.fail(c), 1);
  p.close(c);
  assert.equal(p.check(c, ip('10.0.0.10'), 1000).ok, false, 'used once');
  const late = p.issue(ip('10.0.0.10'), 0);
  assert.deepEqual(p.check(late, ip('10.0.0.10'), 121_000), { ok: false, reason: 'expired' });
  // The signed message names the connection, the server's host key, the user and the key.
  const hostA = utf8('host-a');
  assert.notDeepEqual(userAuthMessage('c1', hostA, 'ana', 'k'), userAuthMessage('c2', hostA, 'ana', 'k'));
  assert.notDeepEqual(userAuthMessage('c1', hostA, 'ana', 'k'), userAuthMessage('c1', hostA, 'bob', 'k'));
  assert.notDeepEqual(userAuthMessage('c1', hostA, 'ana', 'k'), userAuthMessage('c1', utf8('host-b'), 'ana', 'k'));
});

test('one client cannot push out the pending logins of others', () => {
  let call = 0;
  const p = new PendingLogins((n) => counter(++call)(n));
  const victim = p.issue(ip('10.0.0.20'), 0) ?? '';
  for (let i = 0; i < 200; i++) p.issue(ip('10.0.0.66'), 0);
  assert.equal(p.check(victim, ip('10.0.0.20'), 0).ok, true);
  // Many clients fill the table: new ones are dropped (MaxStartups), existing logins survive.
  for (let h = 1; h <= 60; h++) p.issue(ip(`10.1.0.${h}`), 0);
  assert.equal(p.issue(ip('10.2.0.1'), 0), null);
  assert.equal(p.check(victim, ip('10.0.0.20'), 0).ok, true);
});

test('authorized_keys options: from= is enforced, unsupported options make the line unusable', () => {
  const key = publicLine(generateKey('ed25519', 256, 'a@b', counter(8)));
  const plain = parseAuthorizedLine(key);
  assert.ok(plain && !plain.error && plain.allowsFrom('1.2.3.4'));
  const from = parseAuthorizedLine(`from="10.0.0.*,!10.0.0.66" ${key}`);
  assert.equal(from?.allowsFrom('10.0.0.10'), true);
  assert.equal(from?.allowsFrom('10.0.0.66'), false);
  assert.equal(from?.allowsFrom('192.168.1.1'), false);
  assert.match(parseAuthorizedLine(`command="/bin/date" ${key}`)?.error ?? '', /command no está soportado/);
  assert.match(parseAuthorizedLine(`restrict,command="x ssh-ed25519 AAAA" ${key}`)?.error ?? '', /command/, 'a key type inside a quoted option is not the key');
  assert.equal(parseAuthorizedLine(`restrict,no-pty ${key}`)?.error, undefined);
  assert.equal(parseAuthorizedLine(`from="unclosed ${key}`)?.error ?? 'null', 'null');
  assert.equal(parseAuthorizedLine(`# ${key}`), null);
});

test('AllowUsers/DenyUsers/AllowGroups/DenyGroups with patterns, and PermitRootLogin', () => {
  const ana = { name: 'ana', uid: 1001, home: '/home/ana', groupNames: ['ana', 'alumnos'] };
  const s = DEFAULT_SSHD;
  assert.equal(accessDenied(s, ana, ip('10.0.0.10')), null);
  assert.match(accessDenied({ ...s, denyUsers: ['bob', 'a*'] }, ana, ip('10.0.0.10')) ?? '', /listed in DenyUsers/);
  assert.match(accessDenied({ ...s, allowUsers: ['admin'] }, ana, ip('10.0.0.10')) ?? '', /not listed in AllowUsers/);
  assert.equal(accessDenied({ ...s, allowUsers: ['admin', 'ana@10.0.0.*'] }, ana, ip('10.0.0.10')), null);
  assert.match(accessDenied({ ...s, allowUsers: ['ana@10.0.0.*'] }, ana, ip('172.16.0.1')) ?? '', /AllowUsers/);
  assert.match(accessDenied({ ...s, denyGroups: ['alumnos'] }, ana, ip('10.0.0.10')) ?? '', /DenyGroups/);
  assert.match(accessDenied({ ...s, allowGroups: ['sudo'] }, ana, ip('10.0.0.10')) ?? '', /AllowGroups/);
  assert.equal(rootRefused(s, 'root', 'password'), true, 'prohibit-password by default');
  assert.equal(rootRefused(s, 'root', 'publickey'), false);
  assert.equal(rootRefused({ ...s, permitRootLogin: 'no' }, 'root', 'publickey'), true);
  assert.equal(rootRefused({ ...s, permitRootLogin: 'yes' }, 'root', 'password'), false);
  assert.equal(rootRefused({ ...s, permitRootLogin: 'no' }, 'ana', 'password'), false);
});
