/** named-checkconf: named.conf read as BIND 9.20 does (grammar, includes, ACLs, zones) and -z, the test load of zones. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNamedConf, loadConfZones } from '../../src/services/named-conf-check.ts';
import { bindFiles } from '../../src/services/bind-files.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import type { DnsSettings } from '../../src/services/config.ts';

type Files = Readonly<Record<string, string>>;
const reader = (files: Files) => (p: string): string | { readonly error: string } => files[p] ?? { error: 'file not found' };
const CONF = '/etc/bind/named.conf';
const ZONE = '$TTL 1d\n@ IN SOA ns.aula.lab. root.aula.lab. 7 1h 15m 1w 1h\n@ IN NS ns\nns IN A 192.168.10.2\n';

function check(conf: string, extra: Files = {}): readonly string[] {
  return checkNamedConf(CONF, reader({ [CONF]: conf, ...extra })).errors;
}

test('a valid configuration: comments of the three kinds, ACLs, includes, blocks that are not checked', () => {
  const conf = `// comentario
# también
/* y de
   varias líneas */
acl "aula" { 192.168.10.0/24; !192.168.10.9; localhost; };
logging { channel x { file "/var/log/named.log" versions 3 size 5m; }; category default { x; }; };
controls { inet 127.0.0.1 port 953 allow { 127.0.0.1; } keys { "rndc-key"; }; };
include "/etc/bind/named.conf.options";
zone "aula.lab" IN { type primary; file "db.aula.lab"; allow-transfer { none; }; };
`;
  const options = 'options {\n\tdirectory "/var/cache/bind";\n\tforwarders { 8.8.8.8; 1.1.1.1 port 53; };\n\tforward first;\n\trecursion yes;\n\tallow-recursion { aula; };\n\tlisten-on port 53 { any; };\n\tdnssec-validation auto;\n\tversion "none";\n};\n';
  const r = checkNamedConf(CONF, reader({ [CONF]: conf, '/etc/bind/named.conf.options': options }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.directory, '/var/cache/bind');
  assert.deepEqual(r.zones.map((z) => [z.name, z.type, z.file]), [['aula.lab', 'primary', 'db.aula.lab']]);
});

test('syntax errors stop at the first one, with the file and line', () => {
  assert.deepEqual(check('options {\n\trecursion no\n\tlisten-on { any; };\n};\n'), [`${CONF}:3: missing ';' before 'listen-on'`]);
  assert.deepEqual(check('options {\n\trecurson no;\n};\n'), [`${CONF}:2: unknown option 'recurson'`]);
  assert.deepEqual(check('options {\n\trecursion quizas;\n};\n'), [`${CONF}:2: boolean expected near 'quizas'`]);
  assert.deepEqual(check('options {\n\tforwarders { 8.8.8; };\n};\n'), [`${CONF}:2: expected IP address near '8.8.8'`]);
  assert.deepEqual(check('options {\n\tforward always;\n};\n'), [`${CONF}:2: 'always' unexpected near 'always'`]);
  assert.deepEqual(check('options {\n\trecursion yes;\n'), [`${CONF}:3: unexpected end of input`]);
  assert.deepEqual(check('options {\n\trecursion yes;\n}\nzone "a" { type hint; file "x"; };\n'), [`${CONF}:4: missing ';' before 'zone'`]);
  assert.deepEqual(check('opciones { };\n'), [`${CONF}:1: unknown option 'opciones'`]);
});

test('includes: a missing one, and a missing named.conf', () => {
  assert.deepEqual(check('include "/etc/bind/nada.conf";\n'), [`${CONF}:1: open: /etc/bind/nada.conf: file not found`]);
  assert.deepEqual(checkNamedConf(CONF, reader({})).errors, [`none:0: open: ${CONF}: file not found`]);
  const inc = check('include "/etc/bind/a.conf";\n', { '/etc/bind/a.conf': 'options {\n\trecursion tal;\n};\n' });
  assert.deepEqual(inc, ['/etc/bind/a.conf:2: boolean expected near \'tal\''], 'errors point into the included file');
});

test('options of BIND 9.20 that are not checked inside are accepted; a typo is not; an open comment is an error', () => {
  assert.deepEqual(check('options {\n\tixfr-from-differences yes;\n\tstale-cache-enable no;\n\tmax-journal-size 10m;\n};\nzone "a" { type primary; file "x"; check-integrity yes; notify-delay 5; };\n'), []);
  assert.deepEqual(check('options {\n\tstale-cache-enabel no;\n};\n'), [`${CONF}:2: unknown option 'stale-cache-enabel'`]);
  assert.deepEqual(check('options { recursion no; };\n/* sin cerrar\n'), [`${CONF}:3: unexpected end of input`]);
});

test('limits: a file that includes itself, too many includes and address lists nested too deeply', () => {
  const self = 'include "/etc/bind/self.conf";\ninclude "/etc/bind/self.conf";\n';
  const loop = check('include "/etc/bind/self.conf";\n', { '/etc/bind/self.conf': self });
  assert.deepEqual(loop, ['/etc/bind/self.conf:1: /etc/bind/self.conf: too many nested includes']);
  const many = check('include "/etc/bind/empty.conf";\n'.repeat(300), { '/etc/bind/empty.conf': '' });
  assert.deepEqual(many, [`${CONF}:257: /etc/bind/empty.conf: too many includes`]);
  const deep = check(`options { allow-query { ${'{ '.repeat(100)}any; ${'}; '.repeat(100)}}; };\n`);
  assert.deepEqual(deep, [`${CONF}:1: address match list nested too deeply`]);
});

test('semantic errors are all listed: undefined ACLs and zones without type, file or with the same name', () => {
  const conf = `options { allow-query { profes; }; };
zone "aula.lab" { file "db.aula.lab"; };
zone "x.lab" { type master; };
zone "y.lab" { type master; file "db.y"; };
zone "y.lab" { type master; file "db.y2"; };
zone "z.lab" { type slave; file "db.z"; };
`;
  assert.deepEqual(check(conf), [
    `${CONF}:1: undefined ACL 'profes'`,
    `${CONF}:2: zone 'aula.lab': type not present`,
    `${CONF}:3: zone 'x.lab': missing 'file' entry`,
    `${CONF}:5: zone 'y.lab': already exists previous definition: ${CONF}:4`,
    `${CONF}:6: zone 'z.lab': missing 'primaries' entry`,
  ]);
});

test('-z loads every primary zone in order; a relative file is read from the directory', () => {
  const conf = 'options { directory "/var/cache/bind"; };\nzone "." { type hint; file "/usr/share/dns/root.hints"; };\nzone "aula.lab" { type master; file "db.aula.lab"; };\n';
  const files = { [CONF]: conf, '/var/cache/bind/db.aula.lab': ZONE };
  const parsed = checkNamedConf(CONF, reader(files));
  assert.deepEqual(loadConfZones(parsed, reader(files)), { ok: true, lines: ['zone aula.lab/IN: loaded serial 7'] });
  const bad = { ...files, '/var/cache/bind/db.aula.lab': ZONE.replace('192.168.10.2', '192.168.10.256') };
  assert.deepEqual(loadConfZones(parsed, reader(bad)), { ok: false, lines: [
    "dns_rdata_fromtext: db.aula.lab:4: near '192.168.10.256': bad dotted quad",
    'zone aula.lab/IN: loading from master file db.aula.lab failed: bad dotted quad',
    'zone aula.lab/IN: not loaded due to errors.',
    '_default/aula.lab/IN: bad zone',
  ] });
  const missing = loadConfZones(parsed, reader({ [CONF]: conf }));
  assert.equal(missing.lines[0], 'zone aula.lab/IN: loading from master file db.aula.lab failed: file not found');
});

const LAB: DnsSettings = {
  enabled: true,
  zones: [{ ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [
    { name: 'ns', type: 'A', value: '192.168.10.2', ttl: 86400 },
    { name: 'www', type: 'CNAME', value: 'ns', ttl: 86400 },
    { name: '@', type: 'MX', value: 'ns', priority: 10, ttl: 86400 },
  ] }],
};
const MODES: Record<string, DnsSettings> = {
  autoritativo: LAB,
  recursivo: { ...LAB, recursion: true, allowRecursion: 'any' },
  reenviador: { ...LAB, recursion: true, forwarders: [0x08080808, 0x01010101], forwardOnly: false },
  'solo caché': { ...LAB, authoritative: false, recursion: true, maxCacheTtl: 0 },
  'escucha en lo': { ...LAB, listenOn: ['lo'] },
  'nombres públicos': { ...LAB, recursion: true, publicNames: { enabled: true } },
};

for (const [mode, dns] of Object.entries(MODES)) {
  test(`the /etc/bind that Netfix writes passes named-checkconf -z (${mode})`, () => {
    const files = Object.fromEntries(bindFiles(dns, [{ name: 'lo', ip: 0x7f000001 }]));
    const parsed = checkNamedConf(CONF, reader(files));
    assert.deepEqual(parsed.errors, []);
    const load = loadConfZones(parsed, reader(files));
    assert.equal(load.ok, true, load.lines.join('\n'));
    assert.ok(load.lines.includes('zone localhost/IN: loaded serial 2'));
    assert.ok(load.lines.includes('zone 127.in-addr.arpa/IN: loaded serial 1'));
  });
}
