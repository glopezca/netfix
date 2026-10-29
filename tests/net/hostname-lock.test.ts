/**
 * The host name of PCs, servers and GNU/Linux routers always comes from the device name (Equipo): it is derived when the
 * device is created, opened from a file or renamed, and the terminal, sysctl, /etc/hostname and the web GUI cannot
 * change it. The pretty name stays free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
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
  assert.equal(pc.name, 'pc0');
  renameDevice(p, 'Aula Pública 2º');
  assert.equal(p.label, 'Aula Pública 2º');
  assert.equal(pc.name, 'aula-publica-2o');
  assert.equal(all(createShell(pc, 'windows').run('hostname')), 'aula-publica-2o');
  assert.equal(all(createShell(pc, 'linux').run('hostname')), 'aula-publica-2o');
  assert.equal((t.add('linuxrouter', 0, 0).device as Server).name, 'linuxrouter0');
});

test('the terminal cannot change it (hostnamectl, hostname, sysctl, /etc/hostname); the pretty name can', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const root = createShell(srv, 'linux', 'root');
  assert.match(all(root.run('hostnamectl set-hostname web01')), /Could not set static hostname: .*nombre del equipo/);
  assert.match(all(root.run('hostnamectl hostname web01')), /Could not set static hostname/);
  assert.match(all(root.run('hostname web01')), /^hostname: .*nombre del equipo/m);
  assert.match(all(root.run('sysctl -w kernel.hostname=web01')), /sysctl: /);
  root.run('echo web01 > /etc/hostname');
  assert.equal(srv.name, 'server0');
  assert.equal(all(root.run('cat /etc/hostname')), 'server0');
  assert.equal(all(root.run('hostnamectl set-hostname --pretty "Servidor del aula"; echo $?')), '0');
  assert.equal(srv.prettyName, 'Servidor del aula');
});

test('a saved host name is ignored when a topology is opened', () => {
  const t = new Topology();
  t.add('pc', 0, 0);
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  json.devices[0].pc = { ...json.devices[0].pc, hostname: 'otro' };
  const again = Topology.fromJSON(json);
  assert.equal(([...again.placed.values()][0]?.device as Pc).name, 'pc0');
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
  assert.match(body, /server0/);
  web.open('http://10.0.0.2:10000/?page=setup', { method: 'POST', form: [['action', 'setup'], ['hostname', 'web01'], ['mode', 'static'], ['ip', '10.0.0.2'], ['mask', '255.255.255.0'], ['gateway', ''], ['dns', '']] });
  assert.equal(srv.name, 'server0');
});

test('a cloud behaves the same: host name derived from its name, its ISP name apart', () => {
  const t = new Topology();
  const p = t.add('cloud', 0, 0);
  const cloud = p.device as Cloud;
  assert.equal(cloud.name, 'cloud0');
  renameDevice(p, 'ISP Norte');
  assert.equal(cloud.name, 'isp-norte');
  assert.equal(cloud.settings.isp, 'ISP Cloud0', 'the provider name is a setting of the ISP tab');
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(([...again.placed.values()][0]?.device as Cloud).name, 'isp-norte');
});

test('review: two names that give the same host name keep different host names (-2)', () => {
  const t = new Topology();
  const a = t.add('pc', 0, 0, { label: 'PC 1' });
  const b = t.add('pc', 0, 0, { label: 'pc-1' });
  assert.equal((a.device as Pc).name, 'pc-1');
  assert.equal((b.device as Pc).name, 'pc-1-2');
  renameDevice(a, 'Aula');
  renameDevice(b, 'pc-1');
  assert.equal((b.device as Pc).name, 'pc-1', 'free again');
  const root = createShell(t.add('server', 0, 0).device as Server, 'linux', 'root');
  assert.match(all(root.run('sysctl -w kernel.hostname=x')), /permission denied on key "kernel\.hostname" \(.*nombre del equipo/);
});
