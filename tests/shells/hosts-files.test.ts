/** /etc/hosts and C:\Windows\System32\drivers\etc\hosts behave as on Ubuntu and Windows. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { resolveHost } from '../../src/shells/net-tools.ts';
import type { Pc } from '../../src/devices/pc.ts';

const all = (lines: readonly string[]): string => lines.join('\n').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function lab(): Pc {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  pc.setStatic({ ip: 0x0a000002, prefix: 24 });
  return pc;
}

/** An Ubuntu PC (systemd-resolved runs). */
function ubuntu(): Pc {
  const pc = lab();
  pc.os = 'linux';
  return pc;
}

test('Ubuntu\'s /etc/hosts: localhost, 127.0.1.1 with the host name as it is, and the IPv6 lines', () => {
  const pc = lab();
  assert.equal(all(createShell(pc, 'linux').run('cat /etc/hosts')), [
    '127.0.0.1 localhost', '127.0.1.1 PC0', '', '# The following lines are desirable for IPv6 capable hosts',
    '::1     ip6-localhost ip6-loopback', 'fe00::0 ip6-localnet', 'ff00::0 ip6-mcastprefix', 'ff02::1 ip6-allnodes', 'ff02::2 ip6-allrouters'].join('\n'));
});

test('GNU/Linux: the own name comes from /etc/hosts (127.0.1.1), case does not matter; without its line, the name in use still resolves', () => {
  const pc = ubuntu();
  const root = createShell(pc, 'linux', 'root');
  assert.match(all(root.run('ping -c 1 pc0')), /^PING pc0 \(127\.0\.1\.1\)/);
  assert.match(all(root.run('getent hosts PC0')), /^127\.0\.1\.1\s+PC0$/);
  root.run("printf '127.0.0.1 localhost\\n' > /etc/hosts");
  assert.match(all(root.run('ping -c 1 PC0')), /^PING PC0 \(10\.0\.0\.2\)/, 'synthesised, as systemd-resolved does');
  root.run('hostname Temporal');
  assert.match(all(root.run('ping -c 1 temporal')), /^PING temporal \(10\.0\.0\.2\)/, 'the transient name too');
});

test('GNU/Linux follows «hosts:» of nsswitch.conf: without files, /etc/hosts is not read', () => {
  const pc = lab();
  const root = createShell(pc, 'linux', 'root');
  root.run("echo '10.0.0.9 nas' >> /etc/hosts");
  assert.equal(resolveHost(pc, 'nas', 'linux').kind, 'ip');
  root.run("sed -i 's/^hosts:.*/hosts: dns/' /etc/nsswitch.conf");
  assert.equal(resolveHost(pc, 'nas', 'linux').kind, 'error');
  assert.match(all(root.run('getent hosts nas; echo $?')), /^2$/);
});

test('Windows reads its own hosts file, not /etc/hosts: the default only has comments and localhost works anyway', () => {
  const pc = lab();
  const win = createShell(pc, 'windows');
  const text = all(win.run('type C:\\Windows\\System32\\drivers\\etc\\hosts'));
  assert.match(text, /^# This is a sample HOSTS file used by Microsoft TCP\/IP for Windows\.$/m);
  assert.match(text, /^# localhost name resolution is handled within DNS itself\.$/m);
  assert.match(all(win.run('ping -n 1 localhost')), /Pinging .*\[127\.0\.0\.1\]|Pinging 127\.0\.0\.1/);
  createShell(pc, 'linux', 'root').run("echo '10.0.0.9 nas' >> /etc/hosts");
  assert.match(all(win.run('ping -n 1 nas')), /^Ping request could not find host nas\./m, '/etc/hosts is GNU/Linux\'s');
});

test('Windows hosts: the Administrators write it; entries apply at once, any case, first line wins, # comments', () => {
  const pc = lab();
  const user = createShell(pc, 'windows');
  user.run('dir C:\\');
  assert.equal(all(createShell(pc, 'linux').run('stat -c "%U %g %a" /mnt/c/Windows/System32/drivers/etc/hosts')), 'root 27 664', 'Administrators: the sudo group');
  assert.deepEqual(user.run('echo 10.0.0.9   NAS.aula.lan  nas   # el NAS>> C:\\Windows\\System32\\drivers\\etc\\hosts'), []);
  createShell(pc, 'linux', 'root').run("echo '10.0.0.8 nas' >> /mnt/c/Windows/System32/drivers/etc/hosts");
  assert.match(all(user.run('ping -n 1 Nas')), /Pinging Nas \[10\.0\.0\.9\]/);
  assert.match(all(user.run('ping -n 1 nas.AULA.lan')), /\[10\.0\.0\.9\]/);
  assert.match(all(user.run('nslookup nas')), /can't find nas|Non-existent domain|No response|timed out|UnKnown/i, 'nslookup asks the DNS server only');
});

test('the Windows hosts file is saved with the lab', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  pc.setStatic({ ip: 0x0a000002, prefix: 24 });
  createShell(pc, 'linux', 'root').run("mkdir -p /mnt/c/Windows/System32/drivers/etc; echo '10.0.0.7 impresora' > /mnt/c/Windows/System32/drivers/etc/hosts");
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON()))).byLabel('PC0') as Pc;
  assert.deepEqual(resolveHost(again, 'impresora', 'windows'), { kind: 'ip', ip: 0x0a000007, name: 'impresora', viaDns: false });
});

test('a lab saved before C:\\ moved to /mnt/c keeps its Windows hosts file', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  pc.setStatic({ ip: 0x0a000002, prefix: 24 });
  createShell(pc, 'linux', 'root').run("mkdir -p /Windows/System32/drivers/etc; echo '10.0.0.7 impresora' > /Windows/System32/drivers/etc/hosts");
  // Saved as Netfix 0.46 did; reading it needs no system, opening the terminal moves it to C:\.
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON()))).byLabel('PC0') as Pc;
  assert.deepEqual(resolveHost(again, 'impresora', 'windows'), { kind: 'ip', ip: 0x0a000007, name: 'impresora', viaDns: false });
  assert.match(all(createShell(again, 'windows').run('type C:\\Windows\\System32\\drivers\\etc\\hosts')), /^10\.0\.0\.7 impresora$/m);
  assert.equal(resolveHost(again, 'impresora', 'windows').kind, 'ip');
});

test('review: each terminal\'s ssh resolves as its system does', () => {
  const pc = lab();
  const root = createShell(pc, 'linux', 'root');
  root.run("echo '10.0.0.9 nas' >> /etc/hosts");
  assert.doesNotMatch(all(root.run('ssh alumno@nas')), /Could not resolve hostname/, 'the GNU/Linux terminal reads /etc/hosts');
  assert.match(all(createShell(pc, 'windows').run('ssh alumno@nas')), /Could not resolve hostname/, 'the Windows one does not');
});

test('review: the own name is synthesised only by systemd-resolved behind dns or resolve', () => {
  const pc = ubuntu();
  const root = createShell(pc, 'linux', 'root');
  root.run("printf '127.0.0.1 localhost\\n' > /etc/hosts; sed -i 's/^hosts:.*/hosts: files/' /etc/nsswitch.conf");
  assert.equal(resolveHost(pc, 'PC0', 'linux').kind, 'error', 'hosts: files and no 127.0.1.1 line');
  root.run("sed -i 's/^hosts:.*/hosts: files dns/' /etc/nsswitch.conf");
  assert.equal(resolveHost(pc, 'PC0', 'linux').kind, 'ip');
  root.run('systemctl stop systemd-resolved');
  assert.equal(resolveHost(pc, 'PC0', 'linux').kind, 'error', 'resolved stopped');
});

test('review: a /Windows that is not a folder does not break the Windows terminal', () => {
  const pc = lab();
  createShell(pc, 'linux', 'root').run('touch /Windows');
  assert.match(all(createShell(pc, 'windows').run('dir C:\\')), /Directory of C:\\/);
});
