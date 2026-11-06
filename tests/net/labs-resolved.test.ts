/**
 * The lab «Nombres en GNU/Linux: systemd-resolved, NSS y WINS»: SRV-WINS serves WINS and WIN-A is registered with it;
 * LNX-A turns LLMNR on and sees ping use it only through libnss-resolve; LNX-B asks the WINS with nmblookup and through
 * the NSS source wins; WIN-B gets its WINS in the TCP/IP tab and WIN-A finds it past the router.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { Topology } from '../../src/net/topology.ts';
import { winsRecords } from '../../src/net/wins.ts';
import { setWindowsWins, windowsWinsManual } from '../../src/net/win-wins.ts';
import { parseIp } from '../../src/core/ip.ts';

const SRV_IP = parseIp('192.168.10.2') ?? 0;

function lab(t = EXAMPLES.find((e) => e.id === 'nombres-resolved')!.build()) {
  const h = (l: string): Host => t.byLabel(l) as Host;
  const sh = (l: string, c: string): string => createShell(h(l), 'linux', 'root').run(c).join('\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const win = (l: string, c: string): string => createShell(h(l), 'windows').run(c).join('\n');
  return { t, h, sh, win };
}

const names = (srv: Host): string[] => winsRecords(srv).map((r) => `${r.name}<${r.suffix.toString(16).padStart(2, '0')}>`);

test('SRV-WINS serves WINS from the start and WIN-A is registered with it', () => {
  const { h, sh, win } = lab();
  assert.match(sh('SRV-WINS', 'testparm -s 2>/dev/null | grep wins'), /wins support = Yes/);
  assert.deepEqual(names(h('SRV-WINS')), ['WIN-A<00>', 'WIN-A<20>', 'WORKGROUP<00>']);
  assert.match(win('WIN-A', 'ipconfig /all'), /Primary WINS Server\.+: 192\.168\.10\.2/);
  assert.doesNotMatch(win('WIN-B', 'ipconfig /all'), /WINS/, 'WIN-B is the exercise');
});

test('LNX-A: LLMNR answers in resolvectl once on, and ping uses it only with libnss-resolve', () => {
  const { sh } = lab();
  assert.match(sh('LNX-A', 'resolvectl status'), /Protocols: -LLMNR -mDNS/);
  assert.match(sh('LNX-A', 'resolvectl query win-a'), /resolve call failed/);
  sh('LNX-A', "sed -i 's/^#LLMNR=no/LLMNR=yes/' /etc/systemd/resolved.conf; systemctl restart systemd-resolved");
  assert.match(sh('LNX-A', 'resolvectl query win-a'), /win-a: 192\.168\.10\.11 +-- link: eth0\n\n-- Information acquired via protocol LLMNR\/IPv4/);
  assert.match(sh('LNX-A', 'ping -c 1 win-a; echo "status $?"'), /Name or service not known\nstatus 2/, 'files dns: glibc does not ask resolved');
  assert.match(sh('LNX-A', 'apt install -y libnss-resolve'), /Setting up libnss-resolve/, 'apt reaches the mirrors through GW');
  assert.match(sh('LNX-A', 'grep ^hosts /etc/nsswitch.conf'), /files resolve \[!UNAVAIL=return\] dns/);
  assert.match(sh('LNX-A', 'getent hosts win-a'), /^192\.168\.10\.11 +win-a$/);
  assert.match(sh('LNX-A', 'ping -c 1 win-a'), /1 received/);
});

test('LNX-B: nmblookup asks the WINS past the router, and getent too once wins is in nsswitch.conf', () => {
  const { sh } = lab();
  assert.match(sh('LNX-B', 'apt install -y samba winbind libnss-winbind'), /Setting up libnss-winbind/);
  sh('LNX-B', "sed -i 's/^   workgroup = WORKGROUP$/&\\n   wins server = 192.168.10.2/' /etc/samba/smb.conf; systemctl restart nmbd");
  assert.match(sh('LNX-B', 'nmblookup win-a; echo "status $?"'), /name_query failed to find name win-a\nstatus 1/, 'the broadcast stays in LAN B');
  assert.equal(sh('LNX-B', 'nmblookup -U 192.168.10.2 -R win-a'), 'querying win-a on 192.168.10.2\n192.168.10.11 win-a<00>');
  assert.match(sh('LNX-B', 'getent hosts win-a; echo "status $?"'), /^status 2$/);
  sh('LNX-B', "sed -i 's/^hosts:.*/& wins/' /etc/nsswitch.conf");
  assert.match(sh('LNX-B', 'getent hosts win-a'), /^192\.168\.10\.11 +win-a$/);
});

test('WIN-B: with its WINS set, ipconfig /all shows it and WIN-A finds win-b past the router', () => {
  const { t, h, win } = lab();
  assert.match(win('WIN-A', 'ping -n 1 win-b'), /could not find host win-b/);
  setWindowsWins(h('WIN-B'), SRV_IP);
  t.net.runFor(1000);
  assert.match(win('WIN-B', 'ipconfig /all'), /Primary WINS Server\.+: 192\.168\.10\.2/);
  assert.match(win('WIN-A', 'ping -n 1 win-b'), /Pinging win-b \[192\.168\.20\.11\][\s\S]*Reply from 192\.168\.20\.11/);
});

test('saved and read back, the WINS server serves again and WIN-A registers again', () => {
  const { t } = lab();
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  back.net.runFor(1000);
  const { h } = lab(back);
  assert.equal(windowsWinsManual(h('WIN-A')), SRV_IP);
  assert.deepEqual(names(h('SRV-WINS')), ['WIN-A<00>', 'WIN-A<20>', 'WORKGROUP<00>']);
});
