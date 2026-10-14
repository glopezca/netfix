/** Engines of the PC's SSH and file transfer apps: keyring (keys, known_hosts, sessions) and FileTransfer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { hostSystem, hostUsers } from '../../src/shells/host-system.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';
import { SshKeyring } from '../../src/clients/ssh-keyring.ts';
import { FileTransfer } from '../../src/clients/file-transfer.ts';

function lab(): { srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  t.settle();
  return { srv, pc };
}

const alumno = (pc: Pc) => hostUsers(pc).find((u) => u.name === 'alumno')!;

test('keyring: generate keys with the right modes, list them, sessions and known_hosts', () => {
  const { pc } = lab();
  const fs = hostSystem(pc).fs;
  const ring = new SshKeyring(fs, alumno(pc), 'pc0');
  assert.equal(ring.generate('ed25519', 'id_ed25519', ''), null);
  assert.equal(ring.generate('ed25519', 'id_ed25519', ''), 'exists');
  assert.equal(ring.generate('rsa', '../evil', ''), 'name');
  assert.equal(fs.stat('/home/alumno/.ssh/id_ed25519').mode & 0o777, 0o600);
  assert.equal(fs.stat('/home/alumno/.ssh').mode & 0o777, 0o700);
  const [key] = ring.keys();
  assert.equal(key?.type, 'ssh-ed25519');
  assert.match(key?.fingerprint ?? '', /^SHA256:/);
  assert.match(createShell(pc, 'linux').run('ssh-keygen -l -f ~/.ssh/id_ed25519.pub').join('\n'), new RegExp(key?.fingerprint.replace(/[+/]/g, '\\$&') ?? 'x'));
  assert.equal(ring.saveProfile({ name: 'web', host: '10.0.0.2', port: 22, user: 'admin', identity: '' }), null);
  assert.deepEqual(ring.profiles().map((p) => p.name), ['web']);
  ring.deleteProfile('web');
  assert.deepEqual(ring.profiles(), []);
  ring.deleteKey('id_ed25519');
  assert.deepEqual(ring.keys(), []);
});

test('file transfer: host key question, password, panes, upload/download and errors', () => {
  const { srv, pc } = lab();
  const fs = hostSystem(pc).fs;
  fs.writeFile('/home/alumno/informe.txt', 'datos\n', { uid: 1000, gid: 1000 });
  const ft = new FileTransfer(pc, fs, alumno(pc));
  const asked: string[] = [];
  assert.equal(ft.connect({ host: '10.0.0.2', port: 22, user: 'admin', password: 'mal' }, { hostKey: (_h, fp) => { asked.push(fp); return true; }, passphrase: () => null }), false);
  assert.match(ft.log.map((l) => l.text).join('\n'), /Authentication failed|Permission denied/);
  assert.ok(asked[0]?.startsWith('SHA256:'));
  assert.equal(ft.connect({ host: '10.0.0.2', port: 22, user: 'admin', password: 'cisco' }, { hostKey: () => { throw new Error('already known'); }, passphrase: () => null }), true);
  assert.equal(ft.session?.cwd, '/home/admin');
  assert.ok(ft.localList().some((e) => e.name === 'informe.txt'));
  assert.ok(ft.upload('informe.txt'));
  assert.equal(hostSystem(srv).fs.readFile('/home/admin/informe.txt'), 'datos\n');
  assert.ok(ft.remote('mkdir', 'subida'));
  assert.ok(ft.remote('rename', 'informe.txt', 'subida/i.txt'));
  ft.remoteCd('subida');
  assert.deepEqual(ft.remoteList().map((e) => e.name), ['i.txt']);
  ft.localCd('/tmp');
  assert.ok(ft.download('i.txt'));
  assert.equal(fs.readFile('/tmp/i.txt'), 'datos\n');
  ft.remoteCd('/etc');
  assert.equal(ft.upload('/tmp/i.txt'), false);
  assert.match(ft.log.at(-1)?.text ?? '', /permission denied/);
  assert.ok(new SshKeyring(fs, alumno(pc), 'pc').knownHosts().some((k) => k.host === '10.0.0.2'));
});
