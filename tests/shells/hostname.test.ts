/** Host name: derived from the device name (Equipo); hostnamectl, hostname and /etc/hostname cannot change it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { validHostname } from '../../src/devices/host.ts';

const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  return { t, srv, pc };
}

test('hostname rules (RFC 1123)', () => {
  assert.equal(validHostname('pc-aula1'), null);
  assert.equal(validHostname('srv.aula.lab'), null);
  assert.match(validHostname('') ?? '', /vacío/);
  assert.match(validHostname('mal nombre') ?? '', /letras/);
  assert.match(validHostname('-guion') ?? '', /letras/);
  assert.match(validHostname('x'.repeat(64)) ?? '', /63/);
});

test('setHostname changes the name used by DHCP, the shells and the generated files', () => {
  const { pc } = lab();
  pc.setHostname('portatil-ana');
  assert.equal(pc.name, 'portatil-ana');
  const sh = createShell(pc, 'linux');
  assert.equal(plain(sh.prompt()), 'alumno@portatil-ana:~$ ');
  assert.deepEqual(sh.run('cat /etc/hostname; hostname'), ['portatil-ana', 'portatil-ana']);
  assert.deepEqual(createShell(pc, 'windows').run('hostname'), ['portatil-ana']);
  assert.throws(() => pc.setHostname('no válido'), /letras/);
});

test('hostnamectl shows the status; set-hostname asks the password and is refused (the name comes from Equipo)', () => {
  const { srv } = lab();
  const sh = createShell(srv, 'linux');
  const status = sh.run('hostnamectl').join('\n');
  assert.match(status, /^ Static hostname: server0$/m);
  assert.match(status, /^Operating System: Ubuntu 26\.04 LTS$/m);
  assert.deepEqual(sh.run('hostnamectl hostname'), ['server0']);
  assert.deepEqual(sh.run('hostnamectl set-hostname web01'), [
    '==== AUTHENTICATING FOR org.freedesktop.hostname1.set-static-hostname ====',
    'Authentication is required to set the statically configured local hostname, as well as the pretty hostname.',
    'Authenticating as: admin',
  ]);
  assert.equal(sh.prompt(), 'Password: ');
  assert.deepEqual(sh.run('cisco'), ['==== AUTHENTICATION COMPLETE ====', 'Could not set static hostname: en Netfix el nombre de host se deriva del nombre del equipo (pestaña Equipo)']);
  assert.equal(srv.name, 'server0');
  assert.deepEqual(sh.run('sudo hostnamectl set-hostname --pretty "Servidor web"; hostnamectl | grep --color=never Pretty'), []);
  assert.deepEqual(sh.run('cisco'), [' Pretty hostname: Servidor web']);
});

test('hostname NAME and /etc/hostname cannot change it either', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('hostname temporal'), ['hostname: you must be root to change the host name']);
  assert.deepEqual(sh.run('sudo hostname temporal; hostname'), ['hostname: en Netfix el nombre de host se deriva del nombre del equipo (pestaña Equipo)', 'pc0']);
  assert.match(sh.run('echo otro > /etc/hostname').join(''), /Read-only file system/, 'generated from Equipo, like other generated files');
  sh.run('echo nuevo | sudo tee /etc/hostname');
  assert.deepEqual(sh.run('cat /etc/hostname'), ['pc0']);
  assert.equal(pc.name, 'pc0');
});

test('saving and loading keeps the pretty name; the host name is derived again', () => {
  const { t, pc } = lab();
  createShell(pc, 'linux').run('sudo hostnamectl set-hostname --pretty "PC de Luis"');
  const t2 = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const names = [...t2.placed.values()].map((p) => [p.label, (p.device as Pc).name, (p.device as Pc).prettyName]);
  assert.deepEqual(names, [['Server0', 'server0', undefined], ['PC0', 'pc0', 'PC de Luis']]);
});
