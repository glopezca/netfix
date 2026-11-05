/**
 * smb.conf for WINS: `wins support = yes` makes nmbd a WINS server, `wins server = IP…` points a client at one. The list
 * takes spaces or commas and drops what is not an IP. Both at once is an error testparm reports and nmbd will not start.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseSmbConf } from '../../src/services/smb-conf.ts';
import { unitRunning } from '../../src/net/pkg-units.ts';
import type { Host } from '../../src/devices/host.ts';

const run = (h: Host, cmd: string): string => createShell(h, 'linux', 'root').run(cmd).join('\n');
const CONFLICT = "ERROR: both 'wins support = true' and 'wins server = <server list>' cannot be set in the smb.conf file. nmbd will abort with this setting.";
const global = (body: string): string => `[global]\n   workgroup = AULA\n${body}\n`;

test('wins support and wins server: booleans and a list of IPs (spaces or commas, the rest dropped)', () => {
  const none = parseSmbConf(global(''));
  assert.equal(none.winsSupport, false);
  assert.deepEqual(none.winsServers, []);
  assert.equal(parseSmbConf(global('   wins support = yes')).winsSupport, true);
  assert.equal(parseSmbConf(global('   WINS Support = True')).winsSupport, true);
  const list = parseSmbConf(global('   wins server = 192.168.1.10, 10.0.0.1 srv 300.1.1.1')).winsServers;
  assert.deepEqual(list, [0xc0a8010a, 0x0a000001]);
  assert.deepEqual(parseSmbConf(global('   wins server = srv')).winsServers, [], 'names are not resolved');
  assert.deepEqual(parseSmbConf(global('')).unknown, []);
  assert.deepEqual(parseSmbConf(global('   wins support = yes\n   wins server = 10.0.0.1')).unknown, [], 'both are known');
});

test('testparm: both keys are an error (exit 1), the dump still follows; one alone is fine', () => {
  const srv = EXAMPLES.find((e) => e.id === 'samba')!.build().byLabel('SRV') as Host;
  run(srv, "printf '[global]\\n   wins support = yes\\n' > /etc/samba/smb.conf");
  assert.equal(run(srv, 'testparm -s >/dev/null 2>&1; echo $?'), '0');
  assert.match(run(srv, 'testparm -s 2>/dev/null'), /^\twins support = Yes$/m);
  run(srv, "printf '[global]\\n   wins support = yes\\n   wins server = 10.0.0.1\\n' > /etc/samba/smb.conf");
  const out = run(srv, 'testparm -s 2>&1; echo "status $?"');
  assert.match(out, new RegExp(`Loaded services file OK\\.\\n.*\\n${CONFLICT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\nServer role: ROLE_STANDALONE`));
  assert.match(out, /\twins server = 10\.0\.0\.1\nstatus 1$/);
});

test('nmbd does not start with both keys (its journal says why); it starts once one goes', () => {
  const srv = EXAMPLES.find((e) => e.id === 'samba')!.build().byLabel('SRV') as Host;
  run(srv, "printf '[global]\\n   wins support = yes\\n   wins server = 10.0.0.1\\n' > /etc/samba/smb.conf");
  run(srv, 'systemctl stop nmbd');
  assert.match(run(srv, 'systemctl start nmbd 2>&1; echo "status $?"'), /^Job for nmbd\.service failed because the control process exited with error code\.\n[^\n]*\nstatus 1$/);
  assert.equal(unitRunning(srv, 'nmbd'), false);
  assert.match(run(srv, 'journalctl -u nmbd'), /nmbd aborting\./);
  run(srv, "sed -i '/wins server/d' /etc/samba/smb.conf");
  run(srv, 'systemctl start nmbd');
  assert.equal(unitRunning(srv, 'nmbd'), true);
  assert.equal(run(srv, 'systemctl restart smbd; echo $?'), '0', 'smbd does not care');
});
