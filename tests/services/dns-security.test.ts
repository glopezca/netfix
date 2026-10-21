/** Security review of phase 20: untrusted topology files, zone-file text, response spoofing and referral poisoning. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servicesFromJson } from '../../src/services/persist.ts';
import { bindFiles } from '../../src/services/bind-files.ts';
import { newZone, servedZones } from '../../src/services/dns-zones.ts';
import { validateRecord } from '../../src/services/dns-service.ts';
import { addRecord, addZone } from '../../src/services/dns-edit.ts';
import { iterStep } from '../../src/services/dns-iterate.ts';
import { DnsForwarder } from '../../src/services/dns-forwarder.ts';
import type { DnsMessage } from '../../src/net/packets.ts';
import type { DnsZone } from '../../src/services/config.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;

test('a legacy file cannot turn a record name into a path outside /etc/bind', () => {
  const evil = 'x/../../../root/.ssh/authorized_keys';
  const s = servicesFromJson({ dns: { enabled: true, records: [{ name: evil, type: 'NS', value: 'ns.x', ttl: 1 }, { name: `a.${evil}`, type: 'TXT', value: 'k', ttl: 1 }, { name: 'www.aula.lab', type: 'A', value: '10.0.0.2', ttl: 60 }] } });
  assert.deepEqual(s.dns.zones.map((z) => z.name), ['aula.lab']);
  const paths = [...bindFiles(s.dns).keys()];
  assert.ok(paths.every((p) => !p.includes('..')), paths.join(' '));
  // Even a zone that skipped validation never becomes a file outside /etc/bind.
  const forged: DnsZone = { ...newZone('aula.lab', 'forward', ['ns.aula.lab']), name: 'a/../../etc/shadow' };
  assert.ok([...bindFiles({ enabled: true, zones: [forged] }).keys()].every((p) => !p.includes('..')));
});

test('records with control characters, quotes in TXT or odd mailboxes cannot break the zone files', () => {
  assert.ok(validateRecord({ name: 'x', type: 'TXT', value: 'a\n$INCLUDE /x', ttl: 1 }, 'aula.lab'));
  assert.ok(validateRecord({ name: 'x\ny', type: 'A', value: '10.0.0.1', ttl: 1 }, 'aula.lab'));
  const z = { ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [{ name: 'x', type: 'TXT' as const, value: 'say "hi" \\ bye', ttl: 1 }] };
  assert.match(bindFiles({ enabled: true, zones: [z] }).get('/etc/bind/db.aula.lab') ?? '', /TXT\s+"say \\"hi\\" \\\\ bye"/);
  const s = servicesFromJson({ dns: { enabled: true, zones: [] } }).dns;
  assert.ok('error' in addZone(s, { name: 'aula.lab', mname: 'ns.aula.lab', email: 'a;(x"<b>@aula.lab', refresh: '1', retry: '1', expire: '1', minimum: '1', ns: 'ns.aula.lab', kind: 'forward' }, 20261021));
});

test('reverse zones of many A records are built quickly; the GUI keeps the same limits as the files', () => {
  const records = Array.from({ length: 500 }, (_, i) => ({ name: `h${i}`, type: 'A' as const, value: `10.0.0.${i % 250}`, ttl: 60 }));
  const zones = Array.from({ length: 64 }, (_, i) => ({ ...newZone(`z${i}.lab`, 'forward', [`ns.z${i}.lab`]), records }));
  const start = Date.now();
  servedZones({ zones });
  assert.ok(Date.now() - start < 1500, `${Date.now() - start} ms`);
  const full = { enabled: true, zones: [{ ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records }] };
  assert.ok('error' in addRecord(full, 'aula.lab', { name: 'one', type: 'A', value: '10.0.0.1', ttl: 1 }, 20261021));
  assert.ok('error' in addZone({ enabled: true, zones }, { name: 'more.lab', mname: 'ns.more.lab', email: 'a@more.lab', refresh: '1', retry: '1', expire: '1', minimum: '1', ns: 'ns.more.lab', kind: 'forward' }, 20261021));
});

test('referrals must go down from the zone asked; answers from another address are ignored', () => {
  const up: DnsMessage = { id: 1, response: true, qname: 'x.evil.com', qtype: 'A', rcode: 'NOERROR', answers: [], authority: [{ name: 'com', type: 'NS', ttl: 60, data: 'ns.evil.com' }], additional: [{ name: 'ns.evil.com', type: 'A', ttl: 60, data: '6.6.6.6' }] };
  assert.equal(iterStep(up, 'x.evil.com', 'A', 'evil.com').kind, 'lame', 'evil.com cannot speak for com');
  assert.equal(iterStep(up, 'x.evil.com', 'A', '').kind, 'referral', 'the root may');
  const mixed: DnsMessage = { ...up, authority: [{ name: 'evil.com', type: 'NS', ttl: 60, data: 'a' }, { name: 'com', type: 'NS', ttl: 60, data: 'b' }] };
  assert.equal(iterStep(mixed, 'x.evil.com', 'A', '').kind, 'lame', 'NS records of different owners');
  const sent: number[] = [];
  const replies: DnsMessage[] = [];
  const f = new DnsForwarder({ send: (dst) => { sent.push(dst); }, reply: (_to, _p, m) => { replies.push(m); }, schedule: () => undefined, now: () => 0, log: () => undefined });
  f.resolve({ id: 9, response: false, qname: 'www.google.com', qtype: 'A', rd: true }, ip('10.0.0.10'), 5000, [ip('8.8.8.8')]);
  const fake: DnsMessage = { id: 40000, response: true, qname: 'www.google.com', qtype: 'A', rcode: 'NOERROR', answers: [{ name: 'www.google.com', type: 'A', ttl: 60, data: '6.6.6.6' }] };
  assert.equal(f.onResponse(40000, fake, ip('6.6.6.6')), false, 'not from the server asked');
  assert.equal(f.onResponse(40000, { ...fake, qname: 'other.com' }, ip('8.8.8.8')), false, 'not the question asked');
  assert.equal(f.onResponse(40000, fake, ip('8.8.8.8')), true);
  assert.equal(replies.length, 1);
});
