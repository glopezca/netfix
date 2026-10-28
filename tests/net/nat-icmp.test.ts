/**
 * ICMP errors "related" to a translated connection go back through the NAT (RFC 5508): the router translates the
 * outer destination and the quoted header back to the inside local address and port, so the client behind the NAT
 * learns that its connection failed. Both IOS NAT and nftables masquerade on a Linux router.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { NatTable } from '../../src/net/nat.ts';
import { rootScript } from '../../src/net/labs-linux.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import type { IpPacket } from '../../src/net/packets.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

const R1 = `
hostname R1
interface GigabitEthernet0/0
 ip address 192.168.1.1 255.255.255.0
 ip nat inside
 no shutdown
interface GigabitEthernet0/1
 ip address 10.0.0.1 255.255.255.252
 ip nat outside
 no shutdown
access-list 1 permit 192.168.1.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/1 overload
ip route 0.0.0.0 0.0.0.0 10.0.0.2`;

const R2 = `
hostname R2
interface GigabitEthernet0/0
 ip address 10.0.0.2 255.255.255.252
 ip access-group 100 in
 no shutdown
interface GigabitEthernet0/1
 ip address 172.16.0.1 255.255.255.0
 no shutdown
access-list 100 deny tcp any any eq 22
access-list 100 permit ip any any`;

function lab(linux = false): Pc {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const r1 = (linux ? t.add('linuxrouter', 100, 0).device : t.add('router', 100, 0).device) as Router | LinuxRouter;
  const r2 = t.add('router', 200, 0).device as Router;
  const srv = t.add('server', 300, 0).device as Server;
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: r1.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: r1.id, port: 'GigabitEthernet0/1' }, { device: r2.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: r2.id, port: 'GigabitEthernet0/1' }, { device: srv.id, port: 'FastEthernet0' });
  applyConfig(r2, R2.trim().split('\n'));
  if (r1.kind === 'router') applyConfig(r1, R1.trim().split('\n'));
  else {
    t.settle();
    rootScript(r1, `ip addr add 192.168.1.1/24 dev eth0
ip addr add 10.0.0.1/30 dev eth1
ip route add default via 10.0.0.2
sysctl -q -w net.ipv4.ip_forward=1
nft add table ip nat
nft add chain ip nat post '{ type nat hook postrouting priority srcnat; }'
nft add rule ip nat post oifname eth1 masquerade`);
  }
  pc.os = 'linux';
  pc.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  srv.setStatic({ ip: ip('172.16.0.10'), prefix: 24, gateway: ip('172.16.0.1') });
  t.settle();
  return pc;
}

test('behind IOS PAT, a connection denied further on fails at once with No route to host', () => {
  const sh = createShell(lab(), 'linux', 'alumno');
  assert.deepEqual(sh.run('curl -s -o /dev/null -w "%{http_code}\\n" http://172.16.0.10/'), ['200'], 'the permitted traffic goes through the NAT');
  assert.match(sh.run('nc -zv -w 3 172.16.0.10 22 2>&1').join('\n'), /failed: No route to host/);
});

test('NatTable.outside translates an ICMP error back: outer destination and quoted source', () => {
  const nat = new NatTable();
  const out = nat.inside({ src: ip('192.168.1.10'), dst: ip('172.16.0.10'), ttl: 64, protocol: 'tcp', tcp: { sport: 40000, dport: 22, seq: 0, ack: 0, flags: ['SYN'] } } as unknown as IpPacket, [], () => ({ global: ip('10.0.0.1'), overload: true }));
  assert.ok(out && out !== 'drop');
  const sport = out.tcp?.sport ?? 0;
  const error: IpPacket = { src: ip('10.0.0.2'), dst: ip('10.0.0.1'), ttl: 255, protocol: 'icmp', icmp: { type: 'unreachable', id: 0, seq: 0, code: 'admin', orig: { protocol: 'tcp', src: ip('10.0.0.1'), dst: ip('172.16.0.10'), sport, dport: 22 } } };
  const back = nat.outside(error, []);
  assert.equal(back?.dst, ip('192.168.1.10'));
  assert.deepEqual(back?.icmp?.orig, { protocol: 'tcp', src: ip('192.168.1.10'), dst: ip('172.16.0.10'), sport: 40000, dport: 22 });
  assert.equal(nat.outside({ ...error, icmp: { ...error.icmp!, orig: { ...error.icmp!.orig!, sport: sport + 1 } } }, []), null, 'an error about no translation is not forwarded inside');
});

test('behind nftables masquerade on a Linux router, the error is translated back too', () => {
  const sh = createShell(lab(true), 'linux', 'alumno');
  assert.deepEqual(sh.run('curl -s -o /dev/null -w "%{http_code}\\n" http://172.16.0.10/'), ['200']);
  assert.match(sh.run('nc -zv -w 3 172.16.0.10 22 2>&1').join('\n'), /failed: No route to host/);
});
