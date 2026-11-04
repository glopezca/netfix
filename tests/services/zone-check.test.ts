/** named-checkzone: master files read as BIND 9.20 does, with its messages. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkZone, dumpZone } from '../../src/services/zone-check.ts';

const ZONE = `; aula.lab
$TTL 86400
$ORIGIN aula.lab.
@ IN SOA srv.aula.lab. admin.aula.lab. (
     2026102101 ; serie
     604800 86400 2419200 3600 )
@ IN NS srv
srv IN A 192.168.10.2
www IN CNAME srv
@ IN MX 10 srv
`;
const FILE = 'db.aula.lab';
const check = (text: string, zone = 'aula.lab') => checkZone(zone, FILE, text);
const with_ = (from: string, to: string): string => ZONE.replace(from, to);

test('a long bad TTL is rejected at once (the TTL pattern does not backtrack)', () => {
  const start = Date.now();
  const r = check(`$TTL ${'1'.repeat(40)}x\n${ZONE.split('\n').slice(3).join('\n')}`);
  assert.equal(r.ok, false);
  assert.ok(Date.now() - start < 1000, 'the check takes milliseconds');
});

test('$GENERATE: a range of records, with offsets, widths and bases; a bad range is a syntax error', () => {
  const r = check(`${ZONE}$GENERATE 10-12 pc$ A 192.168.10.\${100}\n$GENERATE 1-3/2 h\${0,3,x} IN 1h CNAME srv\n`);
  assert.equal(r.ok, true, r.lines.join('\n'));
  const made = r.records.filter((x) => x.owner.startsWith('pc') || x.owner.startsWith('h0'));
  assert.deepEqual(made.map((x) => `${x.owner} ${x.type} ${x.data.join(' ')}`), [
    'pc10.aula.lab. A 192.168.10.110', 'pc11.aula.lab. A 192.168.10.111', 'pc12.aula.lab. A 192.168.10.112',
    'h001.aula.lab. CNAME srv.aula.lab.', 'h003.aula.lab. CNAME srv.aula.lab.',
  ]);
  const bad = check(`${ZONE}$GENERATE 9-1 pc$ A 192.168.10.$\n`);
  assert.equal(bad.ok, false);
  assert.equal(bad.lines[0], `dns_master_load: ${FILE}:11: $GENERATE: invalid range '9-1'`);
  assert.equal(bad.lines[1], `zone aula.lab/IN: loading from master file ${FILE} failed: syntax error`);
});

test('$INCLUDE reads another file with the same origin or the one given; a missing one stops the load', () => {
  const files: Record<string, string> = { 'db.hosts': 'pc1 A 192.168.10.21\n', 'db.lab': 'pc2 A 192.168.10.22\n' };
  const read = (p: string) => files[p] ?? { error: 'file not found' };
  const r = checkZone('aula.lab', FILE, `${ZONE}$INCLUDE db.hosts\n$INCLUDE "db.lab" lab.aula.lab.\nok A 192.168.10.23\n`, undefined, read);
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.deepEqual(r.records.filter((x) => x.type === 'A').map((x) => x.owner), ['srv.aula.lab.', 'pc1.aula.lab.', 'pc2.lab.aula.lab.', 'ok.aula.lab.']);
  const missing = checkZone('aula.lab', FILE, `${ZONE}$INCLUDE db.nope\n`, undefined, read);
  assert.deepEqual(missing.lines.slice(0, 2), [`dns_master_load: ${FILE}:11: db.nope: file not found`, `zone aula.lab/IN: loading from master file ${FILE} failed: file not found`]);
  files['db.loop'] = '$INCLUDE db.loop\n';
  assert.equal(checkZone('aula.lab', FILE, `${ZONE}$INCLUDE db.loop\n`, undefined, read).ok, false);
});

test('other RR types BIND knows (DNSSEC, SSHFP, TLSA, RFC 3597) load with their data as written', () => {
  const extra = 'srv IN SSHFP 1 1 123456789abcdef67890123456789abcdef67890\n_443._tcp.www IN TLSA 3 1 1 abcd\n@ IN TYPE65534 \\# 3 abcdef\nold IN DNAME srv\n';
  const r = check(`${ZONE}${extra}`);
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.deepEqual(r.records.slice(-4).map((x) => x.type), ['SSHFP', 'TLSA', 'TYPE65534', 'DNAME']);
  assert.equal(check(`${ZONE}srv IN BOGUS 1\n`).ok, false);
});

test('a correct zone loads with its serial', () => {
  const r = check(ZONE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, ['zone aula.lab/IN: loaded serial 2026102101']);
  assert.equal(r.serial, 2026102101);
});

test('TTL and class in either order, TTL units, owners inherited from the line above and absolute names', () => {
  const text = `${ZONE}gw 1h IN A 192.168.10.1\n     IN AAAA fd00::1\nmail IN 3600 A 192.168.10.3\nweb.aula.lab. 1d A 192.168.10.4\n`;
  const r = check(text);
  assert.equal(r.ok, true, r.lines.join('\n'));
  const gw = r.records.filter((x) => x.owner === 'gw.aula.lab.');
  assert.deepEqual(gw.map((x) => [x.type, x.ttl]), [['A', 3600], ['AAAA', 86400]], 'without its own TTL a record takes $TTL');
  assert.ok(r.records.some((x) => x.owner === 'mail.aula.lab.' && x.ttl === 3600));
  assert.ok(r.records.some((x) => x.owner === 'web.aula.lab.' && x.ttl === 86400));
});

test('a bad IPv4 address: dns_rdata_fromtext with the line, and the zone is not loaded', () => {
  const r = check(with_('192.168.10.2', '192.168.10.300'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, [
    `dns_rdata_fromtext: ${FILE}:8: near '192.168.10.300': bad dotted quad`,
    `zone aula.lab/IN: loading from master file ${FILE} failed: bad dotted quad`,
    'zone aula.lab/IN: not loaded due to errors.',
  ]);
});

test('an unknown record type and a record with missing data', () => {
  assert.deepEqual(check(with_('srv IN A', 'srv IN AA')).lines.slice(0, 2), [
    `dns_master_load: ${FILE}:8: unknown RR type 'AA'`,
    `zone aula.lab/IN: loading from master file ${FILE} failed: unknown class/type`,
  ]);
  assert.deepEqual(check(with_('IN MX 10 srv', 'IN MX 10')).lines.slice(0, 2), [
    `dns_rdata_fromtext: ${FILE}:10: near eol: unexpected end of input`,
    `zone aula.lab/IN: loading from master file ${FILE} failed: unexpected end of input`,
  ]);
});

test('CNAME and other data at the same name', () => {
  const r = check(`${ZONE}www IN A 192.168.10.9\n`);
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines.slice(0, 2), [
    `dns_master_load: ${FILE}:11: www.aula.lab: CNAME and other data`,
    `zone aula.lab/IN: loading from master file ${FILE} failed: CNAME and other data`,
  ]);
});

test('an NS inside the zone needs an address record; the zone is then not loaded', () => {
  const r = check(with_('@ IN NS srv', '@ IN NS srv\n@ IN NS ns2'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, ["zone aula.lab/IN: NS 'ns2.aula.lab' has no address records (A or AAAA)", 'zone aula.lab/IN: not loaded due to errors.']);
  assert.equal(check(with_('@ IN NS srv', '@ IN NS ns.otra.com.')).ok, true, 'an NS of another zone is not checked');
});

test('an NS that is a CNAME is illegal; an MX without address only warns', () => {
  assert.deepEqual(check(with_('@ IN NS srv', '@ IN NS www')).lines[0], "zone aula.lab/IN: NS 'www.aula.lab' is a CNAME (illegal)");
  const mx = check(with_('IN MX 10 srv', 'IN MX 10 correo'));
  assert.equal(mx.ok, true);
  assert.deepEqual(mx.lines, ["zone aula.lab/IN: aula.lab/MX 'correo.aula.lab' has no address records (A or AAAA)", 'zone aula.lab/IN: loaded serial 2026102101']);
});

test('without SOA or NS records, or an SOA below the apex', () => {
  const r = check('$TTL 3600\nsrv IN A 192.168.10.2\n');
  assert.deepEqual(r.lines, ['zone aula.lab/IN: has 0 SOA records', 'zone aula.lab/IN: has no NS records', 'zone aula.lab/IN: not loaded due to errors.']);
  const top = check(with_('srv IN A', 'srv IN SOA srv admin 1 2 3 4 5\nsrv IN A'));
  assert.equal(top.ok, false);
  assert.equal(top.lines[0], `dns_master_load: ${FILE}:8: SOA record not at top of zone (srv.aula.lab)`);
});

test('warnings that still load: out-of-zone data and no TTL', () => {
  const out = check(`${ZONE}otra.com. IN A 10.0.0.1\n`);
  assert.equal(out.ok, true);
  assert.deepEqual(out.lines, [`dns_master_load: ${FILE}:11: ignoring out-of-zone data (otra.com)`, 'zone aula.lab/IN: loaded serial 2026102101']);
  const nottl = check(ZONE.replace('$TTL 86400\n', ''));
  assert.equal(nottl.ok, true);
  assert.equal(nottl.lines[0], `dns_master_load: ${FILE}:5: no TTL specified; using SOA MINTTL instead`);
  assert.equal(nottl.lines.filter((l) => l.includes('no TTL')).length, 1, 'only once');
  assert.equal(nottl.records.find((x) => x.type === 'A')?.ttl, 3600);
});

test('unknown directives, unbalanced parentheses and a missing file', () => {
  assert.equal(check(`$FOO bar\n${ZONE}`).lines[0], `dns_master_load: ${FILE}:1: unknown $ directive '$FOO'`);
  assert.match(check(ZONE.replace(' 3600 )', ' 3600')).lines.join('\n'), /unexpected end of input/);
  assert.deepEqual(checkZone('aula.lab', '/etc/bind/db.x', undefined, 'file not found').lines, [
    'zone aula.lab/IN: loading from master file /etc/bind/db.x failed: file not found',
    'zone aula.lab/IN: not loaded due to errors.',
  ]);
});

test('reverse zones, wildcards and quoted TXT with semicolons', () => {
  const rev = `$TTL 1d\n@ IN SOA ns.aula.lab. root.aula.lab. 1 2 3 4 5\n@ IN NS ns.aula.lab.\n2 IN PTR srv.aula.lab.\n`;
  assert.equal(checkZone('10.168.192.in-addr.arpa', FILE, rev).ok, true);
  const r = check(`${ZONE}*.web IN A 192.168.10.5\n@ IN TXT "v=spf1 a; -all"\n`);
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.deepEqual(r.records.find((x) => x.type === 'TXT')?.data, ['"v=spf1 a; -all"']);
});

test('named-compilezone dump: full names, the apex first and the TTLs written out', () => {
  const text = dumpZone(check(ZONE).records);
  assert.equal(text.split('\n')[0], 'aula.lab.\t86400\tIN SOA\tsrv.aula.lab. admin.aula.lab. 2026102101 604800 86400 2419200 3600');
  assert.match(text, /^aula\.lab\.\t86400\tIN MX\t10 srv\.aula\.lab\.$/m);
  assert.match(text, /^www\.aula\.lab\.\t86400\tIN CNAME\tsrv\.aula\.lab\.$/m);
  assert.ok(text.endsWith('\n'));
});
