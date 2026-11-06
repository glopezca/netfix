/**
 * Asking the WINS server: `nmblookup -U SERVER -R NAME` sends the query by unicast with recursion desired (without -R
 * the server only answers for its own names), and the NSS source `wins` asks the servers of `wins server` first and
 * only then by broadcast, so a name past the router is found.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { setSambaInstalled } from '../../src/shells/samba-install.ts';
import { setPackageInstalled } from '../../src/net/host-packages.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { Host } from '../../src/devices/host.ts';
import type { Topology } from '../../src/net/topology.ts';
import { winsSendAll } from '../../src/net/wins.ts';

const run = (h: Host, cmd: string): string => createShell(h, 'linux', 'root').run(cmd).join('\n');
const SRV_IP = parseIp('192.168.10.2') ?? 0;

function smbConf(h: Host, body: string): void {
  run(h, `printf '[global]\\n   workgroup = WORKGROUP\\n${body}\\n' > /etc/samba/smb.conf; systemctl restart nmbd`);
}

/** nombres-redes: SRV the WINS server; WIN-A (LAN A) registered with it; WIN-B2 (LAN B) a GNU/Linux client. */
function lab(): { t: Topology; b2: Host } {
  const t = EXAMPLES.find((e) => e.id === 'nombres-redes')!.build();
  const [srv, winA, b2] = ['SRV', 'WIN-A', 'WIN-B2'].map((l) => t.byLabel(l) as Host) as [Host, Host, Host];
  setSambaInstalled(srv, true);
  smbConf(srv, '   wins support = yes');
  winsSendAll(winA, SRV_IP, 'registration', 3600);
  b2.os = 'linux';
  setSambaInstalled(b2, true);
  smbConf(b2, '   wins server = 192.168.10.2');
  t.net.runFor(1000);
  return { t, b2 };
}

test('nmblookup -U SERVER -R: the WINS server answers for a name in another subnet', () => {
  const { b2 } = lab();
  assert.equal(run(b2, 'nmblookup -U 192.168.10.2 -R win-a; echo "status $?"'), 'querying win-a on 192.168.10.2\n192.168.10.11 win-a<00>\nstatus 0');
  assert.equal(run(b2, 'nmblookup -R -U 192.168.10.2 nadie; echo "status $?"'), 'querying nadie on 192.168.10.2\nname_query failed to find name nadie\nstatus 1');
  assert.equal(run(b2, 'nmblookup -U 192.168.10.2 win-a'), 'querying win-a on 192.168.10.2\nname_query failed to find name win-a', 'without -R only its own names');
  assert.equal(run(b2, 'nmblookup -U 192.168.10.2 srv'), 'querying srv on 192.168.10.2\n192.168.10.2 srv<00>');
  assert.equal(run(b2, 'nmblookup win-a'), 'querying win-a on 192.168.20.255\nname_query failed to find name win-a', 'a broadcast stays in LAN B');
  assert.match(run(b2, 'nmblookup -U 2>&1; echo "status $?"'), /^Usage: nmblookup .*-U.*\nstatus 1$/);
  assert.match(run(b2, 'nmblookup -h 2>/dev/null; echo "status $?"'), /^Usage: nmblookup .*-R.*\nstatus 0$/);
  assert.match(run(b2, 'nmblookup -U nadie.lab win-a 2>&1'), /^querying win-a on nadie\.lab\nname_query failed to find name win-a$/, 'no address: nothing sent');
});

test('NSS wins: the WINS server of smb.conf first, then a broadcast', () => {
  const { b2 } = lab();
  for (const p of ['winbind', 'libnss-winbind']) setPackageInstalled(b2, p, true);
  run(b2, "sed -i 's/^hosts:.*/hosts:          files wins/' /etc/nsswitch.conf");
  assert.equal(run(b2, 'getent hosts win-a'), '192.168.10.11   win-a', 'past the router, by WINS');
  assert.equal(run(b2, 'getent hosts win-b'), '192.168.20.11   win-b', 'not registered: by broadcast in LAN B');
  smbConf(b2, '');
  assert.equal(run(b2, 'getent hosts win-a; echo $?'), '2', 'without wins server only the broadcast');
});
