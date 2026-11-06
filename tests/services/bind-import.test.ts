/**
 * The BIND files (named.conf.local, named.conf.options, the db.* zones), already checked as named does, into Netfix's
 * DNS model: one zone per primary zone declared, its SOA, NS and the records the model knows. A zone that failed to
 * load is left unloaded at start (it answers SERVFAIL) and keeps the version it had at a reload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importBind, zoneFromRecords } from '../../src/services/bind-import.ts';
import type { BindRead, ZoneResult } from '../../src/services/bind-import.ts';
import { checkZone } from '../../src/services/zone-check.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import type { DnsSettings, DnsZone } from '../../src/services/config.ts';
import { RPZ_ZONE } from '../../src/services/dns-rpz.ts';
import { parseIp } from '../../src/core/ip.ts';

const ZONE = `$TTL 3600
@     IN SOA ns1.aula.lab. jefe.aula.lab. ( 2026110601 7200 900 1209600 300 )
      IN NS  ns1
      IN NS  ns2.otra.lab.
ns1   IN A   192.168.10.2
www   600 IN A 192.168.10.80
web   IN CNAME www
@     IN MX  5 correo.aula.lab.
correo IN A  192.168.10.25
@     IN TXT "v=spf1 mx" " -all"
pc    IN AAAA 2001:db8::1
sub   IN NS  ns.sub
ns.sub IN A  192.168.10.3
`;

const loaded = (name: string, text: string, generated = false): ZoneResult => {
  const r = checkZone(name, `/etc/bind/db.${name}`, text);
  return { name, ok: r.ok, records: r.records, generated };
};
const failed = (name: string): ZoneResult => ({ name, ok: false, records: [], generated: false });

const MODEL: DnsZone = { ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [{ name: 'viejo', type: 'A', value: '10.0.0.9', ttl: 3600 }] };
const DNS: DnsSettings = { enabled: true, zones: [MODEL], recursion: true };
const read = (zones: readonly ZoneResult[], extra: Partial<BindRead> = {}): BindRead => ({ zones, ...extra });

test('a zone file into the model: SOA, NS, owners relative to the zone, targets absolute, MX and TXT', () => {
  const z = zoneFromRecords('aula.lab', loaded('aula.lab', ZONE).records);
  assert.deepEqual(z?.soa, { mname: 'ns1.aula.lab', rname: 'jefe.aula.lab', serial: 2026110601, refresh: 7200, retry: 900, expire: 1209600, minimum: 300 });
  assert.deepEqual(z?.ns, ['ns1.aula.lab', 'ns2.otra.lab']);
  assert.equal(z?.kind, 'forward');
  assert.deepEqual(z?.records, [
    { name: 'ns1', type: 'A', value: '192.168.10.2', ttl: 3600 },
    { name: 'www', type: 'A', value: '192.168.10.80', ttl: 600 },
    { name: 'web', type: 'CNAME', value: 'www.aula.lab.', ttl: 3600 },
    { name: '@', type: 'MX', value: 'correo.aula.lab.', priority: 5, ttl: 3600 },
    { name: 'correo', type: 'A', value: '192.168.10.25', ttl: 3600 },
    { name: '@', type: 'TXT', value: 'v=spf1 mx -all', ttl: 3600 },
    { name: 'sub', type: 'NS', value: 'ns.sub.aula.lab.', ttl: 3600 },
    { name: 'ns.sub', type: 'A', value: '192.168.10.3', ttl: 3600 },
  ], 'AAAA is a type the model does not have');
});

test('a reverse zone keeps only its PTR; a TXT keeps its quotes and backslashes as text', () => {
  const rev = zoneFromRecords('10.168.192.in-addr.arpa', loaded('10.168.192.in-addr.arpa', `$TTL 60
@ IN SOA ns.aula.lab. admin.aula.lab. 1 2 3 4 5
@ IN NS ns.aula.lab.
2 IN PTR ns.aula.lab.
3 IN A 10.0.0.1
`).records);
  assert.equal(rev?.kind, 'reverse');
  assert.deepEqual(rev?.records, [{ name: '2', type: 'PTR', value: 'ns.aula.lab.', ttl: 60 }]);
  const txt = zoneFromRecords('aula.lab', loaded('aula.lab', `$TTL 60
@ IN SOA ns.aula.lab. admin.aula.lab. 1 2 3 4 5
@ IN NS ns.aula.lab.
ns IN A 10.0.0.2
t IN TXT "a \\"b\\" c\\\\d"
`).records);
  assert.equal(txt?.records.find((r) => r.type === 'TXT')?.value, 'a "b" c\\d');
});

test('a zone the model cannot hold gives nothing: a name unsafe for a file, an SOA out of range', () => {
  assert.equal(zoneFromRecords('a b', []), undefined);
  assert.equal(zoneFromRecords('aula.lab', []), undefined, 'no SOA');
  const records = loaded('aula.lab', ZONE).records;
  const many = Array.from({ length: 600 }, (_, i) => `h${i} IN A 10.0.${Math.floor(i / 250)}.${i % 250}`).join('\n');
  assert.equal(zoneFromRecords('aula.lab', loaded('aula.lab', `${ZONE}${many}\n`).records)?.records.length, 500);
  assert.ok(records.length > 0);
});

test('the declared zones replace the model; the default zones and the policy zone are not zones of the model', () => {
  const s = importBind(DNS, read([
    loaded('localhost', '$TTL 1\n@ IN SOA localhost. root.localhost. 1 2 3 4 5\n@ IN NS localhost.\n@ IN A 127.0.0.1\n'),
    loaded('127.in-addr.arpa', '$TTL 1\n@ IN SOA localhost. root.localhost. 1 2 3 4 5\n@ IN NS localhost.\n'),
    loaded('aula.lab', ZONE),
    loaded('otra.lab', '$TTL 1\n@ IN SOA ns.otra.lab. a.otra.lab. 1 2 3 4 5\n@ IN NS ns.otra.lab.\nns IN A 10.0.0.1\n'),
    loaded(RPZ_ZONE, '$TTL 1\n@ IN SOA localhost. root.localhost. 1 2 3 4 5\n@ IN NS localhost.\n'),
  ]), 'start');
  assert.deepEqual(s.zones.map((z) => z.name), ['aula.lab', 'otra.lab']);
  assert.equal(s.zones[0]?.records.some((r) => r.name === 'viejo'), false);
  assert.equal(s.unloaded, undefined);
  assert.equal(s.recursion, true, 'named.conf.options was not edited: the options stay');
});

test('a zone that fails at start is unloaded; at a reload it keeps the version it had', () => {
  const start = importBind(DNS, read([failed('aula.lab'), failed('nueva.lab')]), 'start');
  assert.deepEqual(start.unloaded, ['aula.lab', 'nueva.lab']);
  assert.deepEqual(start.zones, [MODEL], 'the model keeps what it had (it is not served)');
  const reload = importBind(DNS, read([failed('aula.lab')]), 'reload');
  assert.equal(reload.unloaded, undefined, 'it was loaded: named keeps serving the old version');
  assert.deepEqual(reload.zones, [MODEL]);
  const still = importBind({ ...DNS, unloaded: ['aula.lab'] }, read([failed('aula.lab')]), 'reload');
  assert.deepEqual(still.unloaded, ['aula.lab'], 'it was not loaded: it stays so');
  const fixed = importBind({ ...DNS, unloaded: ['aula.lab'] }, read([loaded('aula.lab', ZONE)]), 'reload');
  assert.equal(fixed.unloaded, undefined);
});

test('a zone file still generated keeps the model zone; a generated automatic reverse zone is left to Netfix', () => {
  const s = importBind(DNS, read([
    loaded('aula.lab', '$TTL 1\n@ IN SOA ns.aula.lab. admin.aula.lab. 1 2 3 4 5\n@ IN NS ns.aula.lab.\n', true),
    loaded('0.0.10.in-addr.arpa', '$TTL 1\n@ IN SOA ns.aula.lab. admin.aula.lab. 1 2 3 4 5\n@ IN NS ns.aula.lab.\n', true),
  ]), 'start');
  assert.deepEqual(s.zones, [MODEL]);
});

test('no zone declared: not authoritative (the zones are kept); one declared again: authoritative', () => {
  const none = importBind(DNS, read([]), 'start');
  assert.equal(none.authoritative, false);
  assert.deepEqual(none.zones, [MODEL]);
  const back = importBind(none, read([loaded('aula.lab', ZONE)]), 'start');
  assert.equal(back.authoritative, undefined);
  assert.equal(back.zones.length, 1);
});

test('named.conf.options edited: the options it describes; the policy list from its edited file', () => {
  const options = 'options {\n\tdirectory "/var/cache/bind";\n\trecursion no;\n\tforwarders { 9.9.9.9; };\n\tresponse-policy { zone "rpz.publicos"; };\n};\n';
  const rpz = '$TTL 60\n@ IN SOA localhost. root.localhost. 1 2 3 4 5\n@ IN NS localhost.\nintranet IN A 10.1.1.1\n';
  const s = importBind(DNS, read([loaded(RPZ_ZONE, rpz)], { options, rpz }), 'start');
  assert.equal(s.recursion, false);
  assert.deepEqual(s.forwarders, [parseIp('9.9.9.9')]);
  assert.equal(s.publicNames?.enabled, true);
  assert.deepEqual(s.publicNames?.entries?.map((e) => e.name), ['intranet']);
  const bad = importBind(DNS, read([failed(RPZ_ZONE)], { rpz: 'zz' }), 'start');
  assert.deepEqual(bad.unloaded, [RPZ_ZONE], 'a policy zone that did not load is not applied');
  assert.equal(bad.publicNames, undefined);
});

test('the same zone twice and the zone cap: the first ones, up to 64', () => {
  const twice = importBind(DNS, read([loaded('aula.lab', ZONE), loaded('aula.lab', ZONE)]), 'start');
  assert.equal(twice.zones.length, 1);
  const soa = (n: string): string => `$TTL 1\n@ IN SOA ns.${n}. a.${n}. 1 2 3 4 5\n@ IN NS ns.${n}.\nns IN A 10.0.0.1\n`;
  const many = Array.from({ length: 70 }, (_, i) => loaded(`z${i}.lab`, soa(`z${i}.lab`)));
  assert.equal(importBind(DNS, read(many), 'start').zones.length, 64);
});
