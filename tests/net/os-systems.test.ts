/**
 * The systems of a device are its terminals: adding the Windows terminal to a GNU/Linux device gives it Windows (file
 * and printer sharing, NetBIOS and mDNS of its own), and taking it away takes them away. Every kind with Windows
 * (PC, Server, and a GNU/Linux router forced to have it) may share files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import type { Host } from '../../src/devices/host.ts';
import { deviceApps, hasSystem, setDeviceApps } from '../../src/net/device-apps.ts';
import { FEATURES_BY_KIND, featureOn, fileFeatures, FEATURES_V } from '../../src/net/lab-features.ts';
import { setWinShareOn, winShareActive, winShareOffered } from '../../src/net/win-shares.ts';
import { linuxSide, hostPanels, panelGroups } from '../../src/net/pkg-units.ts';
import { ownNames, FILE_SERVER } from '../../src/net/netbios.ts';
import { createShell } from '../../src/shells/factory.ts';

const lab = (): Topology => EXAMPLES.find((e) => e.id === 'basico')!.build();
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');
const terminals = (h: Host, ...on: ('linux' | 'windows')[]): void =>
  setDeviceApps(h, [...deviceApps(h).filter((id) => id !== 'linux' && id !== 'windows'), ...on]);

test('a device keeps at least one system: taking away its last terminal keeps the one of its IP tab', () => {
  const topo = lab();
  const [pc1, pc2] = [topo.byLabel('PC1') as Host, topo.byLabel('PC2') as Host];
  terminals(pc1);
  assert.ok(deviceApps(pc1).includes('linux'), 'a GNU/Linux PC keeps its GNU/Linux terminal');
  terminals(pc2);
  assert.ok(deviceApps(pc2).includes('windows'), 'a Windows PC keeps its Windows terminal');
  terminals(pc1, 'linux', 'windows');
  terminals(pc1, 'windows');
  assert.deepEqual([hasSystem(pc1, 'linux'), hasSystem(pc1, 'windows')], [false, true], 'one of two may go');
  const srv = new Topology().add('server', 0, 0).device as Host;
  setDeviceApps(srv, deviceApps(srv).filter((id) => id !== 'linux'));
  assert.ok(deviceApps(srv).includes('linux'), 'a Server too');
});

test('a file whose device has no terminal is read with the system of its IP tab', () => {
  const topo = lab();
  const file = JSON.parse(JSON.stringify(topo.toJSON())) as { devices: { label: string; pc?: { enabled?: string[] } }[] };
  const rec = file.devices.find((d) => d.label === 'PC1')!;
  rec.pc!.enabled = ['ip', 'browser'];
  const pc1 = Topology.fromJSON(file).byLabel('PC1') as Host;
  assert.ok(deviceApps(pc1).includes('linux'));
});

test('the terminals say which systems a device has', () => {
  const pc1 = lab().byLabel('PC1') as Host;
  assert.equal(pc1.os, 'linux');
  assert.deepEqual([hasSystem(pc1, 'linux'), hasSystem(pc1, 'windows')], [true, false]);
  terminals(pc1, 'linux', 'windows');
  assert.deepEqual([hasSystem(pc1, 'linux'), hasSystem(pc1, 'windows')], [true, true]);
  terminals(pc1, 'windows');
  assert.deepEqual([hasSystem(pc1, 'linux'), hasSystem(pc1, 'windows')], [false, true], 'GNU/Linux taken away');
  assert.equal(linuxSide(pc1), false);
  terminals(pc1);
  assert.deepEqual([hasSystem(pc1, 'linux'), hasSystem(pc1, 'windows')], [true, false], 'no terminal: its system');
});

test('Windows added to a GNU/Linux PC: file and printer sharing is offered and works as a service', () => {
  const topo = lab();
  const [pc0, pc1] = [topo.byLabel('PC0') as Host, topo.byLabel('PC1') as Host];
  assert.equal(winShareOffered(pc1), false);
  terminals(pc1, 'linux', 'windows');
  assert.equal(winShareOffered(pc1), true);
  setWinShareOn(pc1, true);
  assert.equal(winShareActive(pc1), true);
  assert.ok(hostPanels(pc1).includes('winshare'), 'its SMB panel in Servicios');
  assert.ok(ownNames(pc1).some((n) => n.suffix === FILE_SERVER), 'NAME<20> registered');
  assert.match(win(pc0, 'net view \\\\pc1'), /There are no entries in the list\./, 'Windows answers SMB');
});

test('Windows taken away from a Windows PC: the sharing goes, and so does the service', () => {
  const topo = lab();
  const [pc0, pc2] = [topo.byLabel('PC0') as Host, topo.byLabel('PC2') as Host];
  setWinShareOn(pc2, true);
  assert.equal(winShareActive(pc2), true);
  terminals(pc2, 'linux');
  assert.equal(winShareOffered(pc2), false);
  assert.equal(winShareActive(pc2), false);
  assert.ok(!hostPanels(pc2).includes('winshare'));
  assert.match(win(pc0, 'net view \\\\pc2'), /System error 53 has occurred/, 'no Windows to answer');
});

test('every kind with Windows may share: a Server, and a GNU/Linux router forced to have it', () => {
  const topo = new Topology();
  for (const kind of ['server', 'linuxrouter'] as const) {
    assert.ok(FEATURES_BY_KIND[kind].includes('winshare'), kind);
    const d = topo.add(kind, 0, 0).device as Host;
    assert.equal(winShareOffered(d), false, `${kind}: GNU/Linux only`);
    terminals(d, 'linux', 'windows');
    assert.equal(winShareOffered(d), true, `${kind}: with Windows`);
  }
});

test('a router list saved before the router could share keeps the sharing on', () => {
  const v3 = fileFeatures({ linuxrouter: ['sysctl', 'firewall', 'vpn', 'ssh', 'samba', 'linux', 'windows'] }, 3, undefined);
  assert.equal(featureOn(v3, 'linuxrouter', 'winshare'), true);
  assert.equal(FEATURES_V, 4);
});

test('Servicios of a device with both systems: the panels in a GNU/Linux group and a Windows group', () => {
  const topo = lab();
  const pc1 = topo.byLabel('PC1') as Host;
  assert.equal(panelGroups(pc1, ['sysctl', 'files']), null, 'one system: no groups');
  terminals(pc1, 'linux', 'windows');
  setWinShareOn(pc1, true);
  assert.deepEqual(panelGroups(pc1, ['winshare', 'sysctl', 'files']), [['linux', ['sysctl', 'files']], ['windows', ['winshare']]]);
  assert.deepEqual(panelGroups(pc1, ['sysctl']), [['linux', ['sysctl']]], 'a group with nothing is left out');
});

test('review: a PC with both systems runs systemd-resolved; its own services follow the system of its TCP/IP tab', async () => {
  const { resolvedRunning } = await import('../../src/shells/resolved.ts');
  const { serviceSystem } = await import('../../src/net/device-apps.ts');
  const pc0 = lab().byLabel('PC0') as Host;
  assert.equal(resolvedRunning(pc0), false, 'Windows only');
  terminals(pc0, 'linux', 'windows');
  assert.equal(resolvedRunning(pc0), true, 'its GNU/Linux runs resolved');
  assert.equal(serviceSystem(pc0), 'windows');
  terminals(pc0, 'linux');
  assert.equal(serviceSystem(pc0), 'linux');
});
