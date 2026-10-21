/**
 * DNS zones as BIND loads them: SOA, NS, forward or reverse kind, the records each kind admits, the reverse zones
 * generated from the A records of forward zones, and the conversion of the old single-origin settings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DnsRecord, DnsZone } from '../../src/services/config.ts';
import {
  autoReverseZones, defaultSoa, emailToRname, newZone, nextSerial, recordTypesFor, reverseZoneName, rnameToEmail,
  servedZones, soaText, validateZone, zoneProblems, zoneRecords, zonesFromLegacy,
} from '../../src/services/dns-zones.ts';
import { answerFromZones } from '../../src/services/dns-service.ts';
import { validateRecord } from '../../src/services/dns-service.ts';

const rec = (name: string, type: DnsRecord['type'], value: string, priority?: number): DnsRecord => ({ name, type, value, ttl: 3600, ...(priority !== undefined ? { priority } : {}) });
const q = (qname: string, qtype: 'A' | 'PTR' | 'SOA' | 'NS' | 'MX' = 'A') => ({ id: 7, response: false, qname, qtype, rd: true } as const);

const aula: DnsZone = { ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [rec('ns', 'A', '192.168.1.2'), rec('www', 'A', '192.168.1.10'), rec('db', 'A', '10.0.0.5'), rec('*', 'A', '192.168.1.99'), rec('web', 'CNAME', 'www')] };

test('a new zone starts with its SOA (primary server, responsible mailbox, timers) and the NS list', () => {
  const z = newZone('aula.lab', 'forward', ['ns.aula.lab']);
  assert.deepEqual(z.soa, defaultSoa('aula.lab'));
  assert.equal(z.soa.mname, 'ns.aula.lab');
  assert.equal(z.soa.rname, 'admin.aula.lab');
  assert.equal(soaText(z.soa), `ns.aula.lab. admin.aula.lab. ${z.soa.serial} 604800 86400 2419200 3600`);
  assert.equal(emailToRname('hostmaster@aula.lab'), 'hostmaster.aula.lab');
  assert.equal(emailToRname('jose.luis@aula.lab'), 'jose\\.luis.aula.lab', 'a dot in the local part is escaped, as in BIND');
  assert.equal(rnameToEmail('jose\\.luis.aula.lab'), 'jose.luis@aula.lab');
  assert.equal(nextSerial(2026102101, 20261021), 2026102102);
  assert.equal(nextSerial(2026101105, 20261021), 2026102101, 'a new day starts again at 01');
});

test('a forward zone admits A, CNAME, MX, NS and TXT; a reverse zone only PTR', () => {
  assert.deepEqual(recordTypesFor('forward'), ['A', 'CNAME', 'MX', 'NS', 'TXT']);
  assert.deepEqual(recordTypesFor('reverse'), ['PTR']);
  assert.equal(reverseZoneName('192.168.1'), '1.168.192.in-addr.arpa');
  assert.equal(reverseZoneName('192.168.1.0/24'), '1.168.192.in-addr.arpa');
  assert.equal(reverseZoneName('10.0.0.0'), '0.0.10.in-addr.arpa');
  assert.equal(reverseZoneName('300.1.1'), null);
  assert.equal(validateRecord(rec('10', 'PTR', 'www.aula.lab.'), '1.168.192.in-addr.arpa'), null);
  assert.match(validateRecord(rec('10', 'PTR', '*.aula.lab.'), '1.168.192.in-addr.arpa') ?? '', /comodín|wildcard|\*/i);
});

test('zones are validated before they exist: name, kind, SOA mailbox and at least one NS', () => {
  assert.equal(validateZone(aula, []), null);
  assert.match(validateZone(aula, [aula]) ?? '', /ya existe|exists/i);
  assert.match(validateZone({ ...aula, ns: [] }, []) ?? '', /NS/);
  assert.match(validateZone({ ...newZone('aula.lab', 'reverse', ['ns.aula.lab']) }, []) ?? '', /in-addr\.arpa/);
  assert.match(validateZone({ ...newZone('1.168.192.in-addr.arpa', 'forward', ['ns.aula.lab']) }, []) ?? '', /inversa|reverse/i);
  assert.match(validateZone({ ...aula, name: 'mal..dominio' }, []) ?? '', /nombre|name/i);
});

test('every forward zone generates the reverse zones of its A records, with PTRs; a hand-made one takes precedence', () => {
  const auto = autoReverseZones([aula]);
  assert.deepEqual(auto.map((z) => z.name).sort(), ['0.0.10.in-addr.arpa', '1.168.192.in-addr.arpa']);
  const net1 = auto.find((z) => z.name === '1.168.192.in-addr.arpa');
  assert.equal(net1?.kind, 'reverse');
  assert.deepEqual(net1?.ns, aula.ns, 'same name servers as the forward zone');
  assert.deepEqual(net1?.records.map((r) => `${r.name} ${r.type} ${r.value}`), ['2 PTR ns.aula.lab.', '10 PTR www.aula.lab.'], 'wildcards get no PTR');
  const manual: DnsZone = { ...newZone('1.168.192.in-addr.arpa', 'reverse', ['ns.aula.lab']), records: [rec('10', 'PTR', 'portal.aula.lab.')] };
  const served = servedZones({ enabled: true, zones: [aula, manual] });
  assert.deepEqual(served.map((s) => `${s.zone.name}${s.auto ? ' (auto)' : ''}`), ['aula.lab', '1.168.192.in-addr.arpa', '0.0.10.in-addr.arpa (auto)']);
  assert.deepEqual(servedZones({ enabled: true, zones: [aula], authoritative: false }), [], 'not authoritative: no zone is loaded');
});

test('answers come from the closest zone: SOA in negative answers, PTR from the automatic reverse zone', () => {
  const served = servedZones({ enabled: true, zones: [aula] });
  const a = answerFromZones(q('web.aula.lab'), served);
  assert.equal(a.authoritative, true);
  assert.deepEqual(a.answers?.map((x) => `${x.type} ${x.data}`), ['CNAME www.aula.lab', 'A 192.168.1.10']);
  assert.deepEqual(answerFromZones(q('10.1.168.192.in-addr.arpa', 'PTR'), served).answers?.map((x) => x.data), ['www.aula.lab']);
  const soa = answerFromZones(q('aula.lab', 'SOA'), served);
  assert.match(soa.answers?.[0]?.data ?? '', /^ns\.aula\.lab admin\.aula\.lab \d{10} 604800 86400 2419200 3600$/);
  assert.deepEqual(answerFromZones(q('aula.lab', 'NS'), served).answers?.map((x) => x.data), ['ns.aula.lab']);
  const missing = answerFromZones(q('nada.0.0.10.in-addr.arpa', 'PTR'), served);
  assert.equal(missing.rcode, 'NXDOMAIN');
  assert.equal(missing.authority?.[0]?.name, '0.0.10.in-addr.arpa');
  assert.equal(answerFromZones(q('www.google.com'), served).rcode, 'REFUSED', 'not ours: refused (recursion decides)');
});

test('named-checkzone style problems: NS without address, records the kind does not admit, CNAME with other data', () => {
  const broken: DnsZone = { ...newZone('aula.lab', 'forward', ['ns.aula.lab', 'dns.otro.es']), records: [rec('www', 'CNAME', 'srv'), rec('www', 'TXT', 'x'), rec('1', 'PTR', 'x.aula.lab.')] };
  const p = zoneProblems(broken).join('\n');
  assert.match(p, /ns\.aula\.lab.*(A|dirección)/);
  assert.doesNotMatch(p, /dns\.otro\.es/, 'out-of-zone name servers need no glue here');
  assert.match(p, /CNAME/);
  assert.match(p, /PTR/);
  assert.deepEqual(zoneProblems(aula), []);
});

test('the old settings (origin + flat records) become zones: NS at the apex go to the NS list', () => {
  const zones = zonesFromLegacy('aula.lab', [rec('@', 'NS', 'srv'), rec('srv', 'A', '192.168.1.2'), rec('www', 'CNAME', 'srv'), rec('mail.otro.es.', 'A', '10.0.0.7')]);
  assert.deepEqual(zones.map((z) => z.name), ['aula.lab', 'otro.es']);
  assert.deepEqual(zones[0]?.ns, ['srv.aula.lab']);
  assert.deepEqual(zones[0]?.records.map((r) => r.name), ['srv', 'www']);
  assert.deepEqual(zones[1]?.records.map((r) => `${r.name} ${r.value}`), ['mail 10.0.0.7']);
  assert.deepEqual(zones[1]?.ns, ['ns.otro.es'], 'no NS: a default one (named-checkzone will ask for its address)');
  const noOrigin = zonesFromLegacy(undefined, [rec('www.aula.lab', 'A', '10.0.0.2')]);
  assert.deepEqual(noOrigin.map((z) => z.name), ['aula.lab']);
  assert.deepEqual(zoneRecords(noOrigin[0]!).map((r) => `${r.name} ${r.type}`), ['aula.lab NS', 'www.aula.lab A']);
});
