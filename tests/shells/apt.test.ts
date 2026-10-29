/**
 * apt on an Ubuntu 26.04 host: real sources, real network (the emulated Internet and a DNS server that resolves the
 * repositories), a fictitious catalogue that is always up to date, and install/remove that switch the service panels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import { deviceApps, freshApps, setDeviceApps } from '../../src/net/device-apps.ts';
import type { Host } from '../../src/devices/host.ts';
import type { Server } from '../../src/devices/server.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const run = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));

test('the sources are those of Ubuntu 26.04 (deb822, resolute)', () => {
  const srv = lab('internet').byLabel('SRV-SEDE2') as Host;
  const sources = run(srv, 'cat /etc/apt/sources.list.d/ubuntu.sources');
  assert.match(sources, /^Types: deb\nURIs: http:\/\/archive\.ubuntu\.com\/ubuntu\/\nSuites: resolute resolute-updates resolute-backports\nComponents: main universe restricted multiverse\nSigned-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg$/m);
  assert.match(sources, /URIs: http:\/\/security\.ubuntu\.com\/ubuntu\/\nSuites: resolute-security/);
  assert.match(run(srv, 'cat /etc/apt/sources.list'), /^# Ubuntu sources have moved to the \/etc\/apt\/sources\.list\.d\/ubuntu\.sources/);
});

test('apt update with Internet: every source is hit and nothing changes', () => {
  const srv = lab('internet').byLabel('SRV-SEDE2') as Host;
  const out = run(srv, 'apt update');
  assert.match(out, /^Hit:1 http:\/\/archive\.ubuntu\.com\/ubuntu resolute InRelease\nHit:2 http:\/\/archive\.ubuntu\.com\/ubuntu resolute-updates InRelease\nHit:3 http:\/\/archive\.ubuntu\.com\/ubuntu resolute-backports InRelease\nHit:4 http:\/\/security\.ubuntu\.com\/ubuntu resolute-security InRelease\nReading package lists\.\.\. Done\nBuilding dependency tree\.\.\. Done\nReading state information\.\.\. Done\nAll packages are up to date\.$/);
});

test('apt update without a way out: the real resolver errors and warnings', () => {
  const pc = lab('basico').byLabel('PC1') as Host;
  const out = run(pc, 'apt update; echo "status $?"');
  assert.match(out, /^Ign:1 http:\/\/archive\.ubuntu\.com\/ubuntu resolute InRelease\n/);
  assert.match(out, /Err:1 http:\/\/archive\.ubuntu\.com\/ubuntu resolute InRelease\n {2}Temporary failure resolving 'archive\.ubuntu\.com'/);
  assert.match(out, /Warning: Failed to fetch http:\/\/security\.ubuntu\.com\/ubuntu\/dists\/resolute-security\/InRelease {2}Temporary failure resolving 'security\.ubuntu\.com'\nWarning: Some index files failed to download\. They have been ignored, or old ones used instead\.\nstatus 0$/);
});

test('a name the DNS does not know, and no route to the mirror', () => {
  const t = lab('internet');
  const srv = t.byLabel('SRV-SEDE2') as Host;
  run(srv, "sed -i 's/archive.ubuntu.com/archivo.ubuntu.com/' /etc/apt/sources.list.d/ubuntu.sources");
  assert.match(run(srv, 'apt update'), /Err:1 http:\/\/archivo\.ubuntu\.com\/ubuntu resolute InRelease\n {2}Could not resolve 'archivo\.ubuntu\.com'/);
  run(srv, 'echo "185.125.190.81 archivo.ubuntu.com" >> /etc/hosts; ip route del default');
  assert.match(run(srv, 'apt update'), /Could not connect to archivo\.ubuntu\.com:80 \(185\.125\.190\.81\), connection timed out/);
});

test('upgrade, full-upgrade and autoremove: always up to date', () => {
  const srv = lab('internet').byLabel('SRV-SEDE2') as Host;
  const summary = /Summary:\n {2}Upgrading: 0, Installing: 0, Removing: 0, Not Upgrading: 0$/;
  assert.match(run(srv, 'apt upgrade'), /Calculating upgrade\.\.\. Done\nSummary:/);
  assert.match(run(srv, 'apt full-upgrade'), summary);
  assert.match(run(srv, 'apt autoremove'), summary);
});

test('apt install of a service package: download, set up, and its panel appears at once', () => {
  const t = lab('internet');
  const srv = t.byLabel('SRV-SEDE2') as Server;
  assert.ok(!deviceApps(srv).includes('dhcp'));
  const before = t.clock.now();
  const out = run(srv, 'apt install -y kea-dhcp4-server');
  assert.match(out, /^Reading package lists\.\.\. Done\nBuilding dependency tree\.\.\. Done\nReading state information\.\.\. Done\nInstalling:\n {2}kea-dhcp4-server\n\nInstalling dependencies:\n {2}kea-common/);
  assert.match(out, /Summary:\n {2}Upgrading: 0, Installing: \d+, Removing: 0, Not Upgrading: 0\n {2}Download size: [\d,]+ kB\n {2}Space needed: [\d,]+ kB \/ [\d.]+ GB available\n\nGet:1 http:\/\/archive\.ubuntu\.com\/ubuntu resolute\/main amd64 /);
  assert.match(out, /Fetched [\d,]+ kB in \ds \([\d,]+ kB\/s\)\n/);
  assert.match(out, /Setting up kea-dhcp4-server \([^)]+\) \.\.\.\nCreated symlink '\/etc\/systemd\/system\/multi-user\.target\.wants\/kea-dhcp4-server\.service' → '\/usr\/lib\/systemd\/system\/kea-dhcp4-server\.service'\./);
  assert.ok(deviceApps(srv).includes('dhcp'), 'the DHCP panel is on');
  assert.ok(t.clock.now() > before, 'the download takes simulated time');
  assert.match(run(srv, 'apt install kea-dhcp4-server'), /kea-dhcp4-server is already the newest version \([^)]+\)\.\nSummary:\n {2}Upgrading: 0, Installing: 0, Removing: 0, Not Upgrading: 0/);
  assert.match(run(srv, 'apt list --installed 2>/dev/null | grep kea-dhcp4'), /^kea-dhcp4-server\/resolute,now \S+ amd64 \[installed\]$/m);
});

test('apt remove takes the panel away and stops the service; works offline; purge says so', () => {
  const srv = lab('internet').byLabel('SRV-SEDE2') as Server;
  assert.ok(srv.services.http.enabled);
  const out = run(srv, 'apt remove -y apache2');
  assert.match(out, /REMOVING:\n {2}apache2\n\nSummary:\n {2}Upgrading: 0, Installing: 0, Removing: 1, Not Upgrading: 0\n {2}Freed space: [\d,]+ kB\n\n\(Reading database \.\.\. \d+ files and directories currently installed\.\)\nRemoving apache2 \(/);
  assert.ok(!deviceApps(srv).includes('http'));
  assert.equal(srv.services.http.enabled, false, 'apache2 stopped');
  assert.match(run(srv, 'apt remove apache2'), /Package 'apache2' is not installed, so not removed/);
  run(srv, 'ip route del default');
  assert.match(run(srv, 'apt purge -y bind9'), /REMOVING:\n {2}bind9\*\n[\s\S]*Purging configuration files for bind9 /);
});

test('without Internet the packages cannot be fetched; unknown and essential packages', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  setDeviceApps(srv, freshApps(srv)); // as placed from the palette: no service
  const out = run(srv, 'apt install -y apache2; echo "status $?"');
  assert.match(out, /Err:1 http:\/\/archive\.ubuntu\.com\/ubuntu resolute\/main amd64 apache2-bin amd64 \S+\n {2}Temporary failure resolving 'archive\.ubuntu\.com'/);
  assert.match(out, /Error: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing\?\nstatus 100$/);
  assert.ok(!deviceApps(srv).includes('http'), 'nothing installed');
  assert.match(run(srv, 'apt install -y netfix-pro; echo "status $?"'), /Error: Unable to locate package netfix-pro\nstatus 100$/);
  assert.match(run(srv, 'apt install bash'), /bash is already the newest version/);
  assert.match(run(srv, 'apt remove -y bash'), /Error: Removing essential system-critical packages is not permitted\. This might break the system\./);
});

test('apt needs root for what changes the system; a "no" at the question aborts', () => {
  const srv = lab('internet').byLabel('SRV-SEDE2') as Server;
  assert.match(run(srv, 'apt install apache2; echo "status $?"', 'admin'), /^Error: Could not open lock file \/var\/lib\/dpkg\/lock-frontend - open \(13: Permission denied\)\nError: Unable to acquire the dpkg frontend lock \(\/var\/lib\/dpkg\/lock-frontend\), are you root\?\nstatus 100$/);
  assert.match(run(srv, 'apt update; echo "status $?"', 'admin'), /Error: Could not open lock file \/var\/lib\/apt\/lists\/lock - open \(13: Permission denied\)\nError: Unable to lock directory \/var\/lib\/apt\/lists\/\nstatus 100$/);
  assert.match(run(srv, 'echo n | apt install kea-dhcp4-server; echo "status $?"'), /Continue\? \[Y\/n\] Abort\.\nstatus 1$/);
  assert.ok(!deviceApps(srv).includes('dhcp'), 'nothing installed');
});

test('apt moo: the real super cow, by number of moos and by date', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  t.clock.set(Date.UTC(2026, 9, 29, 12));
  const cow = run(srv, 'apt moo');
  assert.equal(cow, [
    '                 (__) ', '                 (oo) ', '           /------\\/ ', '          / |    ||   ', '         *  /\\---/\\ ', '            ~~   ~~   ',
    '..."Have you mooed today?"...'].join('\n'));
  assert.match(run(srv, 'apt moo moo'), /^ {9}_______~\(\.\.\)~ $/m);
  assert.match(run(srv, 'apt moo moo moo'), /^___________\|_\|_\|_____________$/m);
  assert.equal(run(srv, 'apt moo moo moo moo'), cow, 'four or more: the first cow again');
  t.clock.set(Date.UTC(2026, 11, 25, 12));
  assert.match(run(srv, 'apt moo'), /^ {19}\(__\) \n[\s\S]*\n\.\.\."Happy package management day!"\.\.\.$/);
  t.clock.set(Date.UTC(2027, 3, 1, 12));
  assert.match(run(srv, 'apt moo moo'), /^ {16}\)___ {3}_ {2}Have you smashed some milk today\?$/m);
});

test('the public DNS know the names of the Ubuntu repositories', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  const out = run(pc, 'for n in archive security es.archive ports changelogs keyserver esm; do dig +short $n.ubuntu.com; done', 'alumno');
  assert.equal(out.trim().split('\n').length, 7, out);
});
