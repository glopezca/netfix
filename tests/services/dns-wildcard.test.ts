/** `@` in every field and wildcard records (`*`), with BIND/RFC 4592 semantics. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRecords, validateName } from '../../src/services/dns-names.ts';
import { answerQuery, validateRecord } from '../../src/services/dns-service.ts';
import type { DnsRecord } from '../../src/services/config.ts';
import type { DnsType } from '../../src/net/packets.ts';

const rec = (name: string, type: DnsRecord['type'], value: string, priority?: number): DnsRecord => ({ name, type, value, ttl: 3600, priority });
const ORIGIN = 'aula.lab';
const ZONE = effectiveRecords({ origin: ORIGIN, records: [
  rec('@', 'NS', '@'), rec('@', 'A', '10.0.0.1'), rec('@', 'MX', '@', 10), rec('srv', 'A', '10.0.0.2'),
  rec('*', 'A', '10.0.0.80'), rec('*', 'MX', 'srv', 20), rec('*.dev', 'CNAME', 'srv'), rec('a.b.c', 'A', '10.0.0.7'),
] });
const ask = (qname: string, qtype: DnsType = 'A'): ReturnType<typeof answerQuery> =>
  answerQuery({ id: 1, response: false, qname, qtype }, ZONE, ORIGIN);
const rows = (m: ReturnType<typeof answerQuery>): string[][] => (m.answers ?? []).map((a) => [a.name, a.type, a.data]);

test('@ is the zone origin in owners and in CNAME, MX and NS values', () => {
  assert.deepEqual(rows(ask('aula.lab', 'NS')), [['aula.lab', 'NS', 'aula.lab']]);
  assert.deepEqual(rows(ask('aula.lab', 'MX')), [['aula.lab', 'MX', 'aula.lab']]);
  assert.equal(validateRecord(rec('www', 'CNAME', '@'), ORIGIN), null);
  assert.equal(validateRecord(rec('@', 'NS', '@'), ORIGIN), null);
});

test('a wildcard answers any name that does not exist, with the queried name as owner', () => {
  const r = ask('cualquiera.aula.lab');
  assert.equal(r.rcode, 'NOERROR');
  assert.equal(r.authoritative, true);
  assert.deepEqual(rows(r), [['cualquiera.aula.lab', 'A', '10.0.0.80']]);
  assert.deepEqual(rows(ask('x.y.aula.lab')), [['x.y.aula.lab', 'A', '10.0.0.80']], 'several labels below the closest encloser');
  assert.deepEqual(rows(ask('otra.aula.lab', 'MX')), [['otra.aula.lab', 'MX', 'srv.aula.lab']]);
});

test('existing names, empty non-terminals and names below other nodes do not use the wildcard', () => {
  assert.deepEqual(rows(ask('srv.aula.lab')), [['srv.aula.lab', 'A', '10.0.0.2']]);
  const nodata = ask('srv.aula.lab', 'TXT');
  assert.equal(nodata.rcode, 'NOERROR');
  assert.deepEqual(rows(nodata), []);
  const ent = ask('b.c.aula.lab');
  assert.equal(ent.rcode, 'NOERROR', 'b.c.aula.lab exists as an empty non-terminal');
  assert.deepEqual(rows(ent), []);
  const below = ask('x.srv.aula.lab');
  assert.equal(below.rcode, 'NXDOMAIN', 'the closest encloser srv.aula.lab has no wildcard');
});

test('a wildcard CNAME is synthesised and followed', () => {
  assert.deepEqual(rows(ask('app.dev.aula.lab')), [['app.dev.aula.lab', 'CNAME', 'srv.aula.lab'], ['srv.aula.lab', 'A', '10.0.0.2']]);
});

test('the wildcard record itself and other zones', () => {
  assert.deepEqual(rows(ask('*.aula.lab')), [['*.aula.lab', 'A', '10.0.0.80']]);
  assert.equal(ask('www.otra.org').rcode, 'REFUSED');
  const ptr = answerQuery({ id: 2, response: false, qname: '80.0.0.10.in-addr.arpa', qtype: 'PTR' }, ZONE, ORIGIN);
  assert.equal(ptr.rcode, 'NXDOMAIN', 'no PTR is generated for wildcard owners');
});

test('validation: * only as the leftmost label of an owner, never as a value', () => {
  assert.equal(validateName('*', ORIGIN), null);
  assert.equal(validateName('*.dev', ORIGIN), null);
  assert.equal(validateName('*.aula.lab.', ORIGIN), null);
  assert.match(validateName('www.*', ORIGIN) ?? '', /\*/);
  assert.match(validateName('a*b', ORIGIN) ?? '', /no válido/);
  assert.match(validateRecord(rec('www', 'CNAME', '*.dev'), ORIGIN) ?? '', /comodín/);
});

test('end to end: dig and nslookup resolve through a wildcard', async () => {
  const { Topology } = await import('../../src/net/topology.ts');
  const { createShell } = await import('../../src/shells/factory.ts');
  const { parseIp } = await import('../../src/core/ip.ts');
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as import('../../src/devices/server.ts').Server;
  const pc = t.add('pc', 0, 0).device as import('../../src/devices/pc.ts').Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  srv.setServices({ ...srv.services, dns: { enabled: true, origin: ORIGIN, records: [rec('@', 'NS', '@'), rec('@', 'A', '10.0.0.2'), rec('*', 'CNAME', '@')] } });
  t.settle();
  assert.deepEqual(createShell(pc, 'linux').run('dig +short loquesea.aula.lab'), ['aula.lab.', '10.0.0.2']);
  assert.match(createShell(srv, 'linux').run('cat /etc/bind/db.aula.lab').join('\n'), /^\* +3600 +IN +CNAME +@$/m);
});
