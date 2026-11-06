/**
 * The package catalogue of the devices (Configuración → Paquetes) and its availability in the lab (Configuración →
 * Laboratorio actual): which packages it lists, the lab's list of packages taken away (untrusted JSON, file round trip)
 * and what apt says of a package the lab took away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PACKAGES, packageAllowed, parsePkgsOff, setPackageOff } from '../../src/net/lab-packages.ts';
import { findPackage } from '../../src/shells/apt-catalog.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { hasPackage } from '../../src/net/host-packages.ts';
import { setAptInstalled } from '../../src/shells/apt-install.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));

test('the catalogue: the tool packages of apt, without service panels and without samba', () => {
  assert.deepEqual([...CATALOG_PACKAGES], ['network-manager', 'avahi-daemon', 'libnss-mdns', 'libnss-resolve', 'smbclient', 'samba-common-bin', 'winbind', 'libnss-winbind', 'bind9-utils']);
  for (const name of CATALOG_PACKAGES) {
    const p = findPackage(name);
    assert.ok(p, `${name} is in apt's catalogue`);
    assert.equal(p.feature, undefined, `${name} has no service panel`);
  }
});

test('the list of packages taken away: catalogue order, no repeats, empty when all are there', () => {
  let off = setPackageOff([], 'winbind', true);
  off = setPackageOff(off, 'network-manager', true);
  off = setPackageOff(off, 'winbind', true);
  assert.deepEqual(off, ['network-manager', 'winbind']);
  assert.deepEqual(setPackageOff(off, 'network-manager', false), ['winbind']);
  assert.deepEqual(setPackageOff([], 'samba', true), [], 'samba has its own lab feature');
  assert.equal(packageAllowed(off, 'winbind'), false);
  assert.equal(packageAllowed(off, 'smbclient'), true);
});

test('a file\'s list (untrusted): only catalogue names, at most a short list', () => {
  assert.deepEqual(parsePkgsOff(['smbclient', 'nada', 42, 'smbclient', '<img>', 'bind9-utils']), ['smbclient', 'bind9-utils']);
  assert.deepEqual(parsePkgsOff('smbclient'), []);
  assert.deepEqual(parsePkgsOff(undefined), [], 'a file saved before the catalogue: everything available');
  assert.deepEqual(parsePkgsOff(Array.from({ length: 65 }, () => 'smbclient')), [], 'too long to be a list of packages');
});

test('saved with the topology only when something is taken away', () => {
  const topo = EXAMPLES.find((e) => e.id === 'basico')!.build();
  assert.equal('pkgsOff' in topo.toJSON(), false);
  topo.pkgsOff = ['smbclient'];
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(topo.toJSON())));
  assert.deepEqual(back.pkgsOff, ['smbclient']);
});

test('apt does not find a package the lab took away; what is installed stays and can be removed', () => {
  const topo = EXAMPLES.find((e) => e.id === 'basico')!.build();
  const pc = topo.byLabel('PC1') as Host;
  assert.equal(setAptInstalled(pc, 'winbind', true), true);
  topo.pkgsOff = ['smbclient', 'winbind'];
  assert.match(run(pc, 'apt install -y smbclient; echo "status $?"'), /Error: Unable to locate package smbclient\nstatus 100$/);
  assert.equal(setAptInstalled(pc, 'smbclient', true), false, 'nor does its box');
  assert.equal(hasPackage(pc, 'smbclient'), false);
  const list = run(pc, 'apt list 2>/dev/null');
  assert.doesNotMatch(list, /^smbclient\//m, 'no longer in the archive');
  assert.match(list, /^winbind\/resolute,now /m, 'installed: still listed');
  assert.match(run(pc, 'apt remove -y winbind; echo "status $?"'), /Removing winbind .*\n[\s\S]*status 0$/);
  assert.equal(hasPackage(pc, 'winbind'), false);
});
