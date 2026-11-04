/** named-checkzone, named-compilezone and named-checkconf (bind9-utils): installed with apt, checking the real files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { runsServices } from '../../src/devices/kinds.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const run = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));
const srv = (): Host => lab('servidores').byLabel('SRV') as Host;

test('a PC has no BIND tools until bind9utils is installed, and keeps them with bind9-utils', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  assert.equal(run(pc, 'named-checkzone aula.lab db; echo "status $?"'),
    "Command 'named-checkzone' not found, but can be installed with:\nsudo apt install bind9-utils\nstatus 127");
  assert.match(run(pc, 'apt install -y bind9utils'), /Setting up bind9-utils \(1:9\.20\.4-3ubuntu1\)/);
  assert.equal(run(pc, 'named-checkzone -v'), '9.20.4-3ubuntu1-Ubuntu');
  assert.equal(run(pc, 'named-checkconf; echo "status $?"'), 'none:0: open: /etc/bind/named.conf: file not found\nstatus 1');
  run(pc, 'apt remove -y bind9utils');
  assert.equal(run(pc, 'named-checkconf -v'), '9.20.4-3ubuntu1-Ubuntu');
  run(pc, 'apt remove -y bind9-utils');
  assert.match(run(pc, 'named-checkconf; echo "status $?"'), /^Command 'named-checkconf' not found.*\n.*\nstatus 127$/);
});

test('bind9 on a PC ships the default /etc/bind, which named-checkconf -z loads', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, 'apt install -y bind9');
  assert.equal(run(pc, 'named-checkconf -z; echo "status $?"'),
    'zone localhost/IN: loaded serial 2\nzone 127.in-addr.arpa/IN: loaded serial 1\nstatus 0');
  assert.equal(run(pc, 'named-checkconf -l'), '. IN _default hint\nlocalhost IN _default master\n127.in-addr.arpa IN _default master');
});

test('named-checkconf -z on the server loads the zones of the Servicios panel', () => {
  assert.equal(run(srv(), 'named-checkconf; echo "status $?"', 'alumno'), 'status 0');
  assert.equal(run(srv(), 'named-checkconf -z', 'alumno'), [
    'zone aula.lab/IN: loaded serial 2026102101', 'zone 10.168.192.in-addr.arpa/IN: loaded serial 2026102101',
    'zone localhost/IN: loaded serial 2', 'zone 127.in-addr.arpa/IN: loaded serial 1',
  ].join('\n'));
});

test('named-checkconf reports a broken named.conf with the file and line, and exits 1', () => {
  const h = srv();
  run(h, 'printf \'options {\\n\\tdirectory "/var/cache/bind"\\n};\\n\' > /tmp/bad.conf');
  const out = run(h, 'named-checkconf /tmp/bad.conf; echo "status $?"');
  assert.match(out, /^\/tmp\/bad\.conf:3: missing ';' before '}'\nstatus 1$/);
});

test('named-checkzone: OK for a good zone, the error and exit 1 for a broken one', () => {
  const h = srv();
  assert.equal(run(h, 'named-checkzone aula.lab /etc/bind/db.aula.lab; echo "status $?"'),
    'zone aula.lab/IN: loaded serial 2026102101\nOK\nstatus 0');
  assert.equal(run(h, 'named-checkzone -q aula.lab /etc/bind/db.aula.lab; echo "status $?"'), 'status 0');
  run(h, 'printf \'$TTL 86400\\n@ IN SOA ns1 admin 1 3600 900 604800 86400\\n@ IN NS ns1\\nns1 IN A 10.0.0.300\\n\' > /tmp/db.bad');
  const out = run(h, 'named-checkzone aula.lab /tmp/db.bad; echo "status $?"');
  assert.match(out, /^dns_rdata_fromtext: \/tmp\/db\.bad:4: near '10\.0\.0\.300': bad dotted quad\n/);
  assert.match(out, /zone aula\.lab\/IN: loading from master file \/tmp\/db\.bad failed: bad dotted quad\nzone aula\.lab\/IN: not loaded due to errors\.\nstatus 1$/);
  assert.equal(run(h, 'named-checkzone aula.lab /nope; echo "status $?"'),
    'zone aula.lab/IN: loading from master file /nope failed: file not found\nzone aula.lab/IN: not loaded due to errors.\nstatus 1');
});

test('named-compilezone writes the canonical zone to a file or to stdout', () => {
  const h = srv();
  assert.match(run(h, 'named-compilezone aula.lab /etc/bind/db.aula.lab; echo "status $?"'), /output file required, but not specified\nusage: named-compilezone .*\nstatus 1$/);
  assert.equal(run(h, 'named-compilezone -o /tmp/aula.txt aula.lab /etc/bind/db.aula.lab; echo "status $?"'),
    'zone aula.lab/IN: loaded serial 2026102101\ndump zone to /tmp/aula.txt...done\nOK\nstatus 0');
  assert.match(run(h, 'head -1 /tmp/aula.txt'), /^aula\.lab\.\s+\d+\s+IN SOA\s/);
  assert.match(run(h, 'named-compilezone -q -o - aula.lab /etc/bind/db.aula.lab'), /^aula\.lab\.\s+\d+\s+IN SOA\s/);
});

test('usage errors as getopt reports them', () => {
  const h = srv();
  assert.match(run(h, 'named-checkzone -Z aula.lab x; echo "status $?"'), /^named-checkzone: illegal option -- Z\nusage: named-checkzone .*\nstatus 1$/);
  assert.match(run(h, 'named-checkconf -t; echo "status $?"'), /^named-checkconf: option requires an argument -- t\nusage: named-checkconf .*\nstatus 1$/);
  assert.match(run(h, 'named-checkzone aula.lab; echo "status $?"'), /^usage: named-checkzone .*\nstatus 1$/);
});

test('the generated named.conf of every example server with DNS passes named-checkconf -z', () => {
  let checked = 0;
  for (const ex of EXAMPLES) {
    for (const p of ex.build().placed.values()) {
      const d = p.device as Host;
      // Without the DNS panel bind9 (and so bind9-utils) is not installed.
      if (!runsServices(d.kind) || /not found/.test(run(d, 'named-checkconf -v 2>&1'))) continue;
      checked++;
      const out = run(d, 'named-checkconf -z >/dev/null; echo "status $?"');
      assert.equal(out, 'status 0', `${ex.id} ${p.label}: ${run(d, 'named-checkconf -z')}`);
    }
  }
  assert.ok(checked >= 5, `only ${checked} servers with DNS`);
});
