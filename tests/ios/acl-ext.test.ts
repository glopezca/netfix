/** IOS extended ACLs: numbered and named, ports and operators, ip access-group in/out, NAT exemption. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { Session } from '../../src/ios/session.ts';
import type { IosDevice } from '../../src/ios/device.ts';
import { parseIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';

function cli(d: IosDevice, mode: 'config' | 'exec', ...lines: string[]): string[] {
  const s = new Session(d);
  s.mode = mode;
  return lines.flatMap((l) => s.input(l));
}

const ip = (t: string): number => parseIp(t)!;

/** PC 192.168.1.10 ── G0/0 R G0/1 ── SRV 10.0.0.2 (web, SSH) */
function help(d: IosDevice, line: string): string[] {
  const s = new Session(d);
  s.mode = 'config';
  return s.help(line);
}

function lab(): { t: Topology; r: Router; pc: Pc; srv: Server; logs: string[] } {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: pc.id, port: 'FastEthernet0' });
  t.connect({ device: r.id, port: 'GigabitEthernet0/1' }, { device: srv.id, port: 'FastEthernet0' });
  cli(r, 'config', 'interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown');
  pc.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24, gateway: ip('10.0.0.1') });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  t.settle();
  const logs: string[] = [];
  r.onConsole((l) => logs.push(l));
  return { t, r, pc, srv, logs };
}

const sh = (pc: Pc, cmd: string): string => createShell(pc, 'linux').run(cmd).join('\n');

test('extended ACL in on the LAN: web allowed, SSH denied (logged), ping denied with an unreachable', () => {
  const { r, pc, logs } = lab();
  assert.deepEqual(cli(r, 'config',
    'access-list 100 permit tcp 192.168.1.0 0.0.0.255 host 10.0.0.2 eq www',
    'access-list 100 deny tcp any any eq 22 log',
    'access-list 100 permit icmp any any echo-reply',
    'interface g0/0', 'ip access-group 100 in'), []);
  assert.match(sh(pc, 'curl -s http://10.0.0.2/'), /Servidor web de Netfix/);
  assert.match(sh(pc, 'nc -z -w 1 10.0.0.2 22'), /timed out/);
  assert.match(sh(pc, 'ping -c 1 10.0.0.2'), /From 192\.168\.1\.1 icmp_seq=1 Packet filtered/);
  const show = cli(r, 'exec', 'show access-lists').join('\n');
  assert.match(show, /^Extended IP access list 100\n {4}10 permit tcp 192\.168\.1\.0 0\.0\.0\.255 host 10\.0\.0\.2 eq www \(\d+ match\(es\)\)\n {4}20 deny tcp any any eq 22 log \(1 match\(es\)\)\n {4}30 permit icmp any any echo-reply$/);
  assert.match(logs.join('\n'), /%SEC-6-IPACCESSLOGP: list 100 denied tcp 192\.168\.1\.10\(\d+\) -> 10\.0\.0\.2\(22\), 1 packet/);
  const run = cli(r, 'exec', 'show running-config').join('\n');
  assert.match(run, /interface GigabitEthernet0\/0\n ip address 192\.168\.1\.1 255\.255\.255\.0\n ip access-group 100 in\n/);
  assert.match(run, /access-list 100 permit tcp 192\.168\.1\.0 0\.0\.0\.255 host 10\.0\.0\.2 eq www\naccess-list 100 deny tcp any any eq 22 log/);
});

test('named extended ACL out, established, ranges, errors and running-config block', () => {
  const { r, pc, srv } = lab();
  cli(r, 'config', 'ip access-list extended TO-LAN', 'permit tcp any any established', 'permit icmp any any', '15 permit udp host 10.0.0.2 range 50 60 any', 'exit',
    'interface g0/0', 'ip access-group TO-LAN out');
  assert.match(sh(pc, 'curl -s http://10.0.0.2/'), /Servidor web de Netfix/, 'the replies are established');
  assert.match(createShell(srv, 'linux').run('nc -z -w 1 192.168.1.10 22').join('\n'), /failed: No route to host/, 'new TCP from the server is blocked: the router answers ICMP admin-prohibited');
  assert.match(cli(r, 'exec', 'show ip access-lists TO-LAN').join('\n'), /^Extended IP access list TO-LAN\n {4}10 permit tcp any any established \(\d+ match\(es\)\)\n {4}15 permit udp host 10\.0\.0\.2 range 50 60 any\n {4}20 permit icmp any any/);
  assert.match(cli(r, 'exec', 'show running-config').join('\n'), /ip access-list extended TO-LAN\n permit tcp any any established\n permit udp host 10\.0\.0\.2 range 50 60 any\n permit icmp any any/);
  assert.deepEqual(cli(r, 'config', 'access-list 101 permit tcp any'), ['% Incomplete command.']);
  assert.deepEqual(cli(r, 'config', 'access-list 101 permit icmp any any eq 80'), ['% Invalid input detected.']);
  assert.deepEqual(cli(r, 'config', 'ip access-list standard TO-LAN'), ['% A named extended IP access list with this name already exists']);
  assert.match(help(r, 'access-list 100 permit ').join('\n'), /tcp\s+Transmission Control Protocol/);
});

test('NAT exemption: an extended NAT list denies LAN-to-LAN so it is not translated', () => {
  const { r, pc } = lab();
  cli(r, 'config', 'interface g0/0', 'ip nat inside', 'interface g0/1', 'ip nat outside', 'exit',
    'access-list 110 deny ip 192.168.1.0 0.0.0.255 10.0.0.0 0.0.0.255', 'access-list 110 permit ip 192.168.1.0 0.0.0.255 any',
    'ip nat inside source list 110 interface g0/1 overload');
  assert.match(sh(pc, 'ping -c 3 10.0.0.2'), / [23] received/, 'the first echo may be lost to ARP, as on IOS');
  assert.equal(r.natTable.entries().length, 0, 'traffic to 10.0.0.0/24 is exempt');
});
