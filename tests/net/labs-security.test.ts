/** Security labs: SSH/SFTP with keys, and hardening with ACL + nftables + sshd_config. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Server } from '../../src/devices/server.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';

const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const all = (l: string[]): string => l.join('\n');

test('SSH/SFTP lab: SFTP with each user\'s permissions, keys, then passwords off', () => {
  const t = lab('ssh-sftp');
  const srv = t.byLabel('SRV') as Server;
  const sh = createShell(t.byLabel('PC1') as Pc, 'linux');
  sh.run('echo entrega > tarea.txt');
  sh.run('sftp -o StrictHostKeyChecking=accept-new ana@172.20.0.10');
  sh.run('ana1');
  assert.match(all(sh.run('ls')), /bienvenida\.txt/);
  sh.run('put tarea.txt');
  assert.deepEqual(sh.run('put tarea.txt /srv/compartido/tarea.txt').slice(-1), ['dest open "/srv/compartido/tarea.txt": Permission denied']);
  sh.run('bye');
  assert.equal(hostSystem(srv).fs.readFile('/home/ana/tarea.txt'), 'entrega\n');
  sh.run(`ssh-keygen -q -t ed25519 -f ~/.ssh/id_ed25519 -N ''`);
  sh.run('ssh-copy-id ana@172.20.0.10');
  sh.run('ana1');
  createShell(srv, 'linux', 'root').run("echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/20-solo-claves.conf && systemctl reload ssh");
  assert.equal(all(sh.run('ssh ana@172.20.0.10 whoami')), 'ana', 'the key still works');
  const other = createShell(t.byLabel('PC0') as Pc, 'linux');
  assert.match(all(other.run('ssh -o StrictHostKeyChecking=accept-new ana@172.20.0.10')), /Permission denied \(publickey\)/, 'no password prompt any more');
});

test('hardening lab: admin gets SSH and ping, students only the web; ACL and nftables log the rest', () => {
  const t = lab('bastionado');
  const gw = t.byLabel('GW') as Router;
  const admin = createShell(t.byLabel('ADMIN') as Pc, 'linux');
  const student = createShell(t.byLabel('ALUMNO') as Pc, 'linux');
  assert.match(all(admin.run('ping -c 2 172.20.0.10')), /[12] received/);
  admin.run('ssh -o StrictHostKeyChecking=accept-new admin@172.20.0.10');
  admin.run('cisco');
  assert.equal(all(admin.run('whoami')), 'admin');
  admin.run('exit');
  assert.match(all(student.run('curl -s http://172.20.0.10/')), /Servidor web de Netfix/);
  assert.match(all(student.run('nc -zv -w 1 172.20.0.10 22 2>&1')), /timed out/);
  assert.match(all(student.run('ping -c 1 -W 1 172.20.0.10')), /100% packet loss|Unreachable/);
  const s = new Session(gw);
  s.mode = 'exec';
  assert.match(s.input('show access-lists A-SERVIDORES').join('\n'), /deny ip any any log \(\d+ match\(es\)\)/);
  admin.run('ssh -o StrictHostKeyChecking=accept-new ana@172.20.0.10');
  assert.match(all(admin.run('ana1')), /Permission denied/, 'AllowUsers admin');
  const srvRoot = createShell(t.byLabel('SRV-INTRANET') as Server, 'linux', 'root');
  assert.match(all(srvRoot.run('sshd -T 2>/dev/null | grep -i permitrootlogin; nft list ruleset | grep -c accept')), /permitrootlogin no|^\d+$/m);
});
