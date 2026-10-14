/** «Interfaces» tab of IOS devices: the form becomes CLI commands, and IOS answers as usual. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressCommands, changedCommands, configureIface, switchportCommands } from '../../src/ui/ios-interfaces.ts';
import { Router } from '../../src/devices/router.ts';
import { Switch } from '../../src/devices/switch.ts';
import { defaultIface } from '../../src/ios/interfaces.ts';

const routed = defaultIface('GigabitEthernet0/0', { shutdown: false, switchport: false });

test('address fields become ip address / no ip address', () => {
  assert.deepEqual(addressCommands(routed, '192.168.1.1', '255.255.255.0'), ['ip address 192.168.1.1 255.255.255.0']);
  assert.deepEqual(addressCommands(routed, '192.168.1.1', '/24'), ['ip address 192.168.1.1 255.255.255.0']);
  assert.deepEqual(addressCommands(routed, '', ''), []);
  assert.deepEqual(addressCommands({ ...routed, address: { ip: 1, prefix: 24 } }, '', ''), ['no ip address']);
  assert.match(String(addressCommands(routed, '192.168.1', '255.255.255.0')), /dirección IP/);
  assert.match(String(addressCommands(routed, '192.168.1.1', 'abc')), /máscara de subred/);
  // A dotted mask with holes is passed as typed, so IOS can answer «Bad mask».
  const r = new Router();
  const cmds = addressCommands(routed, '192.168.1.1', '255.255.0.255');
  assert.ok(Array.isArray(cmds));
  assert.deepEqual(configureIface(r, 'GigabitEthernet0/0', cmds as string[]), { output: ['Bad mask 0xFFFF00FF for address 192.168.1.1'], failed: true });
});

test('switchport fields become mode and access VLAN; the VLAN only counts in access mode', () => {
  const port = defaultIface('FastEthernet0/3', { shutdown: false, switchport: true });
  assert.deepEqual(switchportCommands(port, 'access', '20'), ['switchport mode access', 'switchport access vlan 20']);
  assert.deepEqual(switchportCommands(port, 'trunk', ''), ['switchport mode trunk']);
  assert.match(String(switchportCommands(port, 'access', '5000')), /VLAN/);
  const sw = new Switch();
  const r = configureIface(sw, 'FastEthernet0/3', ['description PC del aula', ...(switchportCommands(port, 'access', '20') as string[]), 'shutdown']);
  assert.equal(r.failed, false, r.output.join('|'));
  assert.match(r.output.join(' '), /Creating vlan 20/);
  const c = sw.iface('FastEthernet0/3');
  assert.equal(c?.accessVlan, 20);
  assert.equal(c?.switchportMode, 'access');
  assert.equal(c?.description, 'PC del aula');
  assert.equal(c?.shutdown, true);
});

test('only what changed is sent', () => {
  const sw = new Switch();
  configureIface(sw, 'FastEthernet0/4', ['description Aula', 'switchport mode access', 'switchport access vlan 30']);
  const c = sw.iface('FastEthernet0/4');
  assert.ok(c);
  assert.deepEqual(changedCommands(c, { description: 'Aula', ip: '', mask: '', mode: 'access', vlan: '30' }), []);
  assert.deepEqual(changedCommands(c, { description: '', ip: '', mask: '', mode: 'access', vlan: '40' }), ['no description', 'switchport access vlan 40']);
  const r = new Router();
  configureIface(r, 'GigabitEthernet0/0', ['ip address 10.0.0.1 255.255.255.0']);
  const g = r.iface('GigabitEthernet0/0');
  assert.ok(g);
  assert.deepEqual(changedCommands(g, { description: '', ip: '10.0.0.1', mask: '/24', mode: '', vlan: '' }), []);
  assert.deepEqual(changedCommands(g, { description: '', ip: '', mask: '', mode: '', vlan: '' }), ['no ip address']);
});

test('the panel does not pollute show history and logs CONFIG_I like the console', () => {
  const r = new Router();
  const logs: string[] = [];
  r.onConsole((l) => logs.push(l));
  const before = [...r.history];
  configureIface(r, 'GigabitEthernet0/0', ['description X']);
  assert.deepEqual(r.history, before);
  assert.ok(logs.some((l) => l.includes('%SYS-5-CONFIG_I')));
});

test('editing an interface that is shut down keeps it down (unlike reading a saved config)', () => {
  const r = new Router();
  configureIface(r, 'GigabitEthernet0/1', ['shutdown']);
  configureIface(r, 'GigabitEthernet0/1', ['description WAN', 'ip address 10.0.0.1 255.255.255.252']);
  assert.equal(r.iface('GigabitEthernet0/1')?.shutdown, true);
  assert.equal(r.iface('GigabitEthernet0/1')?.description, 'WAN');
  assert.match(configureIface(r, 'GigabitEthernet0/1', ['ip address 10.0.0.1 255.255.255.300']).output.join(' '), /Invalid input/);
});
