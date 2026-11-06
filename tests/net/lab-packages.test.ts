/**
 * The package catalogue of the devices (Configuración → Paquetes: service packages and tools) and its availability in the lab (Configuración →
 * Laboratorio actual): which packages it lists, the lab's list of packages taken away (untrusted JSON, file round trip)
 * and what apt says of a package the lab took away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PACKAGES, SERVICE_PACKAGES, TOOL_PACKAGES, packageAllowed, parsePkgsOff, setPackageOff } from '../../src/net/lab-packages.ts';
import { findPackage } from '../../src/shells/apt-catalog.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { hasPackage } from '../../src/net/host-packages.ts';
import { setAptInstalled } from '../../src/shells/apt-install.ts';
import { installedPackage } from '../../src/shells/apt-state.ts';
import { appAvailable, deviceApps, setDeviceApps } from '../../src/net/device-apps.ts';
import { pageOff } from '../../src/web/admin-layout.ts';
import { devicePackages, serviceOffered, setServiceBox } from '../../src/shells/apt-offer.ts';
import type { Server } from '../../src/devices/server.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));

test('the catalogue: first the service packages (each one turns on a panel), then the tools', () => {
  assert.deepEqual([...SERVICE_PACKAGES], ['openssh-server', 'kea-dhcp4-server', 'bind9', 'apache2', 'postfix', 'dovecot-imapd', 'dovecot-pop3d', 'nftables', 'wireguard-tools', 'rsyslog', 'samba', 'avahi-daemon', 'winbind']);
  assert.deepEqual([...TOOL_PACKAGES], ['network-manager', 'libnss-mdns', 'libnss-resolve', 'smbclient', 'samba-common-bin', 'libnss-winbind', 'bind9-utils']);
  assert.deepEqual([...CATALOG_PACKAGES], [...SERVICE_PACKAGES, ...TOOL_PACKAGES]);
  for (const name of SERVICE_PACKAGES) assert.ok(findPackage(name)?.feature ?? ['samba', 'avahi-daemon', 'winbind'].includes(name), `${name}: a service`);
  for (const name of TOOL_PACKAGES) assert.equal(findPackage(name)?.feature, undefined, `${name} has no service panel`);
});

test('a short name goes with its package: without openssh-server in the archive there is no ssh either', () => {
  assert.equal(packageAllowed(['openssh-server'], 'ssh'), false);
  assert.equal(packageAllowed(['kea-dhcp4-server'], 'kea'), false);
  assert.equal(packageAllowed(['wireguard-tools'], 'wireguard'), false);
  assert.equal(packageAllowed([], 'ssh'), true);
});

test('the list of packages taken away: catalogue order, no repeats, empty when all are there', () => {
  let off = setPackageOff([], 'winbind', true);
  off = setPackageOff(off, 'network-manager', true);
  off = setPackageOff(off, 'winbind', true);
  assert.deepEqual(off, ['winbind', 'network-manager'], 'services first');
  assert.deepEqual(setPackageOff(off, 'network-manager', false), ['winbind']);
  assert.deepEqual(setPackageOff([], 'samba', true), ['samba'], 'samba too (besides its lab feature)');
  assert.deepEqual(setPackageOff([], 'ssh', true), [], 'a short name is not in the list');
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

test('a service package of the catalogue: its box and the service box are one, in Servicios, the web GUI and apt', () => {
  const topo = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const srv = topo.byLabel('SRV') as Server;
  setDeviceApps(srv, deviceApps(srv).filter((id) => id !== 'dns'));
  assert.equal(installedPackage(srv, findPackage('bind9')!), false);
  assert.equal(setAptInstalled(srv, 'bind9', true), true, 'the package box installs it as apt');
  assert.ok(appAvailable(srv, 'dns'), 'the DNS box is ticked and its panel is there');
  assert.equal(pageOff(srv, 'dns'), false);
  assert.match(run(srv, 'apt list --installed 2>/dev/null'), /^bind9\/resolute,now /m, 'apt sees it installed');
  run(srv, 'apt remove -y bind9');
  assert.equal(appAvailable(srv, 'dns'), false, 'apt remove unticks both');
  assert.equal(installedPackage(srv, findPackage('bind9')!), false);
});

test('the lab takes a service package away: apt cannot find it and an uninstalled service box goes; one installed stays', () => {
  const topo = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const srv = topo.byLabel('SRV') as Server;
  setDeviceApps(srv, deviceApps(srv).filter((id) => id !== 'dns'));
  topo.pkgsOff = ['bind9', 'openssh-server'];
  assert.match(run(srv, 'apt install -y bind9; echo "status $?"'), /Error: Unable to locate package bind9\nstatus 100$/);
  assert.match(run(srv, 'apt install -y ssh; echo "status $?"'), /status 100$/, 'nor the short name');
  assert.equal(serviceOffered(srv, 'dns'), false, 'not installed and not in the archive: no DNS box');
  assert.equal(serviceOffered(srv, 'ssh'), appAvailable(srv, 'ssh'), 'installed: its box stays, to remove it');
  assert.equal(serviceOffered(srv, 'files'), true, 'a box without a package is not touched');
});

test('each device lists the service packages that do something on it', () => {
  const topo = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const services = (label: string): string[] => devicePackages(topo.byLabel(label) as Host).filter((n) => (SERVICE_PACKAGES as readonly string[]).includes(n));
  assert.deepEqual(services('PC1'), ['nftables', 'samba', 'avahi-daemon', 'winbind'], 'a GNU/Linux PC: its firewall, Samba, mDNS and winbind');
  assert.deepEqual(services('SRV'), ['openssh-server', 'kea-dhcp4-server', 'bind9', 'apache2', 'postfix', 'dovecot-imapd', 'dovecot-pop3d', 'nftables', 'rsyslog', 'samba', 'avahi-daemon', 'winbind'], 'a server: no VPN');
  assert.deepEqual(devicePackages(topo.byLabel('PC1') as Host).slice(4), [...TOOL_PACKAGES], 'then every tool');
  assert.deepEqual(devicePackages(topo.byLabel('PC0') as Host), [], 'a Windows PC has no apt');
});

test('review: the service box is apt too (the mail box installs its three packages); a PC\'s SSH box stays a client', () => {
  const topo = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const srv = topo.byLabel('SRV') as Server;
  setServiceBox(srv, 'mail', true);
  for (const name of ['postfix', 'dovecot-imapd', 'dovecot-pop3d']) assert.equal(installedPackage(srv, findPackage(name)!), true, name);
  assert.match(run(srv, 'apt list --installed 2>/dev/null'), /^postfix\/resolute,now /m);
  setServiceBox(srv, 'mail', false);
  assert.equal(appAvailable(srv, 'mail'), false);
  assert.equal(installedPackage(srv, findPackage('postfix')!), false);
  const pc = topo.byLabel('PC1') as Host;
  setServiceBox(pc, 'ssh', true);
  assert.equal(hasPackage(pc, 'openssh-server'), false, 'the SSH client of a PC installs no server');
});

test('review: a Windows server without a GNU/Linux terminal keeps its service boxes whatever the lab takes from apt', () => {
  const topo = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const srv = topo.byLabel('SRV') as Server;
  setDeviceApps(srv, deviceApps(srv).filter((id) => id !== 'dns' && id !== 'linux'));
  srv.os = 'windows';
  topo.pkgsOff = ['bind9'];
  assert.equal(serviceOffered(srv, 'dns'), true);
  assert.equal(packageAllowed(['kea-dhcp4-server'], 'isc-kea'), false, 'isc-kea goes with kea-dhcp4-server');
});
