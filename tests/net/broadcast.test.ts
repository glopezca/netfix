/**
 * Broadcast at the IP level, as on real devices: 255.255.255.255 and the directed broadcast of a subnet reach every
 * device of the segment; IOS answers an echo to them, Linux only with icmp_echo_ignore_broadcasts=0, Windows never;
 * each answer comes from the device's own address; routers do not forward directed broadcasts unless told to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import { applyConfig, Session } from '../../src/ios/session.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

/** LAN 1 (192.168.1.0/24): router Gi0/0 .1, Linux PC .10, Windows PC .11, server .20. LAN 2: Linux PC .10 on Gi0/1. */
function lab() {
  const t = new Topology();
  const sw = t.add('switch', 0, 0).device;
  const r = t.add('router', 0, 0).device as Router;
  const lx = t.add('pc', 0, 0).device as Pc;
  const win = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  const far = t.add('pc', 0, 0).device as Pc;
  const ports = sw.portNames();
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: ports[0]! });
  [lx, win, srv].forEach((d, i) => t.connect({ device: d.id, port: d.portNames()[0]! }, { device: sw.id, port: ports[i + 1]! }));
  t.connect({ device: r.id, port: 'GigabitEthernet0/1' }, { device: far.id, port: 'FastEthernet0' });
  lx.os = 'linux';
  far.os = 'linux';
  lx.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  win.setStatic({ ip: ip('192.168.1.11'), prefix: 24, gateway: ip('192.168.1.1') });
  srv.setStatic({ ip: ip('192.168.1.20'), prefix: 24, gateway: ip('192.168.1.1') });
  far.setStatic({ ip: ip('192.168.2.10'), prefix: 24, gateway: ip('192.168.2.1') });
  applyConfig(r, ['interface GigabitEthernet0/0', ' ip address 192.168.1.1 255.255.255.0', ' no shutdown', 'interface GigabitEthernet0/1', ' ip address 192.168.2.1 255.255.255.0', ' no shutdown']);
  t.settle(5000);
  return { t, r, lx, win, srv, far };
}

const iosRun = (r: Router, c: string): string => { const s = new Session(r); return ['enable', c].flatMap((l) => s.input(l)).join('\n'); };
const root = (d: Server | Pc, c: string): string => all(createShell(d, 'linux', 'root').run(c));
const from = (out: string): string[] => [...new Set([...out.matchAll(/from (\d+\.\d+\.\d+\.\d+)/g)].map((m) => m[1] ?? ''))].sort();

test('Linux ping asks for -b, then only the devices that answer broadcasts reply, each from its own address', () => {
  const { lx } = lab();
  const sh = createShell(lx, 'linux');
  assert.match(all(sh.run('ping -c 1 192.168.1.255')), /^ping: Do you want to ping broadcast\? Then -b\. If not, check your local firewall rules$/m);
  const out = all(sh.run('ping -b -c 2 192.168.1.255'));
  assert.match(out, /^WARNING: pinging broadcast address$/m);
  assert.deepEqual(from(out), ['192.168.1.1'], 'only the IOS router: Linux ignores broadcasts by default, Windows always');
  assert.doesNotMatch(out, /from 192\.168\.1\.255/);
  assert.deepEqual(from(all(sh.run('ping -b -c 1 255.255.255.255'))), ['192.168.1.1']);
});

test('icmp_echo_ignore_broadcasts=0: the server answers too, and Linux ping marks the duplicates', () => {
  const { lx, srv } = lab();
  root(srv, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  const out = all(createShell(lx, 'linux').run('ping -b -c 2 192.168.1.255'));
  assert.deepEqual(from(out), ['192.168.1.1', '192.168.1.20']);
  assert.match(out, /icmp_seq=1 .*\(DUP!\)$/m);
  assert.match(out, /2 packets transmitted, 2 received, \+2 duplicates, 0% packet loss/);
});

test('Windows shows one reply per request; IOS lists every device that answers', () => {
  const { r, win, srv } = lab();
  root(srv, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  const w = all(createShell(win, 'windows').run('ping -n 2 192.168.1.255'));
  assert.equal((w.match(/^Reply from 192\.168\.1\.(1|20): /gm) ?? []).length, 2, w);
  const ios = iosRun(r, 'ping 192.168.1.255 repeat 2');
  assert.match(ios, /Reply to request 0 from 192\.168\.1\.20, 1 ms/);
  assert.match(ios, /Reply to request 1 from 192\.168\.1\.20, 1 ms/);
  assert.doesNotMatch(ios, /Success rate/);
});

test('a directed broadcast of another subnet: the router answers it, and only forwards it with ip directed-broadcast', () => {
  const { r, lx, far } = lab();
  root(far, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  const sh = createShell(lx, 'linux');
  assert.deepEqual(from(all(sh.run('ping -c 1 192.168.2.255'))), ['192.168.2.1'], 'remote: no -b needed; not forwarded by default');
  applyConfig(r, ['interface GigabitEthernet0/1', ' ip directed-broadcast']);
  assert.deepEqual(from(all(sh.run('ping -c 1 192.168.2.255'))), ['192.168.2.1', '192.168.2.10']);
  assert.match(iosRun(r, 'show running-config'), /interface GigabitEthernet0\/1\n[^!]*ip directed-broadcast/);
});

test('a limited broadcast never crosses a router', () => {
  const { lx, far, srv } = lab();
  root(far, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  root(srv, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  assert.deepEqual(from(all(createShell(lx, 'linux').run('ping -b -c 1 255.255.255.255'))), ['192.168.1.1', '192.168.1.20']);
});

test('Linux router: bc_forwarding forwards a directed broadcast (0 by default)', () => {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as Server;
  const a = t.add('pc', 0, 0).device as Pc;
  const b = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: a.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/2' }, { device: b.id, port: 'FastEthernet0' });
  a.os = 'linux';
  b.os = 'linux';
  root(lr, 'ip addr add 10.1.0.1/24 dev eth1; ip addr add 10.2.0.1/24 dev eth2; sysctl -w net.ipv4.ip_forward=1');
  a.setStatic({ ip: ip('10.1.0.10'), prefix: 24, gateway: ip('10.1.0.1') });
  b.setStatic({ ip: ip('10.2.0.10'), prefix: 24, gateway: ip('10.2.0.1') });
  root(b, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  t.settle();
  const sh = createShell(a, 'linux');
  assert.deepEqual(from(all(sh.run('ping -c 1 10.2.0.255'))), []);
  root(lr, 'sysctl -w net.ipv4.conf.all.bc_forwarding=1');
  assert.deepEqual(from(all(sh.run('ping -c 1 10.2.0.255'))), ['10.2.0.10']);
});

test('review: a directed broadcast that arrived on its own subnet is never relayed again (no storm)', () => {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  const other = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/2' }, { device: pc.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: other.id, port: 'FastEthernet0' });
  root(lr, 'ip addr add 10.0.0.1/24 dev eth1; ip addr add 10.0.0.2/24 dev eth2; sysctl -w net.ipv4.ip_forward=1; sysctl -w net.ipv4.conf.all.bc_forwarding=1');
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  t.settle();
  const eth2 = lr.nics().find((n) => n.linux === 'eth2');
  assert.ok(eth2);
  let relayed = 0;
  t.net.onFrame((e) => { if (e.from.device === lr.id && e.frame.ip?.dst === ip('10.0.0.255') && e.frame.ip.icmp?.type === 'echo-request') relayed++; });
  lr.receive(eth2.port, { src: pc.mac, dst: 'ffffffffffff', ip: { src: ip('10.0.0.10'), dst: ip('10.0.0.255'), ttl: 64, protocol: 'icmp', icmp: { type: 'echo-request', id: 9, seq: 1 } } });
  t.settle();
  assert.equal(relayed, 0);
});

test('review: combined flags (-bc 1) and an outbound ACL also stop a relayed directed broadcast', () => {
  const { r, lx, far } = lab();
  root(far, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  const sh = createShell(lx, 'linux');
  assert.deepEqual(from(all(sh.run('ping -bc 1 192.168.1.255'))), ['192.168.1.1'], '-bc 1: the count, not the target');
  applyConfig(r, ['access-list 101 deny icmp any any', 'access-list 101 permit ip any any', 'interface GigabitEthernet0/1', ' ip directed-broadcast', ' ip access-group 101 out']);
  const out = all(sh.run('ping -c 1 192.168.2.255'));
  assert.doesNotMatch(out, /192\.168\.2\.10/, 'the ACL of the way out applies: the far network gets nothing');
  assert.match(out, /From 192\.168\.1\.1 icmp_seq=1 Packet filtered/, 'the router says so (administratively prohibited)');
});

test('ping -b from every kind of sender: Server, Linux router, IOS switch, Windows and a PC with a DHCP address', () => {
  const t = new Topology();
  const sw = t.add('switch', 0, 0).device;
  const r = t.add('router', 0, 0).device as Router;
  const srv = t.add('server', 0, 0).device as Server;
  const lr = t.add('linuxrouter', 0, 0).device as Server;
  const win = t.add('pc', 0, 0).device as Pc;
  const dyn = t.add('pc', 0, 0).device as Pc;
  const ports = sw.portNames();
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: ports[0]! });
  [srv, win, dyn].forEach((d, i) => t.connect({ device: d.id, port: d.portNames()[0]! }, { device: sw.id, port: ports[i + 1]! }));
  t.connect({ device: lr.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: ports[5]! });
  applyConfig(r, ['ip dhcp pool LAN', ' network 192.168.1.0 255.255.255.0', ' default-router 192.168.1.1', 'interface GigabitEthernet0/0', ' ip address 192.168.1.1 255.255.255.0', ' no shutdown']);
  applyConfig(sw as Router, ['interface Vlan1', ' ip address 192.168.1.2 255.255.255.0', ' no shutdown']);
  srv.setStatic({ ip: ip('192.168.1.20'), prefix: 24, gateway: ip('192.168.1.1') });
  win.setStatic({ ip: ip('192.168.1.11'), prefix: 24, gateway: ip('192.168.1.1') });
  root(lr, 'ip addr add 192.168.1.30/24 dev eth0');
  dyn.os = 'linux';
  dyn.useDhcp();
  t.settle(10_000);
  root(srv, 'sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  const ios = ['192.168.1.1', '192.168.1.2'];
  assert.deepEqual(from(root(srv, 'ping -b -c 1 192.168.1.255')), [...ios, '192.168.1.20'], 'the Server answers its own broadcast too, as Linux does');
  assert.deepEqual(from(root(lr, 'ping -b -c 1 192.168.1.255')), [...ios, '192.168.1.20']);
  assert.deepEqual(from(all(createShell(dyn, 'linux').run('ping -b -c 1 192.168.1.255'))), [...ios, '192.168.1.20']);
  assert.match(all(createShell(win, 'windows').run('ping -n 1 192.168.1.255')), /Reply from 192\.168\.1\.(1|2|20): /);
  const s = new Session(sw as Router);
  const out = ['enable', 'ping 192.168.1.255 repeat 1'].flatMap((l) => s.input(l)).join('\n');
  assert.match(out, /Reply to request 0 from 192\.168\.1\.1, 1 ms/);
  assert.match(out, /Reply to request 0 from 192\.168\.1\.20, 1 ms/);
});

test('review: a Linux router that forwards a directed broadcast answers it once, not twice', () => {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as Server;
  const a = t.add('pc', 0, 0).device as Pc;
  const b = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: a.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/2' }, { device: b.id, port: 'FastEthernet0' });
  a.os = 'linux';
  root(lr, 'ip addr add 10.1.0.1/24 dev eth1; ip addr add 10.2.0.1/24 dev eth2; sysctl -w net.ipv4.ip_forward=1; sysctl -w net.ipv4.conf.all.bc_forwarding=1; sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=0');
  a.setStatic({ ip: ip('10.1.0.10'), prefix: 24, gateway: ip('10.1.0.1') });
  b.setStatic({ ip: ip('10.2.0.10'), prefix: 24, gateway: ip('10.2.0.1') });
  t.settle();
  const out = all(createShell(a, 'linux').run('ping -c 1 10.2.0.255'));
  assert.equal((out.match(/from 10\.2\.0\.1:/g) ?? []).length, 1, out);
  assert.doesNotMatch(out, /DUP!/);
});
