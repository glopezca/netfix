import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIp, formatIp, parseMask, prefixToMask, networkOf, broadcastOf,
  inSubnet, classfulPrefix, parseIpWithMask, formatMask, isUsableHost,
} from '../../src/core/ip.ts';

test('parseIp accepts dotted quads and rejects garbage', () => {
  assert.equal(parseIp('192.168.1.1'), 0xc0a80101);
  assert.equal(parseIp('0.0.0.0'), 0);
  assert.equal(parseIp('255.255.255.255'), 0xffffffff);
  assert.equal(parseIp('256.1.1.1'), null);
  assert.equal(parseIp('1.2.3'), null);
  assert.equal(parseIp('1.2.3.4.5'), null);
  assert.equal(parseIp('a.b.c.d'), null);
  assert.equal(parseIp(''), null);
  assert.equal(parseIp('01.2.3.4x'), null);
});

test('formatIp round-trips', () => {
  assert.equal(formatIp(0xc0a80101), '192.168.1.1');
  assert.equal(formatIp(0xffffffff), '255.255.255.255');
});

test('parseMask accepts contiguous dotted masks and /prefix', () => {
  assert.equal(parseMask('255.255.255.0'), 24);
  assert.equal(parseMask('/27'), 27);
  assert.equal(parseMask('255.255.255.255'), 32);
  assert.equal(parseMask('0.0.0.0'), 0);
  assert.equal(parseMask('255.0.255.0'), null);
  assert.equal(parseMask('/33'), null);
  assert.equal(parseMask('/x'), null);
});

test('network and broadcast math', () => {
  const ip = parseIp('10.1.2.130')!;
  assert.equal(formatIp(networkOf(ip, 25)), '10.1.2.128');
  assert.equal(formatIp(broadcastOf(ip, 25)), '10.1.2.255');
  assert.equal(formatIp(prefixToMask(20)), '255.255.240.0');
  assert.equal(formatMask(0), '0.0.0.0');
  assert.equal(inSubnet(ip, parseIp('10.1.2.128')!, 25), true);
  assert.equal(inSubnet(ip, parseIp('10.1.2.0')!, 25), false);
});

test('classfulPrefix follows class A/B/C', () => {
  assert.equal(classfulPrefix(parseIp('10.0.0.1')!), 8);
  assert.equal(classfulPrefix(parseIp('172.16.0.1')!), 16);
  assert.equal(classfulPrefix(parseIp('192.168.0.1')!), 24);
  assert.equal(classfulPrefix(parseIp('224.0.0.1')!), 32);
});

test('parseIpWithMask handles separate or slash forms', () => {
  assert.deepEqual(parseIpWithMask('192.168.1.0', '255.255.255.0'), { ip: 0xc0a80100, prefix: 24 });
  assert.deepEqual(parseIpWithMask('192.168.1.0', '/24'), { ip: 0xc0a80100, prefix: 24 });
  assert.equal(parseIpWithMask('192.168.1.0', 'bad'), null);
});

test('isUsableHost excludes network and broadcast', () => {
  const net = parseIp('192.168.1.0')!;
  assert.equal(isUsableHost(net, 24), false);
  assert.equal(isUsableHost(parseIp('192.168.1.255')!, 24), false);
  assert.equal(isUsableHost(parseIp('192.168.1.7')!, 24), true);
  assert.equal(isUsableHost(parseIp('192.168.1.7')!, 32), true);
});
