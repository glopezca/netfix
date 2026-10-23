/** The address under each interface name at a cable end, and the caption that keeps only unlinked addresses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { portAddresses } from '../../src/ui/port-address.ts';
import { deviceCaption } from '../../src/ui/device-caption.ts';
import { parseIp } from '../../src/core/ip.ts';

test('a PC, an IOS router (also its subinterfaces on a trunk) and a cloud line', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0);
  (pc.device as Pc).setStatic({ ip: parseIp('192.168.1.10')!, prefix: 24 });
  assert.deepEqual(portAddresses(pc, 'FastEthernet0'), ['192.168.1.10/24']);
  const r = t.add('router', 0, 0);
  applyConfig(r.device as Router, ['interface GigabitEthernet0/0', ' ip address 10.0.0.1 255.255.255.252', 'interface GigabitEthernet0/1.10', ' encapsulation dot1Q 10', ' ip address 172.16.10.1 255.255.255.0', 'interface GigabitEthernet0/1.20', ' encapsulation dot1Q 20', ' ip address 172.16.20.1 255.255.255.0']);
  assert.deepEqual(portAddresses(r, 'GigabitEthernet0/0'), ['10.0.0.1/30']);
  assert.deepEqual(portAddresses(r, 'GigabitEthernet0/1'), ['172.16.10.1/24', '172.16.20.1/24'], 'router on a stick');
  assert.deepEqual(portAddresses(r, 'GigabitEthernet0/2'), []);
  const c = t.add('cloud', 0, 0);
  assert.deepEqual(portAddresses(c, 'Fibra0'), ['192.168.1.1/24'], 'the operator router LAN');
  const cloud = c.device as Cloud;
  cloud.setSettings({ ...cloud.settings, ports: { ...cloud.settings.ports, Coaxial0: { ...cloud.settings.ports.Coaxial0, mode: 'public' } } });
  assert.match(portAddresses(c, 'Coaxial0')[0] ?? '', /^81\.32\.\d+\.1\/29$/, 'a public line: its gateway');
});

test('the caption keeps only the addresses of interfaces without a cable', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0);
  (pc.device as Pc).setStatic({ ip: parseIp('192.168.1.10')!, prefix: 24 });
  assert.deepEqual(deviceCaption(pc, () => false).extra, ['192.168.1.10/24']);
  assert.deepEqual(deviceCaption(pc, () => true).extra, [], 'with a cable, it goes at the end of the cable');
});

test('review: on a short cable the address is left out so the two ends do not meet', async () => {
  const { endLabel } = await import('../../src/ui/link-labels.ts');
  const t = new Topology();
  const a = t.add('pc', 0, 0);
  const b = t.add('pc', 140, 0);
  (a.device as Pc).setStatic({ ip: parseIp('192.168.1.10')!, prefix: 24 });
  t.connect({ device: a.device.id, port: 'FastEthernet0' }, { device: b.device.id, port: 'FastEthernet0' });
  const linked = (): boolean => true;
  assert.deepEqual(endLabel(a, b, 'FastEthernet0', linked).lines, ['Fa0'], 'no room: only the name');
  b.x = 600;
  assert.deepEqual(endLabel(a, b, 'FastEthernet0', linked).lines, ['Fa0', '192.168.1.10/24']);
});

test('review: IOS addresses with no cable end (SVI, loopback) go under the device', () => {
  const t = new Topology();
  const sw = t.add('switch', 0, 0);
  applyConfig(sw.device as Router, ['interface Vlan1', ' ip address 192.168.1.2 255.255.255.0', ' no shutdown']);
  assert.deepEqual(deviceCaption(sw, () => true).extra, ['Vlan1 192.168.1.2/24']);
  const r = t.add('router', 0, 0);
  applyConfig(r.device as Router, ['hostname R1', 'interface Loopback0', ' ip address 1.1.1.1 255.255.255.255']);
  assert.deepEqual(deviceCaption(r, () => true).extra, ['R1', 'Lo0 1.1.1.1/32']);
});
