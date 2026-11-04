/** kea-dhcp4 (isc-kea, kea-dhcp4-server): -t checks a configuration as Kea 2.6 loads it; -v and -V the version. */
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
const LOG = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO  \[kea-dhcp4\.dhcpsrv\/\d+\.\d+\] /;
const CONF = '/etc/kea/kea-dhcp4.conf';

test('a PC has no kea-dhcp4 until isc-kea is installed, which ships a basic kea-dhcp4.conf', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  assert.equal(run(pc, `kea-dhcp4 -t ${CONF}; echo "status $?"`),
    "Command 'kea-dhcp4' not found, but can be installed with:\nsudo apt install kea-dhcp4-server\nstatus 127");
  assert.match(run(pc, 'apt install -y isc-kea'), /Setting up isc-kea \(2\.6\.3-1ubuntu1\)/);
  assert.equal(run(pc, 'kea-dhcp4 -v'), '2.6.3');
  const out = run(pc, `kea-dhcp4 -t ${CONF}; echo "status $?"`).split('\n');
  assert.match(out[0] ?? '', LOG);
  assert.match(out[1] ?? '', /DHCPSRV_CFGMGR_NEW_SUBNET4 a new subnet has been added to configuration: 192\.0\.2\.0\/24 with params: t1=900, t2=1800, valid-lifetime=3600$/);
  assert.equal(out[2], 'status 0');
});

test('an edited kea-dhcp4.conf is kept when the package is installed again', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, 'apt install -y kea-dhcp4-server');
  run(pc, `echo '{ "Dhcp4": { } }' > ${CONF}`);
  run(pc, 'apt remove -y kea-dhcp4-server; apt install -y kea-dhcp4-server');
  assert.equal(run(pc, `cat ${CONF}`), '{ "Dhcp4": { } }');
});

test('kea-dhcp4 -t on the server checks the file of the Servicios panel', () => {
  const out = run(srv(), `kea-dhcp4 -t ${CONF}; echo "status $?"`, 'alumno').split('\n');
  assert.match(out[0] ?? '', /DHCPSRV_CFGMGR_SOCKET_TYPE_DEFAULT "dhcp-socket-type" not specified , using default socket type raw$/);
  assert.match(out[1] ?? '', /a new subnet has been added to configuration: 192\.168\.10\.0\/24 with params: valid-lifetime=86400$/);
  assert.equal(out[2], 'status 0');
  assert.match(run(srv(), `kea-dhcp4 -d -t ${CONF} 2>&1 >/dev/null`), /^Syntax check OK$/);
});

test('a broken configuration fails with the reason on stderr and exit 1', () => {
  const h = srv();
  run(h, `printf '{ "Dhcp4": { "subnet4": [ { "id": 1, "subnet": "10.0.0.0/24", "pools": [ { "pool": "10.0.1.1 - 10.0.1.9" } ] } ] } }\\n' > /tmp/k.conf`);
  const err = run(h, 'kea-dhcp4 -t /tmp/k.conf 2>&1 >/dev/null; echo "status $?"');
  assert.match(err, /^Error encountered: subnet configuration failed: a pool of type V4, with the following address range: 10\.0\.1\.1-10\.0\.1\.9 does not match the prefix of a subnet: 10\.0\.0\.0\/24 to which it is being added\. \(\/tmp\/k\.conf:1:\d+\)\nstatus 1$/);
  run(h, `echo '{ "Dhcp4": { "valid-lifetime": "x" } }' > /tmp/j.conf`);
  assert.match(run(h, 'kea-dhcp4 -t /tmp/j.conf; echo "status $?"'), /^Syntax check failed with: .*\/tmp\/j\.conf:1\.\d+.*\nstatus 1$/);
  assert.equal(run(h, 'kea-dhcp4 -t /nope; echo "status $?"'),
    'Syntax check failed with: Unable to open file /nope\nstatus 1');
});

test('kea-dhcp4: the version, the usage and the running server', () => {
  const h = srv();
  assert.match(run(h, 'kea-dhcp4 -V'), /^2\.6\.3 \(tarball\)\npremium: no\n/);
  assert.match(run(h, 'kea-dhcp4; echo "status $?"'), /^kea-dhcp4: configuration file not specified\nUsage: kea-dhcp4 -\[v\|V\|W\][\s\S]*\nstatus 1$/);
  assert.match(run(h, 'kea-dhcp4 -x; echo "status $?"'), /^kea-dhcp4: invalid option -- 'x'\nUsage: [\s\S]*\nstatus 1$/);
  assert.match(run(h, `kea-dhcp4 -p 70000 -t ${CONF}; echo "status $?"`), /^kea-dhcp4: server port number must be within 1\.\.65535\n[\s\S]*status 1$/);
  assert.match(run(h, `kea-dhcp4 -c ${CONF}; echo "status $?"`), /^DHCP4_ALREADY_RUNNING kea-dhcp4 already running\? .*\nstatus 1$/);
});

test('the generated kea-dhcp4.conf of every example server with DHCP passes kea-dhcp4 -t', () => {
  let checked = 0;
  for (const ex of EXAMPLES) {
    for (const p of ex.build().placed.values()) {
      const d = p.device as Host;
      if (!runsServices(d.kind) || /not found/.test(run(d, 'kea-dhcp4 -v 2>&1'))) continue;
      checked++;
      assert.equal(run(d, `kea-dhcp4 -t ${CONF} >/dev/null; echo "status $?"`), 'status 0', `${ex.id} ${p.label}: ${run(d, `kea-dhcp4 -t ${CONF}`)}`);
    }
  }
  assert.ok(checked >= 2, `only ${checked} servers with DHCP`);
});
