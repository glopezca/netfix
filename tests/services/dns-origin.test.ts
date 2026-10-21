/** DNS zone origin: '@', relative names completed with the origin and absolute names ending in '.'. */
import { zonesFromLegacy } from '../../src/services/dns-zones.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualify, effectiveRecords, validateName, displayName } from '../../src/services/dns-names.ts';
import { answerQuery, validateRecord } from '../../src/services/dns-service.ts';
import type { DnsRecord } from '../../src/services/config.ts';
import { servicesFromJson, servicesToJson } from '../../src/services/persist.ts';
import { defaultServices } from '../../src/services/config.ts';
import { Topology } from '../../src/net/topology.ts';
import { Server } from '../../src/devices/server.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Switch } from '../../src/devices/switch.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

const rec = (name: string, type: DnsRecord['type'], value: string, priority?: number): DnsRecord => ({ name, type, value, ttl: 3600, priority });

test('qualify follows BIND rules', () => {
  assert.equal(qualify('@', 'aula.lab'), 'aula.lab');
  assert.equal(qualify('www', 'aula.lab'), 'www.aula.lab');
  assert.equal(qualify('WWW.Sub', 'Aula.Lab.'), 'www.sub.aula.lab');
  assert.equal(qualify('www.otra.org.', 'aula.lab'), 'www.otra.org');
  assert.equal(qualify('srv.aula.lab', undefined), 'srv.aula.lab', 'no origin: legacy absolute');
  assert.equal(qualify('srv.aula.lab.', undefined), 'srv.aula.lab');
  assert.equal(qualify('@', undefined), null);
  assert.equal(qualify('@', ''), null);
});

test('effective records qualify owners and CNAME/MX/NS targets but not A/TXT values', () => {
  const recs = effectiveRecords({ origin: 'aula.lab', records: [
    rec('@', 'NS', 'srv'), rec('srv', 'A', '10.0.0.2'), rec('www', 'CNAME', 'srv'), rec('@', 'MX', 'mail.otra.org.', 10), rec('info', 'TXT', 'hola mundo'),
  ] });
  assert.deepEqual(recs.map((r) => [r.name, r.type, r.value]), [
    ['aula.lab', 'NS', 'srv.aula.lab'], ['srv.aula.lab', 'A', '10.0.0.2'], ['www.aula.lab', 'CNAME', 'srv.aula.lab'],
    ['aula.lab', 'MX', 'mail.otra.org'], ['info.aula.lab', 'TXT', 'hola mundo'],
  ]);
});

test('answers use the qualified names', () => {
  const recs = effectiveRecords({ origin: 'aula.lab.', records: [rec('srv', 'A', '10.0.0.2'), rec('www', 'CNAME', 'srv')] });
  const q = answerQuery({ id: 1, response: false, qname: 'www.aula.lab', qtype: 'A', rcode: 'NOERROR', answers: [] }, recs);
  assert.deepEqual(q.answers.map((a) => [a.name, a.type, a.data]), [['www.aula.lab', 'CNAME', 'srv.aula.lab'], ['srv.aula.lab', 'A', '10.0.0.2']]);
  const ptr = answerQuery({ id: 2, response: false, qname: '2.0.0.10.in-addr.arpa', qtype: 'PTR', rcode: 'NOERROR', answers: [] }, recs);
  assert.equal(ptr.answers[0]?.data, 'srv.aula.lab');
});

test('a short origin (one label) is still authoritative for its zone', () => {
  const recs = effectiveRecords({ origin: 'lab', records: [rec('www', 'A', '10.0.0.9')] });
  const ok = answerQuery({ id: 3, response: false, qname: 'www.lab', qtype: 'A', rcode: 'NOERROR', answers: [] }, recs, 'lab');
  assert.equal(ok.answers[0]?.data, '10.0.0.9');
  const nx = answerQuery({ id: 4, response: false, qname: 'nada.lab', qtype: 'A', rcode: 'NOERROR', answers: [] }, recs, 'lab');
  assert.equal(nx.rcode, 'NXDOMAIN');
});

test('validation accepts @, relative and absolute names; display shows the FQDN', () => {
  assert.equal(validateName('@', 'aula.lab'), null);
  assert.equal(validateName('www', 'aula.lab'), null);
  assert.equal(validateName('www.otra.org.', 'aula.lab'), null);
  assert.match(validateName('@', undefined) ?? '', /origen/);
  assert.match(validateName('a..b', 'aula.lab') ?? '', /no válido/);
  assert.match(validateName('.www', 'aula.lab') ?? '', /no válido/);
  assert.equal(validateRecord(rec('@', 'MX', 'srv', 10), 'aula.lab'), null);
  assert.equal(validateRecord(rec('www', 'CNAME', 'srv.aula.lab.'), 'aula.lab'), null);
  assert.match(validateRecord(rec('@', 'A', '10.0.0.1'), undefined) ?? '', /origen/);
  assert.equal(displayName('www', 'aula.lab'), 'www.aula.lab.');
  assert.equal(displayName('@', 'aula.lab'), 'aula.lab.');
  assert.equal(displayName('x.org.', 'aula.lab'), 'x.org.');
});

test('zones are saved in JSON and files of Netfix ≤ 0.11 (origin + records) are converted', () => {
  const s = { ...defaultServices(), dns: { enabled: true, zones: zonesFromLegacy('aula.lab', [rec('www', 'A', '10.0.0.9')]) } };
  const back = servicesFromJson(JSON.parse(JSON.stringify(servicesToJson(s))));
  assert.deepEqual(back.dns.zones, s.dns.zones);
  const legacy = servicesFromJson({ ...servicesToJson(s), dns: { enabled: true, records: [rec('www.aula.lab', 'A', '10.0.0.9')] } });
  assert.deepEqual(legacy.dns.zones.map((z) => z.name), ['aula.lab']);
  assert.deepEqual(legacy.dns.zones[0]?.records.map((r) => r.name), ['www']);
  assert.throws(() => servicesFromJson({ ...servicesToJson(s), dns: { enabled: true, origin: 'mal..origen', records: [] } }), /origen/i);
});

test('end to end: dig resolves relative records and the zone file shows $ORIGIN', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  srv.setServices({ ...srv.services, dns: { enabled: true, zones: zonesFromLegacy('aula.lab', [rec('@', 'NS', 'srv'), rec('srv', 'A', '10.0.0.2'), rec('www', 'CNAME', 'srv'), rec('@', 'MX', 'srv', 10)]) } });
  t.settle();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('dig +short www.aula.lab'), ['srv.aula.lab.', '10.0.0.2']);
  assert.deepEqual(sh.run('dig +short aula.lab MX'), ['10 srv.aula.lab.']);
  const zone = createShell(srv, 'linux').run('cat /etc/bind/db.aula.lab').join('\n');
  assert.match(zone, /^\$ORIGIN aula\.lab\.$/m);
  assert.match(zone, /^www +3600 +IN +CNAME +srv$/m);
  assert.match(zone, /^@ +3600 +IN +MX +10 srv$/m);
});
