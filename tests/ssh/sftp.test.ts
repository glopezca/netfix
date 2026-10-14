/** sftp and scp between a PC and a Server: subsystem, permissions of the remote user, errors, sshd_config. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (lines: string[]): string => lines.join('\n');

function lab(): { srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  t.settle();
  return { srv, pc };
}

test('interactive sftp: login, put, ls -l, get, mkdir, rename, rm and permission errors', () => {
  const { srv, pc } = lab();
  const sh = createShell(pc, 'linux');
  sh.run('echo "hola sftp" > notas.txt');
  sh.run('sftp admin@10.0.0.2');
  assert.match(sh.prompt(), /continue connecting/);
  sh.run('yes');
  assert.equal(sh.prompt(), "admin@10.0.0.2's password: ");
  assert.deepEqual(sh.run('cisco'), ['Connected to 10.0.0.2.']);
  assert.equal(sh.prompt(), 'sftp> ');
  assert.deepEqual(sh.run('pwd'), ['Remote working directory: /home/admin']);
  assert.match(all(sh.run('put notas.txt')), /^Uploading notas\.txt to \/home\/admin\/notas\.txt\nnotas\.txt +100% +10 /);
  assert.equal(hostSystem(srv).fs.readFile('/home/admin/notas.txt'), 'hola sftp\n');
  assert.match(all(sh.run('ls -l')), /^-rw-r--r-- {4}1 admin {4}admin +10 \w{3} \d\d \d\d:\d\d notas\.txt$/m);
  sh.run('mkdir docs');
  sh.run('rename notas.txt docs/n.txt');
  assert.deepEqual(sh.run('ls docs'), ['n.txt']);
  sh.run('lcd /tmp');
  assert.match(all(sh.run('get docs/n.txt')), /^Fetching \/home\/admin\/docs\/n\.txt to n\.txt/);
  assert.equal(hostSystem(pc).fs.readFile('/tmp/n.txt'), 'hola sftp\n');
  assert.deepEqual(sh.run('put /etc/hostname /etc/passwd'), ['Uploading /etc/hostname to /etc/passwd', 'dest open "/etc/passwd": Permission denied']);
  assert.deepEqual(sh.run('get nada.txt'), ['File "/home/admin/nada.txt" not found.']);
  assert.deepEqual(sh.run('rmdir docs'), ['remote rmdir "/home/admin/docs": Directory not empty']);
  sh.run('rm docs/n.txt');
  sh.run('chmod 600 docs');
  assert.equal(hostSystem(srv).fs.stat('/home/admin/docs').mode & 0o777, 0o600);
  assert.deepEqual(sh.run('frobnicate'), ['Invalid command.']);
  sh.run('bye');
  assert.notEqual(sh.prompt(), 'sftp> ');
  assert.match(all(srv.journal('ssh').map((l) => l.line)), /subsystem request for sftp by user admin/);
});

test('scp up and down, batch sftp, wrong password and Subsystem removed from sshd_config', () => {
  const { srv, pc } = lab();
  const sh = createShell(pc, 'linux');
  sh.run('echo uno > a.txt; mkdir -p ~/.ssh; ssh-keyscan 2>/dev/null; true');
  sh.run('scp -o StrictHostKeyChecking=accept-new a.txt admin@10.0.0.2:');
  assert.match(all(sh.run('cisco')), /a\.txt +100% +4 /);
  assert.equal(hostSystem(srv).fs.readFile('/home/admin/a.txt'), 'uno\n');
  sh.run('scp admin@10.0.0.2:/etc/hostname copia.txt');
  sh.run('cisco');
  assert.equal(hostSystem(pc).fs.readFile('/home/alumno/copia.txt'), hostSystem(srv).fs.readFile('/etc/hostname'));
  sh.run('scp admin@10.0.0.2:/no/existe .');
  assert.deepEqual(sh.run('cisco'), ['scp: /no/existe: No such file or directory']);
  sh.run('printf "cd /etc\\npwd\\nls hostname\\n" > lote');
  assert.match(all(sh.run('sftp -b lote admin@10.0.0.2')), /Permission denied/, '-b implies BatchMode: no password prompt');
  sh.run(`ssh-keygen -q -t ed25519 -f ~/.ssh/id_ed25519 -N ''`);
  sh.run('ssh-copy-id admin@10.0.0.2');
  sh.run('cisco');
  assert.deepEqual(sh.run('sftp -b lote admin@10.0.0.2'), ['Connected to 10.0.0.2.', 'sftp> cd /etc', 'sftp> pwd', 'Remote working directory: /etc', 'sftp> ls hostname', 'hostname']);
  sh.run('sftp -o PubkeyAuthentication=no admin@10.0.0.2');
  sh.run('mala');
  sh.run('mala');
  assert.match(all(sh.run('mala')), /Permission denied \(publickey,password\)\.\nConnection closed/);
  const root = createShell(srv, 'linux', 'root');
  root.run("sed -i 's/^Subsystem/#Subsystem/' /etc/ssh/sshd_config && systemctl reload ssh");
  assert.match(all(sh.run('sftp admin@10.0.0.2')), /subsystem request failed on channel 0\nConnection closed/);
  assert.equal(all(sh.run('ssh -o BatchMode=yes admin@10.0.0.2 echo shell-ok')), 'shell-ok', 'ssh itself still works');
});
