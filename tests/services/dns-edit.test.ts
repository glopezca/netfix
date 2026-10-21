/** Editing bind9 by mode and the zone wizard (SOA → NS → kind → records), shared by the Services tab and the web GUI. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DnsSettings } from '../../src/services/config.ts';
import {
  addRecord, addZone, dnsModes, draftStep, removeRecord, removeZone, setAuthoritative, setCache, setForwarders, setIterative, setRecursion,
  setZoneNs, ymdOf,
} from '../../src/services/dns-edit.ts';
import type { ZoneDraft } from '../../src/services/dns-edit.ts';
import { parseIp } from '../../src/core/ip.ts';

const base: DnsSettings = { enabled: true, zones: [] };
const ok = (r: DnsSettings | { error: string }): DnsSettings => {
  if ('error' in r) throw new Error(r.error);
  return r;
};
const DAY = 20261021;
const draft: ZoneDraft = { name: 'aula.lab', mname: 'ns.aula.lab', email: 'admin@aula.lab', refresh: '604800', retry: '86400', expire: '2419200', minimum: '3600', ns: '', kind: 'forward' };

test('modes: iterative follows recursion and forward only/first, and says why when it cannot change', () => {
  let s = base;
  assert.deepEqual(dnsModes(s).recursive, { on: false });
  assert.equal(dnsModes(s).iterative.on, false);
  assert.match(dnsModes(s).iterative.locked ?? '', /Recursivo/);
  s = ok(setRecursion(s, true, 'localnets'));
  assert.equal(dnsModes(s).iterative.on, true);
  assert.match(dnsModes(s).iterative.locked ?? '', /reenviadores/, 'without forwarders recursion always iterates');
  assert.ok('error' in setIterative(s, false));
  s = ok(setForwarders(s, '8.8.8.8, 8.8.4.4'));
  assert.equal(dnsModes(s).forwarder.on, true);
  assert.equal(dnsModes(s).iterative.on, false, 'forward only by default');
  assert.equal(dnsModes(s).iterative.locked, undefined);
  s = ok(setIterative(s, true));
  assert.equal(s.forwardOnly, false);
  assert.match(('error' in setForwarders(s, '8.8.8.8, nada') ? setForwarders(s, '8.8.8.8, nada') : { error: '' }).error, /nada/);
  s = ok(setForwarders(s, ''));
  assert.equal(dnsModes(s).forwarder.on, false);
  assert.deepEqual(s.forwarders, []);
});

test('cache: on keeps answers for up to max-cache-ttl, off is max-cache-ttl 0', () => {
  let s = ok(setCache(base, true, '3600'));
  assert.equal(s.maxCacheTtl, 3600);
  assert.equal(dnsModes(s).cache.on, true);
  s = ok(setCache(s, false));
  assert.equal(s.maxCacheTtl, 0);
  assert.equal(dnsModes(s).cache.on, false);
  assert.equal(ok(setCache(s, true)).maxCacheTtl, 604800, 'turning it on again uses BIND\'s week');
  assert.ok('error' in setCache(s, true, '-5'));
  assert.equal(ok(setAuthoritative(s, false)).authoritative, false);
});

test('the zone wizard goes SOA → NS → kind; each step validates only what it asks', () => {
  assert.equal(draftStep({ ...draft }, 1), null);
  assert.match(draftStep({ ...draft, name: 'mal..zona' }, 1) ?? '', /zona/i);
  assert.match(draftStep({ ...draft, email: 'sin-arroba' }, 1) ?? '', /correo|mailbox/i);
  assert.match(draftStep({ ...draft, refresh: 'x' }, 1) ?? '', /SOA/);
  assert.match(draftStep({ ...draft, ns: '' }, 2) ?? '', /NS/);
  assert.equal(draftStep({ ...draft, ns: 'ns.aula.lab, ns2.otro.es' }, 2), null);
  assert.match(draftStep({ ...draft, ns: 'ns.aula.lab', kind: 'reverse' }, 3) ?? '', /in-addr\.arpa/);
  const s = ok(addZone(base, { ...draft, ns: 'ns.aula.lab, ns2.otro.es' }, DAY));
  assert.deepEqual(s.zones[0]?.ns, ['ns.aula.lab', 'ns2.otro.es']);
  assert.equal(s.zones[0]?.soa.rname, 'admin.aula.lab');
  assert.equal(s.zones[0]?.soa.serial, 2026102101);
  // A reverse zone may be typed as its network.
  const r = ok(addZone(s, { ...draft, name: '192.168.1', kind: 'reverse', ns: 'ns.aula.lab' }, DAY));
  assert.equal(r.zones[1]?.name, '1.168.192.in-addr.arpa');
  assert.ok('error' in addZone(r, { ...draft, ns: 'ns.aula.lab' }, DAY), 'the same zone twice');
  assert.deepEqual(ok(removeZone(r, 'aula.lab')).zones.map((z) => z.name), ['1.168.192.in-addr.arpa']);
});

test('records: only the types of the zone kind, validated, and every change raises the serial', () => {
  let s = ok(addZone(base, { ...draft, ns: 'ns.aula.lab' }, DAY));
  s = ok(addRecord(s, 'aula.lab', { name: 'ns', type: 'A', value: '192.168.1.2', ttl: 86400 }, DAY));
  assert.equal(s.zones[0]?.soa.serial, 2026102102);
  assert.match(('error' in addRecord(s, 'aula.lab', { name: '2', type: 'PTR', value: 'ns.aula.lab.', ttl: 60 }, DAY) ? addRecord(s, 'aula.lab', { name: '2', type: 'PTR', value: 'ns.aula.lab.', ttl: 60 }, DAY) : { error: '' }).error, /PTR/);
  assert.ok('error' in addRecord(s, 'aula.lab', { name: 'www', type: 'A', value: '999.1.1.1', ttl: 60 }, DAY));
  assert.ok('error' in addRecord(s, 'nohay.lab', { name: 'www', type: 'A', value: '10.0.0.1', ttl: 60 }, DAY));
  s = ok(removeRecord(s, 'aula.lab', 0, 20261022));
  assert.deepEqual(s.zones[0]?.records, []);
  assert.equal(s.zones[0]?.soa.serial, 2026102201, 'a new day starts at 01');
  s = ok(setZoneNs(s, 'aula.lab', 'ns.aula.lab ns2.aula.lab', DAY));
  assert.deepEqual(s.zones[0]?.ns, ['ns.aula.lab', 'ns2.aula.lab']);
  assert.ok('error' in setZoneNs(s, 'aula.lab', '', DAY));
  assert.equal(ymdOf(Date.UTC(2026, 9, 21, 12)), DAY);
  assert.deepEqual(ok(setRecursion(s, true, 'any')).allowRecursion, 'any');
  assert.deepEqual(ok(setForwarders(s, '1.1.1.1')).forwarders, [parseIp('1.1.1.1')]);
});

test('review: a network typed at step 1 is fine; NS lists longer than a name survive the wizard', () => {
  assert.equal(draftStep({ ...draft, name: '192.168.1', kind: 'forward' }, 1), null);
  const long = Array.from({ length: 6 }, (_, i) => `servidor-de-nombres-${i}.departamento.instituto.aula.lab`).join(', ');
  const s = ok(addZone(base, { ...draft, ns: long }, DAY));
  assert.equal(s.zones[0]?.ns.length, 6);
  assert.ok('error' in removeRecord(s, 'aula.lab', Number.NaN, DAY));
});
