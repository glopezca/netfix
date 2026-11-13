/**
 * The host name of PCs, servers and GNU/Linux routers always comes from the device name (Equipo): it is derived when the
 * device is created, opened from a file or renamed, and the terminal, sysctl, /etc/hostname and the web GUI cannot
 * change it. The pretty name stays free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { Server } from '../../src/devices/server.ts';
import { SimClock } from '../../src/core/clock.ts';
import { saveSysctl } from '../../src/shells/kernel-save.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import { createShell } from '../../src/shells/factory.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import { renameDevice } from '../../src/net/device-names.ts';
import { parseIp } from '../../src/core/ip.ts';

const all = (l: string[]): string => l.join('\n');

test('derived on creation and on rename; the Windows and GNU/Linux terminals show it', () => {
  const t = new Topology();
  const p = t.add('pc', 0, 0);
  const pc = p.device as Pc;
  assert.equal(pc.name, 'PC0', 'case kept, as Ubuntu keeps it');
  renameDevice(p, 'Aula Pública 2º');
  assert.equal(p.label, 'Aula Pública 2º');
  assert.equal(pc.name, 'Aula-Publica-2o');
  assert.equal(all(createShell(pc, 'windows').run('hostname')), 'Aula-Publica-2o');
  assert.equal(all(createShell(pc, 'linux').run('hostname')), 'Aula-Publica-2o');
  assert.equal((t.add('linuxrouter', 0, 0).device as Server).name, 'LinuxRouter0');
});

test('/etc/hostname cannot change it; the pretty name can', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const root = createShell(srv, 'linux', 'root');
  root.run('echo web01 > /etc/hostname');
  assert.equal(srv.name, 'Server0');
  assert.equal(all(root.run('cat /etc/hostname')), 'Server0');
  assert.equal(all(root.run('hostnamectl set-hostname --pretty "Servidor del aula"; echo $?')), '0');
  assert.equal(srv.prettyName, 'Servidor del aula');
});

test('a saved host name is ignored when a topology is opened', () => {
  const t = new Topology();
  t.add('pc', 0, 0);
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  json.devices[0].pc = { ...json.devices[0].pc, hostname: 'otro' };
  const again = Topology.fromJSON(json);
  assert.equal(([...again.placed.values()][0]?.device as Pc).name, 'PC0');
});

test('the web GUI shows the host name without a field and ignores one sent', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  const web = new BrowserEngine(pc);
  web.login('http://10.0.0.2:10000/', 'admin', 'netfix');
  const page = web.open('http://10.0.0.2:10000/?page=setup');
  const body = page.kind === 'page' ? page.response.body : '';
  assert.doesNotMatch(body, /name="hostname"/);
  assert.match(body, /Server0/);
  web.open('http://10.0.0.2:10000/?page=setup', { method: 'POST', form: [['action', 'setup'], ['hostname', 'web01'], ['mode', 'static'], ['ip', '10.0.0.2'], ['mask', '255.255.255.0'], ['gateway', ''], ['dns', '']] });
  assert.equal(srv.name, 'Server0');
});

test('a cloud behaves the same: host name derived from its name, its ISP name apart', () => {
  const t = new Topology();
  const p = t.add('cloud', 0, 0);
  const cloud = p.device as Cloud;
  assert.equal(cloud.name, 'Cloud0');
  renameDevice(p, 'ISP Norte');
  assert.equal(cloud.name, 'ISP-Norte');
  assert.equal(cloud.settings.isp, 'ISP Cloud0', 'the provider name is a setting of the ISP tab');
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(([...again.placed.values()][0]?.device as Cloud).name, 'ISP-Norte');
});

test('review: two names that give the same host name keep different host names (-2)', () => {
  const t = new Topology();
  const a = t.add('pc', 0, 0, { label: 'PC 1' });
  const b = t.add('pc', 0, 0, { label: 'pc-1' });
  assert.equal((a.device as Pc).name, 'PC-1');
  assert.equal((b.device as Pc).name, 'pc-1-2', 'the same name without case');
  renameDevice(a, 'Aula');
  renameDevice(b, 'pc-1');
  assert.equal((b.device as Pc).name, 'pc-1', 'free again');
  const root = createShell(t.add('server', 0, 0).device as Server, 'linux', 'root');
});

test('transient name, as on Ubuntu: hostname, --transient, sysctl, /proc/sys, sysctl.conf and the panel set it', () => {
  const t = new Topology();
  const p = t.add('server', 0, 0);
  const srv = p.device as Server;
  const root = createShell(srv, 'linux', 'root');
  assert.equal(all(root.run('hostname Bastion; echo $?')), '0');
  assert.equal(p.label, 'Server0', 'the device name and the static name do not change');
  assert.equal(srv.name, 'Server0');
  assert.equal(all(root.run('hostname; cat /etc/hostname; cat /proc/sys/kernel/hostname')), 'Bastion\nServer0\nBastion', 'case kept');
  assert.match(all(root.run('hostnamectl')), /^ Static hostname: Server0\nTransient hostname: Bastion$/m);
  assert.equal(all(root.run('hostnamectl hostname --transient')), 'Bastion');
  assert.equal(all(createShell(srv, 'linux', 'root').run('echo "$HOSTNAME"')), 'Bastion', 'a new shell (its prompt) uses it');
  assert.equal(all(root.run('sysctl -w kernel.hostname=web02')), 'kernel.hostname = web02');
  assert.equal(srv.runtimeName(), 'web02');
  root.run('echo web03 > /proc/sys/kernel/hostname');
  assert.equal(srv.runtimeName(), 'web03');
  assert.equal(all(root.run('hostnamectl set-hostname --transient web04; echo $?')), '0');
  assert.equal(srv.runtimeName(), 'web04');
  assert.equal(saveSysctl(srv, 'kernel.hostname', 'panel-1'), null, 'the panel and the web page');
  assert.equal(srv.runtimeName(), 'panel-1');
  assert.equal(p.label, 'Server0');
  assert.equal(all(root.run('sysctl -w kernel.hostname="Aula 1"; hostname')), 'kernel.hostname = Aula 1\nAula 1', 'the kernel takes any text');
  assert.match(all(root.run('sysctl -w kernel.hostname=' + 'x'.repeat(65) + '; echo $?')), /Invalid argument\n255$/, 'up to 64 characters');
  root.run('sysctl -w kernel.hostname=panel-1');
  assert.match(all(root.run('hostname bad_name; echo $?')), /^hostname: the specified hostname is invalid\n1$/);
  assert.match(all(root.run('hostnamectl set-hostname --transient -- -bad; echo $?')), /Invalid transient hostname '-bad'\n1$/);
  assert.match(all(root.run(`hostname ${'x'.repeat(65)}; echo $?`)), /^hostname: name too long\n1$/);
  assert.equal(srv.runtimeName(), 'panel-1');
});

test('the static name ends the transient one: hostnamectl set-hostname and renaming in Equipo', () => {
  const t = new Topology();
  const p = t.add('server', 0, 0);
  const srv = p.device as Server;
  const root = createShell(srv, 'linux', 'root');
  root.run('hostname temporal');
  root.run('hostnamectl set-hostname web01');
  assert.equal(srv.runtimeName(), 'web01');
  root.run('hostname temporal');
  renameDevice(p, 'Aula');
  assert.equal(srv.runtimeName(), 'Aula');
  assert.equal(srv.transientName, undefined);
});

test('reopening the lab is a reboot: the transient name is lost, unless sysctl.conf sets it again', () => {
  const t = new Topology();
  t.add('server', 0, 0);
  const pc = t.add('pc', 0, 0);
  createShell(t.placed.values().next().value?.device as Server, 'linux', 'root').run('hostname temporal');
  createShell(pc.device as Pc, 'linux', 'root').run('echo kernel.hostname=arranque > /etc/sysctl.d/90-name.conf; hostname otro');
  const again = [...Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON()))).placed.values()];
  assert.equal((again[0]?.device as Server).runtimeName(), 'Server0');
  assert.equal((again[1]?.device as Pc).runtimeName(), 'arranque', 'systemd-sysctl applies it at boot');
  assert.equal(again[1]?.label, 'PC0');
});

test('a host outside a topology can still take a transient name', () => {
  const loose = new Server('x', 'loose', new SimClock(0), 9);
  assert.equal(all(createShell(loose, 'linux', 'root').run('sysctl -w kernel.hostname=x; echo $?')), 'kernel.hostname = x\n0');
  assert.equal(loose.runtimeName(), 'x');
});

test('hostnamectl set-hostname renames the device: its name as typed, the host name derived, everything at once', () => {
  const t = new Topology();
  const p = t.add('server', 0, 0);
  const srv = p.device as Server;
  const root = createShell(srv, 'linux', 'root');
  assert.equal(all(root.run('hostnamectl set-hostname Web-01; echo $?')), '0');
  assert.equal(p.label, 'Web-01', 'the device name keeps what was typed');
  assert.equal(srv.name, 'Web-01', 'case kept, as systemd keeps it');
  assert.match(all(root.run('hostnamectl')), /^ Static hostname: Web-01$/m);
  assert.equal(all(root.run('cat /etc/hostname')), 'Web-01');
  assert.equal(all(root.run('hostname')), 'Web-01');
  assert.equal(all(root.run('hostnamectl hostname srv2; echo $?')), '0', 'hostnamectl hostname NAME too');
  assert.equal(p.label, 'srv2');
  assert.match(all(root.run('hostnamectl set-hostname --static -- -bad; echo $?')), /^Could not set static hostname: Invalid static hostname '-bad'\n1$/);
  assert.equal(all(root.run('hostnamectl set-hostname "Aula 2"; echo $?')), '0', 'systemd: not valid as it is');
  assert.equal(p.label, 'Aula2', 'the static name is its cleaned form');
  assert.equal(srv.prettyName, 'Aula 2', 'and the pretty name what was typed');
  root.run('hostnamectl set-hostname srv2');
  assert.equal(srv.prettyName, undefined, 'a valid name clears the pretty one, as systemd does');
  assert.equal(p.label, 'srv2');
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(([...again.placed.values()][0]?.device as Server).name, 'srv2', 'saved with the lab');
});

test('a name another device has: the device gets it, its host name goes on with -2', () => {
  const t = new Topology();
  t.add('pc', 0, 0);
  const p = t.add('pc', 0, 0);
  createShell(p.device as Pc, 'linux', 'root').run('hostnamectl set-hostname pc0');
  assert.equal(p.label, 'pc0');
  assert.equal((p.device as Pc).name, 'pc0-2');
});
