import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Router } from '../../src/devices/router.ts';
import { Switch } from '../../src/devices/switch.ts';
import { Pc } from '../../src/devices/pc.ts';
import { pcCommand } from '../../src/devices/pc-console.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { openConsole } from '../helpers.ts';
import { formatIp } from '../../src/core/ip.ts';
import { compactList, parseVlanList } from '../../src/devices/snooping.ts';

test('switch CLI: prompts, vlans and running-config round trip', () => {
  const sw = new Switch();
  const c = openConsole(sw, 'config');
  c.run('vlan 30');
  assert.equal(c.session.prompt(), 'Switch(config-vlan)#');
  c.run('name SERVIDORES', 'exit');
  assert.deepEqual(c.run('vlan 1003'), ['Default VLAN 1003 may not have its name changed.']);
  assert.deepEqual(c.run('no vlan 1'), ['%Default VLAN 1 may not be deleted.']);
  c.run('interface range fa0/1 - 4', 'switchport mode access', 'switchport access vlan 30', 'ip dhcp snooping limit rate 15', 'exit');
  assert.deepEqual(c.run('int fa0/5', 'switchport access vlan 77'), ['% Access VLAN does not exist. Creating vlan 77']);
  c.run('exit', 'ip dhcp snooping', 'ip dhcp snooping vlan 1,30-31', 'no ip dhcp snooping information option', 'ip default-gateway 192.168.1.1');
  c.run('int fa0/1', 'ip address 1.1.1.1 255.0.0.0');
  assert.match(c.run('ip address 1.1.1.1 255.0.0.0')[0] ?? '', /Invalid input/);
  c.run('end');
  const cfg = sw.runningConfig();
  for (const l of ['vlan 30', ' name SERVIDORES', 'ip dhcp snooping', 'ip dhcp snooping vlan 1,30-31', 'no ip dhcp snooping information option',
    ' switchport access vlan 30', ' switchport mode access', ' ip dhcp snooping limit rate 15', 'ip default-gateway 192.168.1.1']) {
    assert.ok(cfg.includes(l), `missing ${l}`);
  }
  const sw2 = new Switch();
  assert.deepEqual(applyConfig(sw2, cfg), []);
  assert.deepEqual(sw2.runningConfig(), cfg);
  const vb = c.run('show vlan brief').join('\n');
  assert.match(vb, /30\s+SERVIDORES\s+active\s+Fa0\/1, Fa0\/2, Fa0\/3, Fa0\/4/);
  assert.match(vb, /1002 fddi-default\s+act\/unsup/);
});

test('switch SVI gets its address by DHCP and can ping', () => {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const sw = t.add('switch', 0, 0).device as Switch;
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'GigabitEthernet0/1' });
  applyConfig(r, ['ip dhcp pool M', ' network 172.16.0.0 255.255.255.0', ' default-router 172.16.0.1', 'interface GigabitEthernet0/0', ' ip address 172.16.0.1 255.255.255.0']);
  applyConfig(sw, ['interface Vlan1', ' ip address dhcp']);
  t.settle();
  const c = openConsole(sw);
  assert.match(c.run('show ip interface brief').join('\n'), /Vlan1\s+172\.16\.0\.2\s+YES DHCP\s+up\s+up/);
  const ping = c.run('ping 172.16.0.1');
  assert.match(ping.join('\n'), /Success rate is (80|100) percent/);
  assert.match(c.run('show arp').join('\n'), /172\.16\.0\.1/);
  assert.match(c.run('show ip dhcp snooping').join('\n'), /Switch DHCP snooping is disabled/);
});

test('access port drops tagged frames and DTP forms a trunk with a trunk peer', () => {
  const t = new Topology();
  const a = t.add('switch', 0, 0).device as Switch;
  const b = t.add('switch', 0, 0).device as Switch;
  const p1 = t.add('pc', 0, 0).device as Pc;
  const p2 = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: a.id, port: 'GigabitEthernet0/1' }, { device: b.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: p1.id, port: 'FastEthernet0' }, { device: a.id, port: 'FastEthernet0/1' });
  t.connect({ device: p2.id, port: 'FastEthernet0' }, { device: b.id, port: 'FastEthernet0/1' });
  applyConfig(a, ['interface FastEthernet0/1', ' switchport access vlan 5', 'interface GigabitEthernet0/1', ' switchport mode trunk']);
  applyConfig(b, ['interface FastEthernet0/1', ' switchport access vlan 5']);
  assert.equal(b.isTrunk('GigabitEthernet0/1'), true, 'dynamic auto + trunk = trunk');
  p1.setStatic({ ip: 0x0a000001, prefix: 24 });
  p2.setStatic({ ip: 0x0a000002, prefix: 24 });
  assert.match(pcCommand(p1, 'ping 10.0.0.2').join('\n'), /Received = 4/);
  applyConfig(a, ['interface GigabitEthernet0/1', ' switchport mode access']);
  assert.match(pcCommand(p1, 'ping -n 1 10.0.0.2').join('\n'), /Received = 0/);
});

test('vlan list helpers', () => {
  assert.deepEqual(parseVlanList('1,3-5'), [1, 3, 4, 5]);
  assert.equal(parseVlanList('5-3'), null);
  assert.equal(parseVlanList('x'), null);
  assert.equal(compactList([5, 1, 2, 3, 9]), '1-3,5,9');
});

test('PC console errors and help', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  assert.deepEqual(pcCommand(pc, 'foo'), ['Invalid Command.']);
  assert.match(pcCommand(pc, 'ipconfig /renew').join('\n'), /operation failed/);
  assert.match(pcCommand(pc, 'ping').join('\n'), /Invalid Command/);
  assert.match(pcCommand(pc, 'ping host.lan')[0] ?? '', /could not find host/);
  assert.deepEqual(pcCommand(pc, 'arp -a'), ['No ARP Entries Found']);
  assert.ok(pcCommand(pc, 'help').length > 3);
  pc.setStatic({ ip: 0x0a000001, prefix: 24 });
  assert.match(pcCommand(pc, 'ping 8.8.8.8').join('\n'), /Request timed out/);
  assert.match(pcCommand(pc, 'ipconfig').join('\n'), /IPv4 Address\.+: 10\.0\.0\.1/);
  assert.equal(formatIp(pc.config.ip!), '10.0.0.1');
});
