/** Network configuration from the Linux terminal: ip, netplan, dhclient and hostnamectl change the device (and notify the GUI). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Switch } from '../../src/devices/switch.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

function lab(): { t: Topology; srv: Server; pc: Pc; changes: () => number } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'LAN', start: ip('10.0.0.100'), prefix: 24, maxUsers: 20, leaseMinutes: 60, reservations: [], gateway: ip('10.0.0.1'), dns: ip('10.0.0.2') }] } });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, gateway: ip('10.0.0.1') });
  t.settle();
  let n = 0;
  pc.onChange(() => { n++; });
  return { t, srv, pc, changes: () => n };
}

test('ip addr/route/link change the running configuration and notify the GUI', () => {
  const { pc, changes } = lab();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('ip addr del 10.0.0.10/24 dev eth0; echo $?'), ['RTNETLINK answers: Operation not permitted', '2']);
  const root = createShell(pc, 'linux', 'root');
  assert.deepEqual(root.run('ip addr add 10.0.0.11/24 dev eth0'), ['Netfix: one IPv4 address per interface; remove eth0\'s current address first (ip addr del … dev eth0).']);
  assert.deepEqual(root.run('ip addr del 10.0.0.99/24 dev eth0'), ['RTNETLINK answers: Cannot assign requested address']);
  const before = changes();
  root.run('ip addr del 10.0.0.10/24 dev eth0');
  assert.equal(pc.config.ip, undefined);
  assert.equal(pc.config.gateway, undefined, 'the default route goes with the address');
  assert.ok(changes() > before);
  root.run('ip a add 192.168.5.20/24 dev eth0');
  assert.deepEqual([formatIp(pc.config.ip ?? 0), pc.config.prefix], ['192.168.5.20', 24]);
  assert.deepEqual(root.run('ip route add default via 10.9.9.9'), ['Error: Nexthop has invalid gateway.']);
  root.run('ip route add default via 192.168.5.1 dev eth0');
  assert.equal(formatIp(pc.config.gateway ?? 0), '192.168.5.1');
  assert.deepEqual(root.run('ip route add default via 192.168.5.254'), ['RTNETLINK answers: File exists']);
  root.run('ip route replace default via 192.168.5.254');
  assert.match(all(root.run('ip route')), /^default via 192\.168\.5\.254 dev eth0 proto static/);
  root.run('ip route del default');
  assert.deepEqual(root.run('ip route del default'), ['RTNETLINK answers: No such process']);
  assert.deepEqual(root.run('ip addr add 1.1.1.1/8 dev eth7'), ['Cannot find device "eth7"']);
  root.run('ip link set dev eth0 down');
  assert.equal(pc.portUp, false);
  assert.match(all(root.run('ip -br link')), /eth0\s+DOWN/);
  root.run('ip link set eth0 up');
  assert.equal(pc.portUp, true);
  root.run('ip addr flush dev eth0');
  assert.equal(pc.config.ip, undefined);
});

test('netplan: editing the YAML and applying it changes the device; the file keeps the edited text', () => {
  const { pc } = lab();
  const root = createShell(pc, 'linux', 'root');
  const fs = hostSystem(pc).fs;
  assert.equal(fs.stat('/etc/netplan/50-cloud-init.yaml').mode & 0o777, 0o600);
  assert.match(all(createShell(pc, 'linux').run('cat /etc/netplan/50-cloud-init.yaml')), /Permission denied/);
  const yaml = 'network:\n  version: 2\n  ethernets:\n    eth0:\n      # oficina\n      addresses: [172.16.1.50/16]\n      routes:\n        - to: default\n          via: 172.16.0.1\n      nameservers:\n        addresses: [8.8.8.8]\n';
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', yaml);
  assert.equal(formatIp(pc.config.ip ?? 0), '10.0.0.10', 'not applied yet');
  assert.deepEqual(root.run('netplan apply; echo $?'), ['0']);
  assert.deepEqual([formatIp(pc.config.ip ?? 0), pc.config.prefix, formatIp(pc.config.gateway ?? 0), formatIp(pc.config.dns ?? 0)], ['172.16.1.50', 16, '172.16.0.1', '8.8.8.8']);
  assert.equal(fs.readFile('/etc/netplan/50-cloud-init.yaml'), yaml, 'the edited text stays');
  // A change from the GUI regenerates the file.
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  assert.match(fs.readFile('/etc/netplan/50-cloud-init.yaml'), /addresses:\n {8}- 10\.0\.0\.10\/24/);
  // DHCP from netplan.
  root.run("sed -i 's/dhcp4: false/dhcp4: true/' /etc/netplan/50-cloud-init.yaml");
  root.run('netplan apply');
  assert.equal(pc.config.mode, 'dhcp');
  assert.ok(pc.config.ip !== undefined && pc.config.ip >= ip('10.0.0.100'));
  // Errors in netplan's format; nothing changes.
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', 'network:\n  ethernets:\n    eth0:\n      adresses: [1.2.3.4/24]\n');
  assert.match(all(root.run('netplan apply; echo $?')), /^\/etc\/netplan\/50-cloud-init\.yaml:1:1: Error in network definition: unknown key 'adresses'\n78$/);
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', 'network:\n\tversion: 2\n');
  assert.match(all(root.run('netplan generate')), /50-cloud-init\.yaml:2:1: Invalid YAML: .*tabs/);
  assert.equal(pc.config.mode, 'dhcp');
});

test('netplan: several files merge in order, gateway4 warns, try reverts without confirmation', () => {
  const { pc } = lab();
  const root = createShell(pc, 'linux', 'root');
  const fs = hostSystem(pc).fs;
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', 'network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: no\n      addresses: [192.168.7.7/24]\n');
  fs.writeFile('/etc/netplan/90-gw.yaml', 'network:\n  ethernets:\n    eth0:\n      gateway4: 192.168.7.1\n');
  assert.match(all(root.run('netplan apply')), /WARNING \*\*: .*`gateway4` has been deprecated/);
  assert.equal(formatIp(pc.config.gateway ?? 0), '192.168.7.1');
  assert.match(all(root.run('netplan get')), /addresses:\n {8}- 192\.168\.7\.7\/24\n {6}routes:\n {8}- to: default\n {10}via: 192\.168\.7\.1/);
  root.run('rm /etc/netplan/90-gw.yaml');
  fs.writeFile('/etc/netplan/50-cloud-init.yaml', 'network:\n  version: 2\n  ethernets:\n    eth0:\n      addresses: [192.168.8.8/24]\n');
  assert.match(all(root.run('netplan try')), /Press ENTER before the timeout/);
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.8.8');
  assert.deepEqual(root.eof?.(), ['', 'Reverting.']);
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.7.7');
  root.run('netplan try');
  assert.deepEqual(root.run(''), ['Configuration accepted.']);
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.8.8');
});

test('dhclient -r and hostnamectl notify the GUI', () => {
  const { pc, changes } = lab();
  const root = createShell(pc, 'linux', 'root');
  let n = changes();
  root.run('hostnamectl set-hostname --pretty "Puesto del profesor"');
  assert.equal(pc.prettyName, 'Puesto del profesor');
  assert.ok(changes() > n);
  n = changes();
  root.run('hostname temporal');
  assert.equal(pc.transientName, 'temporal');
  assert.ok(changes() > n);
  root.run('dhclient eth0');
  n = changes();
  root.run('dhclient -r');
  assert.equal(pc.config.ip, undefined);
  assert.ok(changes() > n);
});
