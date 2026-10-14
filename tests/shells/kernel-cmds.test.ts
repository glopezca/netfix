/** sysctl, /proc/sys, nft, dmesg and nftables.service from the Ubuntu shell; boot of saved settings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  t.settle();
  return { t, srv, pc };
}

test('sysctl reads, writes as root, validates and mirrors /proc/sys', () => {
  const { srv } = lab();
  const admin = createShell(srv, 'linux');
  const root = createShell(srv, 'linux', 'root');
  assert.deepEqual(admin.run('sysctl net.ipv4.ip_forward'), ['net.ipv4.ip_forward = 0']);
  assert.deepEqual(admin.run('sysctl -n net/ipv4/ip_forward'), ['0']);
  assert.deepEqual(admin.run('sysctl -w net.ipv4.ip_forward=1; echo $?'), ['sysctl: permission denied on key "net.ipv4.ip_forward"', '255']);
  assert.deepEqual(root.run('sysctl -w net.ipv4.ip_forward=1'), ['net.ipv4.ip_forward = 1']);
  assert.deepEqual(root.run('cat /proc/sys/net/ipv4/conf/all/forwarding'), ['1']);
  assert.deepEqual(root.run('echo 0 > /proc/sys/net/ipv4/ip_forward; sysctl net.ipv4.ip_forward'), ['net.ipv4.ip_forward = 0']);
  assert.match(all(root.run('echo 7 > /proc/sys/net/ipv4/ip_forward')), /write error: Invalid argument/);
  assert.deepEqual(root.run('sysctl net.ipv4.ip_forward=2'), ['sysctl: setting key "net.ipv4.ip_forward": Invalid argument']);
  assert.deepEqual(root.run('sysctl net.ipv4.nope'), ['sysctl: cannot stat /proc/sys/net/ipv4/nope: No such file or directory']);
  root.run('sysctl kernel.hostname=bastion');
  assert.equal(srv.runtimeName(), 'bastion', 'kernel.hostname is the running host name');
  assert.ok(root.run('sysctl -a').includes('vm.swappiness = 60'));
});

test('sysctl -p and --system apply files; settings saved in files survive a reload of the topology', () => {
  const { t, srv } = lab();
  const root = createShell(srv, 'linux', 'root');
  root.run("echo 'net.ipv4.icmp_echo_ignore_all = 1' > /etc/sysctl.d/90-lab.conf");
  root.run("sed -i 's/^#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf");
  assert.deepEqual(root.run('sysctl -p'), ['net.ipv4.ip_forward = 1']);
  const sys = root.run('sysctl --system');
  assert.deepEqual(sys.filter((l) => l.startsWith('*')), ['* Applying /etc/sysctl.d/10-network-security.conf ...', '* Applying /etc/sysctl.d/90-lab.conf ...', '* Applying /etc/sysctl.conf ...']);
  const saved = t.toJSON();
  const t2 = Topology.fromJSON(saved);
  const srv2 = t2.get(srv.id)?.device as Server;
  assert.equal(srv2.kernel.sysctl.get('net.ipv4.icmp_echo_ignore_all'), '1', 'boot applies /etc/sysctl.d');
  assert.equal(srv2.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
  root.run('sysctl -w net.ipv4.ip_default_ttl=99');
  const t3 = Topology.fromJSON(t.toJSON());
  const srv3 = t3.get(srv.id)?.device as Server;
  assert.equal(srv3.kernel.sysctl.get('net.ipv4.ip_default_ttl'), '64', 'sysctl -w is lost on reboot');
});

test('nft from the shell: root only, rules affect traffic, -a, -c, errors, dmesg', () => {
  const { t, srv, pc } = lab();
  const admin = createShell(srv, 'linux');
  const root = createShell(srv, 'linux', 'root');
  assert.deepEqual(admin.run('nft list ruleset; echo $?'), ['netlink: Error: cache initialization failed: Operation not permitted', '1']);
  assert.deepEqual(root.run('nft -v'), ['nftables v1.1.1 (Commodore Bullseye 2)']);
  root.run('nft add table inet filter');
  root.run('nft add chain inet filter input { type filter hook input priority 0 \\; policy accept \\; }');
  root.run('nft add rule inet filter input icmp type echo-request counter log prefix \\"PING \\" drop');
  const sh = createShell(pc, 'linux');
  assert.match(all(sh.run('ping -c 1 10.0.0.2')), /100% packet loss/);
  assert.match(all(root.run('nft -a list ruleset')), /icmp type echo-request counter packets 1 bytes 40 log prefix "PING " drop # handle 3/);
  assert.match(all(root.run('nft -s list ruleset')), /icmp type echo-request counter log prefix "PING " drop/);
  assert.match(all(root.run('dmesg')), /\] PING IN=eth0 OUT= SRC=10\.0\.0\.10 DST=10\.0\.0\.2 .*PROTO=ICMP/);
  assert.deepEqual(admin.run('dmesg'), ['dmesg: read kernel buffer failed: Operation not permitted']);
  assert.deepEqual(root.run('nft -c delete rule inet filter input handle 3; nft list chain inet filter input | grep -c drop'), ['1'], '-c does not apply');
  root.run('nft delete rule inet filter input handle 3');
  assert.match(all(sh.run('ping -c 1 10.0.0.2')), / 0% packet loss/);
  assert.match(all(root.run('nft add rule inet filter input tcp dport 22 acept')), /^Error: syntax error, unexpected acept\nadd rule inet filter input tcp dport 22 acept\n {40}\^{5}$/);
  void t;
});

test('nftables.service loads /etc/nftables.conf; a broken file fails like systemd; stop flushes', () => {
  const { srv, pc } = lab();
  const root = createShell(srv, 'linux', 'root');
  const sh = createShell(pc, 'linux');
  assert.match(all(root.run('systemctl status nftables')), /○ nftables\.service - nftables\n {5}Loaded: loaded \(\/usr\/lib\/systemd\/system\/nftables\.service; disabled; preset: enabled\)\n {5}Active: inactive \(dead\)/);
  root.run("sed -i 's/type filter hook input priority filter;/type filter hook input priority filter; policy drop;/' /etc/nftables.conf");
  root.run('systemctl enable --now nftables');
  assert.match(all(root.run('systemctl status nftables')), /Active: active \(exited\)/);
  assert.match(all(sh.run('ping -c 1 10.0.0.2')), /100% packet loss/);
  root.run("echo 'table inet broken { chain c { tcp dprt 1 accept } }' >> /etc/nftables.conf");
  assert.match(all(root.run('systemctl reload nftables')), /Job for nftables\.service failed/);
  assert.match(all(root.run('journalctl -u nftables')), /nft\[655\]: \/etc\/nftables\.conf: Error: syntax error[\s\S]*Reload failed for nftables\.service - nftables\./);
  assert.match(all(sh.run('ping -c 1 10.0.0.2')), /100% packet loss/, 'the running ruleset stays');
  root.run('systemctl stop nftables');
  assert.deepEqual(root.run('nft list ruleset'), []);
  assert.match(all(sh.run('ping -c 1 10.0.0.2')), / 0% packet loss/);
});
