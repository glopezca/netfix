/** Recorded labs set up each device: PC pairs on one switch get one system each, and only what the lab uses is on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { deviceApps } from '../../src/net/device-apps.ts';
import type { Topology } from '../../src/net/topology.ts';
import type { Host } from '../../src/devices/host.ts';

const lab = (id: string): Topology => EXAMPLES.find((e) => e.id === id)!.build();
const host = (t: Topology, label: string): Host => t.byLabel(label) as Host;
const terminals = (h: Host): string[] => deviceApps(h).filter((a) => a === 'linux' || a === 'windows');

test('two PCs on the same switch: one has the Windows terminal and the other the Linux one', () => {
  for (const id of ['basico', 'reservas', 'relay', 'vlans', 'snooping', 'servidores', 'internet', 'ssh-sftp']) {
    const t = lab(id);
    assert.deepEqual([terminals(host(t, 'PC0')), terminals(host(t, 'PC1'))], [['windows'], ['linux']], id);
    assert.deepEqual([host(t, 'PC0').os, host(t, 'PC1').os], ['windows', 'linux'], `${id}: the system follows`);
  }
  assert.deepEqual(terminals(host(lab('vlans'), 'PC3')), ['linux']);
  assert.deepEqual(terminals(host(lab('bastionado'), 'ADMIN')), ['linux'], 'alone on its switch: its own system');
});

test('mail only where an account is set up, SFTP only where the lab uses it; browser and SSH always', () => {
  const srv = lab('servidores');
  assert.ok(deviceApps(host(srv, 'PC0')).includes('mail'));
  const basico = deviceApps(host(lab('basico'), 'PC0'));
  assert.ok(!basico.includes('mail') && !basico.includes('sftp') && basico.includes('browser') && basico.includes('ssh'));
  const sftp = lab('ssh-sftp');
  assert.ok(deviceApps(host(sftp, 'PC1')).includes('sftp'));
  assert.ok(!deviceApps(host(sftp, 'PC0')).includes('sftp'));
});

test('each server shows only the services it runs, plus files and logs', () => {
  const svc = (t: Topology, label: string): string[] => deviceApps(host(t, label)).filter((a) => !['ip', 'sysctl', 'firewall', 'vpn', 'linux', 'windows'].includes(a));
  assert.deepEqual(svc(lab('dns-reenvio'), 'NS1'), ['dhcp', 'dns', 'http', 'files', 'log']);
  assert.deepEqual(svc(lab('internet'), 'SRV-SEDE2'), ['ssh', 'dns', 'http', 'files', 'log'], 'SSH too: the ISP forwards port 22 to it');
  const vpn = lab('vpn-wireguard');
  assert.ok(deviceApps(host(vpn, 'CENTRAL')).includes('ssh'));
  assert.ok(!deviceApps(host(vpn, 'SUCURSAL')).includes('ssh'));
  assert.deepEqual(terminals(host(vpn, 'CENTRAL')), ['linux']);
});
