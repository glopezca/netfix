/**
 * IOS routers and switches follow the rule of the Linux devices: the hostname always comes from the device name in
 * the workspace (Equipo → Nombre); the CLI, a saved configuration or a reload cannot set another one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { renameDevice } from '../../src/net/device-names.ts';
import { iosHostnameFromLabel } from '../../src/core/hostname.ts';
import { Router } from '../../src/devices/router.ts';
import type { Switch } from '../../src/devices/switch.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { openConsole } from '../helpers.ts';

const LOCKED = '% In Netfix the hostname comes from the device name (Device tab)';

test('an IOS hostname is the device name made valid for IOS: letters, digits and hyphens, starting with a letter', () => {
  assert.equal(iosHostnameFromLabel('Router0', 'router'), 'Router0');
  assert.equal(iosHostnameFromLabel('Sede Central (Ñandú)', 'router'), 'Sede-Central-Nandu');
  assert.equal(iosHostnameFromLabel('1º planta', 'switch'), 'Switch-1o-planta');
  assert.equal(iosHostnameFromLabel('***', 'router'), 'Router');
  assert.equal(iosHostnameFromLabel('x'.repeat(80), 'router').length, 63);
});

test('a placed router takes its hostname from its name, also after a rename; equal names get -2', () => {
  const t = new Topology();
  const a = t.add('router', 100, 100);
  const s = t.add('switch', 200, 100);
  assert.equal((a.device as Router).hostname, 'Router0');
  assert.equal((s.device as Switch).hostname, 'Switch0');
  renameDevice(a, 'GW Aula');
  assert.equal((a.device as Router).hostname, 'GW-Aula');
  const b = t.add('router', 300, 100, { label: 'gw aula' });
  assert.equal((b.device as Router).hostname, 'gw-aula-2', 'IOS names compared without case, as a network would');
});

test('the CLI keeps the hostname: the same name is accepted, another one or «no hostname» is refused', () => {
  const t = new Topology();
  const r = t.add('router', 100, 100, { label: 'GW' }).device as Router;
  const c = openConsole(r, 'config');
  assert.deepEqual(c.run('hostname GW'), []);
  assert.deepEqual(c.run('hostname R1'), [LOCKED]);
  assert.deepEqual(c.run('no hostname'), [LOCKED]);
  assert.equal(c.session.prompt(), 'GW(config)#');
  assert.deepEqual(applyConfig(r, ['hostname OTRO']), [], 'a saved or pasted configuration keeps the derived name, silently');
  assert.equal(r.hostname, 'GW');
  r.resetConfig();
  assert.equal(r.hostname, 'GW', 'write erase + reload keeps it');
  assert.ok(r.runningConfig().includes('hostname GW'));
});

test('a file saved before (hostname set apart from the name) opens with that hostname as the name: the work keeps its prompt', () => {
  const t = new Topology();
  t.add('router', 100, 100, { label: 'SEDE' });
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  json.devices[0].config = json.devices[0].config.map((l: string) => (l.startsWith('hostname') ? 'hostname ANTIGUO' : l));
  const back = Topology.fromJSON(json);
  const r = back.byLabel('ANTIGUO') as Router;
  assert.equal(r.hostname, 'ANTIGUO');
  assert.equal(back.byLabel('SEDE'), undefined);
  // A file of this version always agrees, so nothing changes; an IOS default (Router) is not a name chosen by anyone.
  assert.ok(Topology.fromJSON(t.toJSON()).byLabel('SEDE'));
  const plain = JSON.parse(JSON.stringify(t.toJSON()));
  plain.devices[0].config = plain.devices[0].config.map((l: string) => (l.startsWith('hostname') ? 'hostname Router' : l));
  assert.ok(Topology.fromJSON(plain).byLabel('SEDE'));
});

test('a router not on a workspace (CLI tests, the grader) still sets its own hostname', () => {
  const c = openConsole(new Router(), 'config');
  c.run('hostname R1');
  assert.equal(c.session.prompt(), 'R1(config)#');
});

test('in every lab the name of each IOS device is its hostname', () => {
  for (const ex of EXAMPLES) {
    for (const p of ex.build().placed.values()) {
      if (p.device.kind !== 'router' && p.device.kind !== 'switch') continue;
      assert.equal(p.device.hostname, iosHostnameFromLabel(p.label, p.device.kind), `${ex.id}: ${p.label}`);
    }
  }
});

test('the labs keep the hostnames their exercises talk about, now as device names', () => {
  const names = (id: string): string[] => [...(EXAMPLES.find((e) => e.id === id)?.build().placed.values() ?? [])]
    .filter((p) => p.device.kind === 'router').map((p) => p.label).sort();
  assert.deepEqual(names('basico'), ['GW']);
  assert.deepEqual(names('relay'), ['DHCP-SRV', 'EDGE']);
  assert.deepEqual(names('snooping'), ['GW', 'ROGUE']);
  assert.deepEqual(names('cliente'), ['CPE', 'ISP']);
});

test('migrating old files never duplicates names, and an undo cannot leave two routers with one hostname', () => {
  const t = new Topology();
  t.add('router', 0, 0);
  t.add('router', 0, 0);
  t.add('pc', 0, 0, { label: 'PC0' });
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  json.devices[0].config = json.devices[0].config.map((l: string) => (l.startsWith('hostname') ? 'hostname R1' : l));
  json.devices[1].config = json.devices[1].config.map((l: string) => (l.startsWith('hostname') ? 'hostname R1' : l));
  json.devices.push({ ...json.devices[0], id: 'd99', seed: 99, label: 'Router9', config: json.devices[0].config.map((l: string) => (l.startsWith('hostname') ? 'hostname PC0' : l)) });
  const back = Topology.fromJSON(json);
  const labels = [...back.placed.values()].map((p) => p.label).sort();
  assert.deepEqual(labels, ['PC0', 'R1', 'Router1', 'Router9']);
  const u = new Topology();
  const a = u.add('router', 0, 0, { label: 'R 1' });
  u.remove(a.device.id);
  const b = u.add('router', 0, 0, { label: 'R-1' });
  u.restorePlaced(a.device.id, a);
  assert.notEqual((a.device as Router).hostname, (b.device as Router).hostname);
});
