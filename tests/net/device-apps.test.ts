/** Per-device switches (Configuración tab of each PC, Server and Linux router), within what the lab allows. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePcSystem, defaultApps, deviceApps, setDeviceApps, customApps, appAvailable, parseApps, labViewOf, APPS_BY_KIND } from '../../src/net/device-apps.ts';
import { setFeature } from '../../src/net/lab-features.ts';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';

test('defaults: a PC has IP, browser and SSH but no mail or SFTP, and only the terminal of its system', () => {
  assert.deepEqual(defaultApps({ kind: 'pc', os: 'windows' }), ['ip', 'browser', 'ssh', 'windows']);
  assert.deepEqual(defaultApps({ kind: 'pc', os: 'linux' }), ['ip', 'browser', 'ssh', 'linux']);
  assert.deepEqual(defaultApps({ kind: 'server', os: 'linux' }), ['ip', 'ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log', 'sysctl', 'firewall', 'linux']);
  assert.deepEqual(defaultApps({ kind: 'linuxrouter', os: 'linux' }), ['sysctl', 'firewall', 'vpn', 'ssh', 'dhcp', 'dns', 'http', 'mail', 'files', 'log', 'linux']);
  assert.deepEqual(APPS_BY_KIND.pc, ['ip', 'browser', 'mail', 'ssh', 'sftp', 'linux', 'windows']);
});

test('a device choice is kept until it equals the defaults again; the defaults follow the system', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  setDeviceApps(pc, ['ip', 'browser', 'mail', 'ssh', 'windows']);
  assert.deepEqual(deviceApps(pc), ['ip', 'browser', 'mail', 'ssh', 'windows']);
  setDeviceApps(pc, ['windows', 'ssh', 'browser', 'ip', 'nope' as never]);
  assert.equal(customApps(pc), undefined, 'same as the defaults (in any order, unknown ids dropped): not kept');
  pc.os = 'linux';
  assert.deepEqual(deviceApps(pc), ['ip', 'browser', 'ssh', 'linux']);
});

test('available = allowed by the lab and switched on in the device', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  assert.equal(appAvailable(pc, 'browser'), true);
  assert.equal(appAvailable(pc, 'mail'), false, 'off in the device');
  assert.equal(appAvailable(srv, 'firewall'), false, 'on in the device, off in the lab');
  t.features = setFeature(t.features, 'server', 'firewall', true);
  assert.equal(appAvailable(srv, 'firewall'), true, 'the device follows the lab it is in');
  t.features = setFeature(t.features, 'pc', 'apps', false);
  assert.equal(appAvailable(pc, 'browser'), false, 'the lab «apps» switch covers the four PC applications');
  assert.equal(labViewOf(srv).webHideOff, false);
  t.webHideOff = true;
  assert.equal(labViewOf(srv).webHideOff, true);
});

test('untrusted lists: wrong types, unknown or foreign ids and absurd lengths', () => {
  assert.equal(parseApps('ssh', 'pc'), undefined);
  assert.equal(parseApps(Array.from({ length: 500 }, () => 'ssh'), 'pc'), undefined);
  assert.deepEqual(parseApps(['ssh', 'ssh', 'dhcp', 7, 'windows'], 'pc'), ['ssh', 'windows'], 'a PC has no DHCP panel');
  assert.deepEqual(parseApps([], 'server'), []);
});

test('the device choices and the web option travel with the file', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  setDeviceApps(pc, ['ip', 'browser', 'sftp', 'linux', 'windows']);
  const json = t.toJSON();
  assert.equal(json.devices.find((d) => d.kind === 'server')?.pc?.enabled, undefined, 'defaults are not saved');
  assert.equal(json.webHideOff, undefined);
  t.webHideOff = true;
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const pc2 = [...again.placed.values()].find((p) => p.device.kind === 'pc')!.device as Pc;
  assert.deepEqual(deviceApps(pc2), ['ip', 'browser', 'sftp', 'linux', 'windows']);
  assert.equal(again.webHideOff, true);
  assert.equal(labViewOf(pc2).webHideOff, true);
  assert.deepEqual(deviceApps([...again.placed.values()].find((p) => p.label === 'Server0')!.device as Server), deviceApps(srv));
});

test('the system chosen when a PC is placed: its stack and its terminals', () => {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  choosePcSystem(pc, 'linux');
  assert.deepEqual([pc.os, deviceApps(pc)], ['linux', ['ip', 'browser', 'ssh', 'linux']]);
  choosePcSystem(pc, 'both');
  assert.deepEqual([pc.os, deviceApps(pc)], ['windows', ['ip', 'browser', 'ssh', 'linux', 'windows']]);
  choosePcSystem(pc, 'windows');
  assert.deepEqual([pc.os, customApps(pc)], ['windows', undefined]);
});
