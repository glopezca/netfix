import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMac, formatMacCisco, formatMacPT, parseHexId, formatHexId,
  clientIdFromMac, asciiToHex, macFromSeed,
} from '../../src/core/mac.ts';

test('parseMac accepts Cisco, colon, dash and bare formats', () => {
  assert.equal(parseMac('0011.2233.4455'), '001122334455');
  assert.equal(parseMac('00:11:22:33:44:AA'), '0011223344aa');
  assert.equal(parseMac('00-11-22-33-44-55'), '001122334455');
  assert.equal(parseMac('001122334455'), '001122334455');
  assert.equal(parseMac('0011.2233.445'), null);
  assert.equal(parseMac('zz11.2233.4455'), null);
});

test('formats MAC addresses the IOS and Packet Tracer way', () => {
  assert.equal(formatMacCisco('0001645a2b97'), '0001.645a.2b97');
  assert.equal(formatMacPT('0001645a2b97'), '0001.645A.2B97');
});

test('client identifiers are dotted hex groups of four', () => {
  assert.equal(parseHexId('0100.1122.3344.55'), '01001122334455');
  assert.equal(parseHexId('01:00:11'), '010011');
  assert.equal(parseHexId('0100.11g2'), null);
  assert.equal(parseHexId('abc'), null);
  assert.equal(formatHexId('01001122334455'), '0100.1122.3344.55');
  assert.equal(clientIdFromMac('001122334455'), '01001122334455');
});

test('asciiToHex encodes text for ascii client-ids', () => {
  assert.equal(asciiToHex('cisco'), '636973636f');
});

test('macFromSeed is deterministic and unicast', () => {
  const a = macFromSeed(42);
  assert.equal(a, macFromSeed(42));
  assert.notEqual(a, macFromSeed(43));
  assert.equal(parseInt(a.slice(0, 2), 16) & 1, 0);
  assert.equal(a.length, 12);
});
