import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amlAllows, amlText, expandAcls, parseAml } from '../../src/services/dns-aml.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? -1;
// A Linux router: WAN eth0 10.0.2.15/24, LAN eth1 192.168.0.254/24, a NIC with no address.
const NICS = [{ ip: ip('10.0.2.15'), prefix: 24 }, { ip: ip('192.168.0.254'), prefix: 24 }, {}];
const allows = (text: string, client: string): boolean => {
  const list = parseAml(text);
  if (!Array.isArray(list)) throw new Error(String(list));
  return amlAllows(list, ip(client), NICS);
};

test('localnets is every network of every interface (and 127/8), not only the first one', () => {
  assert.equal(allows('localnets', '192.168.0.16'), true, 'LAN client of eth1');
  assert.equal(allows('localnets', '10.0.2.99'), true, 'WAN subnet of eth0');
  assert.equal(allows('localnets', '127.0.0.1'), true);
  assert.equal(allows('localnets', '8.8.8.8'), false);
});

test('localhost is the server own addresses; a network matches its clients', () => {
  assert.equal(allows('localhost', '192.168.0.254'), true);
  assert.equal(allows('localhost', '192.168.0.16'), false);
  assert.equal(allows('192.168.0.0/24; localhost', '192.168.0.16'), true);
  assert.equal(allows('192.168.0.0/24', '192.168.1.16'), false);
  assert.equal(allows('192.168/16', '192.168.7.1'), true, 'BIND short form');
  assert.equal(allows('192.168.0.16', '192.168.0.16'), true, 'a single host');
});

test('first match decides: a negated element refuses; no match refuses; any and none', () => {
  assert.equal(allows('!192.168.0.16; 192.168.0.0/24', '192.168.0.16'), false);
  assert.equal(allows('!192.168.0.16; 192.168.0.0/24', '192.168.0.17'), true);
  assert.equal(allows('192.168.0.0/24; !192.168.0.16', '192.168.0.16'), true, 'the network came first');
  assert.equal(allows('! 192.168.0.16; any', '192.168.0.16'), false, '"! x" as BIND writes it');
  assert.equal(allows('any', '8.8.8.8'), true);
  assert.equal(allows('none', '127.0.0.1'), false);
  assert.equal(allows('', '127.0.0.1'), false, 'an empty list allows nobody');
});

test('parseAml accepts ; , and spaces, keeps order, and rejects what is not an element', () => {
  assert.deepEqual(parseAml('localnets; localhost'), ['localnets', 'localhost']);
  assert.deepEqual(parseAml(' 192.168.0.0/24 , LOCALHOST ;'), ['192.168.0.0/24', 'localhost']);
  for (const bad of ['192.168.0.0/33', '300.1.1.1', 'lan', '!', '10.0.0.0/x']) {
    assert.ok(!Array.isArray(parseAml(bad)), bad);
  }
  assert.equal(amlText(['192.168.0.0/24', '!10.0.0.1', 'localhost']), '192.168.0.0/24; !10.0.0.1; localhost');
});

test('acl names from the same file expand in place (a negated acl negates its elements)', () => {
  const acls = new Map([['lan', ['192.168.0.0/24', 'localhost']], ['malos', ['192.168.0.66']]]);
  assert.deepEqual(expandAcls(['!malos', 'lan'], acls), ['!192.168.0.66', '192.168.0.0/24', 'localhost']);
  assert.deepEqual(expandAcls(['lan', 'nada'], acls), ['192.168.0.0/24', 'localhost', 'none'], 'unknown: matches nobody');
  const loop = new Map([['a', ['b']], ['b', ['a']]]);
  assert.deepEqual(expandAcls(['a'], loop), ['none'], 'a loop ends');
  // Nested acls of 32 names each would be 32^8 elements: the expansion stops, and the list is refused.
  const wide = (next: string): string[] => Array.from({ length: 32 }, () => next);
  const bomb = new Map(Array.from({ length: 8 }, (_, i) => [`a${i}`, wide(i < 7 ? `a${i + 1}` : '10.0.0.1')] as [string, string[]]));
  const out = expandAcls(['a0'], bomb);
  assert.ok(out.length <= 33, `stopped at ${out.length}`);
  assert.ok(!Array.isArray(parseAml(out.join(';'))), 'too many elements: refused');
  // Empty acls push nothing: 1000 references per level, 7 levels deep, must still end at once and be refused.
  const empty = new Map<string, string[]>([['e', []], ...Array.from({ length: 7 }, (_, i) => [`b${i}`, Array.from({ length: 1000 }, () => (i ? `b${i - 1}` : 'e'))] as [string, string[]])]);
  const t0 = Date.now();
  const none = expandAcls(['b6'], empty);
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  assert.ok(!Array.isArray(parseAml(none.join(';'))), 'out of budget: refused, not used in part');
  assert.deepEqual(expandAcls(['e', 'localhost'], empty), ['localhost'], 'an empty acl adds nothing');
});
