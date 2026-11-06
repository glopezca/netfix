/**
 * setAptInstalled: what `apt install -y X` / `apt remove -y X` leave on a host, without the terminal or the network (the
 * device's package boxes): the package manual, its dependencies automatic, the maintainer scripts run; on removal the
 * dependencies stay for autoremove. PC1 of «basico» has no way out, so apt itself could not fetch anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { setAptInstalled } from '../../src/shells/apt-install.ts';
import { deviceApps } from '../../src/net/device-apps.ts';
import { isPackageAuto } from '../../src/net/host-packages.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));
const pc = (): Host => EXAMPLES.find((e) => e.id === 'basico')!.build().byLabel('PC1') as Host;

test('installed without the network: manual, its dependencies automatic, smb.conf shipped, smbclient runs', () => {
  const h = pc();
  assert.equal(setAptInstalled(h, 'smbclient', true), true);
  const list = run(h, 'apt list --installed 2>/dev/null');
  assert.match(list, /^smbclient\/resolute,now \S+ amd64 \[installed\]$/m);
  assert.ok(isPackageAuto(h, 'samba-common') && isPackageAuto(h, 'libsmbclient0'), 'its dependencies are automatic');
  assert.match(run(h, 'grep -c "workgroup = WORKGROUP" /etc/samba/smb.conf'), /^1$/);
  assert.match(run(h, 'smbclient -L //nadie -N; echo "status $?"'), /NT_STATUS_UNSUCCESSFUL\)\nstatus 1$/);
  assert.equal(setAptInstalled(h, 'smbclient', true), false, 'already installed: nothing changes');
});

test('removed: the dependencies stay until autoremove, as with apt remove', () => {
  const h = pc();
  setAptInstalled(h, 'smbclient', true);
  assert.equal(setAptInstalled(h, 'smbclient', false), true);
  assert.doesNotMatch(run(h, 'apt list --installed 2>/dev/null'), /^smbclient\//m);
  assert.match(run(h, 'smbclient -L //x -N'), /Command 'smbclient' not found/);
  assert.match(run(h, 'apt autoremove -y'), /Removing samba-common /);
  assert.equal(setAptInstalled(h, 'smbclient', false), false, 'not installed: nothing changes');
});

test('the maintainer scripts run: avahi-daemon puts mdns4_minimal into nsswitch.conf and takes it out', () => {
  const h = pc();
  setAptInstalled(h, 'avahi-daemon', true);
  assert.match(run(h, 'grep ^hosts: /etc/nsswitch.conf'), /mdns4_minimal \[NOTFOUND=return\]/);
  setAptInstalled(h, 'avahi-daemon', false);
  run(h, 'apt autoremove -y');
  assert.doesNotMatch(run(h, 'grep ^hosts: /etc/nsswitch.conf'), /mdns4_minimal/);
});

test('a package the catalogue does not have, or a base one, changes nothing', () => {
  const h = pc();
  assert.equal(setAptInstalled(h, 'no-such-package', true), false);
  assert.equal(setAptInstalled(h, 'bash', false), false);
});

test('on a Server, a service package switches its panel, as apt does', () => {
  const srv = EXAMPLES.find((e) => e.id === 'internet')!.build().byLabel('SRV-SEDE2') as Host;
  setAptInstalled(srv, 'nftables', false);
  assert.ok(!deviceApps(srv).includes('firewall'));
  assert.equal(setAptInstalled(srv, 'nftables', true), true);
  assert.ok(deviceApps(srv).includes('firewall'));
});
