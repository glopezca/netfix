/** The Ubuntu terminal of Netfix hosts: bash on the host file system, network programs, editors, SSH and saving. */
import { zonesFromLegacy } from '../../src/services/dns-zones.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Switch } from '../../src/devices/switch.ts';
import { createShell } from '../../src/shells/factory.ts';
import { textLines } from '../../src/shells/linux.ts';
import { validFileRecords, exportFiles } from '../../src/bash/vfs-persist.ts';
import { hostSystem, hostUsers } from '../../src/shells/host-system.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24, dns: ip('10.0.0.2') });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, dns: ip('10.0.0.2') });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }, { name: 'ana', password: 'ana1' }] },
    dns: { enabled: true, zones: zonesFromLegacy(undefined, [{ name: 'www.aula.lab', type: 'A', value: '10.0.0.2', ttl: 3600 }]) } });
  return { t, srv, pc };
}

test('textLines keeps a final line without newline and drops the trailing empty one', () => {
  assert.deepEqual(textLines(''), []);
  assert.deepEqual(textLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(textLines('a\nb'), ['a', 'b']);
  assert.deepEqual(textLines('\n'), ['']);
});

test('bash runs on the host file system with users, sudo groups and command-not-found', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.equal(plain(sh.prompt()), 'alumno@pc0:~$ ');
  assert.deepEqual(sh.run('echo "$BASH_VERSION"'), ['5.3.20(1)-release']);
  assert.deepEqual(sh.run('echo hola > notas.txt; cat notas.txt; pwd'), ['hola', '/home/alumno']);
  assert.deepEqual(sh.run('id'), ['uid=1000(alumno) gid=1000(alumno) groups=1000(alumno),4(adm),27(sudo),100(users)']);
  assert.match(sh.run('ifconfig').join('\n'), /Command 'ifconfig' not found, but can be installed with:\nsudo apt install net-tools/);
  assert.deepEqual(sh.run('nada; echo $?'), ['nada: command not found', '127']);
  assert.match(sh.run('cat /etc/hosts').join('\n'), /127\.0\.1\.1 pc0/);
  assert.match(sh.run('echo x > /etc/hosts').join('\n'), /Permission denied|Read-only file system/);
  assert.deepEqual(sh.run('for i in 1 2 3; do printf "%s-" $i; done; echo'), ['1-2-3-']);
});

test('network programs write files and report bash exit statuses', () => {
  const { t, pc } = lab();
  t.settle();
  const sh = createShell(pc, 'linux');
  assert.match(sh.run('wget -q http://www.aula.lab/ayuda.html && ls').join('\n'), /ayuda\.html/);
  assert.deepEqual(sh.run('curl -s -o copia.html http://10.0.0.2/; echo $?; test -s copia.html && echo ok'), ['0', 'ok']);
  assert.deepEqual(sh.run('curl http://nohay.lab >/dev/null 2>&1; echo $?'), ['6']);
  assert.deepEqual(sh.run('ping -c 1 10.0.0.2 >/dev/null && echo up'), ['up']);
  assert.deepEqual(sh.run('dig +short www.aula.lab | wc -l'), ['1']);
  assert.deepEqual(sh.run('ip -br a | grep -c eth0'), ['1']);
  assert.deepEqual(sh.run('ssh nadie@nohay.lab; echo "status=$?"'), ['ssh: Could not resolve hostname nohay.lab: Name or service not known', 'status=255']);
});

test('sudo asks the account password and root writes the web root served by Apache', () => {
  const { t, srv, pc } = lab();
  t.settle();
  const sh = createShell(srv, 'linux');
  assert.match(sh.run('echo "<h1>nuevo</h1>" > /var/www/html/nuevo.html').join(''), /Permission denied/);
  assert.deepEqual(sh.run('echo "<h1>nuevo</h1>" | sudo tee /var/www/html/nuevo.html'), []);
  assert.equal(sh.prompt(), '[sudo] password for admin: ');
  assert.deepEqual(sh.run('mal'), ['Sorry, try again.']);
  assert.deepEqual(sh.run('cisco'), ['<h1>nuevo</h1>']);
  assert.ok(srv.services.http.files.some((f) => f.name === 'nuevo.html'));
  assert.deepEqual(createShell(pc, 'linux').run('curl -s http://10.0.0.2/nuevo.html'), ['<h1>nuevo</h1>']);
  assert.deepEqual(sh.run('sudo rm /var/www/html/nuevo.html; ls /var/www/html'), ['ayuda.html  index.html']);
  const ana = createShell(srv, 'linux', 'ana');
  assert.deepEqual(ana.run('sudo -v'), ['ana is not in the sudoers file.']);
});

test('nano and vim open an edit request; saving writes with the user credentials', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('nano +2 notas.txt'), []);
  const spec = sh.editRequest?.();
  assert.deepEqual(spec, { editor: 'nano', path: '/home/alumno/notas.txt', content: '', exists: false, readOnly: false, line: 2 });
  assert.equal(sh.saveEdit?.('/home/alumno/notas.txt', 'uno\ndos\n'), null);
  assert.equal(sh.saveEdit?.('/etc/passwd', 'x'), 'Permission denied');
  assert.deepEqual(sh.closeEdit?.(), []);
  assert.equal(sh.editRequest?.(), null);
  assert.deepEqual(sh.run('cat notas.txt'), ['uno', 'dos']);
  sh.run('vim /etc/resolv.conf; echo vuelta');
  assert.equal(sh.editRequest?.()?.readOnly, true);
  assert.deepEqual(sh.closeEdit?.(), ['vuelta']);
  assert.deepEqual(sh.run('vi -x'), ['VIM - Vi IMproved 9.1 (2024 Jan 02)', 'Unknown option argument: "-x"', 'More info with: "vim -h"']);
});

test('SSH: remote bash login shell, remote editor, Ctrl+C and logout', () => {
  const { t, srv, pc } = lab();
  t.settle();
  const sh = createShell(pc, 'linux');
  sh.run('ssh admin@10.0.0.2');
  sh.run('yes');
  assert.match(sh.run('cisco').join('\n'), /Welcome to Ubuntu/);
  assert.equal(plain(sh.prompt()), 'admin@server0:~$ ');
  assert.deepEqual(sh.run('shopt -q login_shell && echo login; whoami'), ['login', 'admin']);
  sh.run('nano remoto.txt');
  assert.equal(sh.editRequest?.()?.path, '/home/admin/remoto.txt');
  assert.equal(sh.saveEdit?.('/home/admin/remoto.txt', 'hola\n'), null);
  assert.deepEqual(sh.closeEdit?.(), []);
  assert.equal(hostSystem(srv).fs.readFile('/home/admin/remoto.txt'), 'hola\n');
  sh.run('read -p "nombre: " n');
  assert.equal(sh.prompt(), 'nombre: ');
  assert.deepEqual(sh.interrupt?.(), []);
  assert.equal(plain(sh.prompt()), 'admin@server0:~$ ');
  assert.deepEqual(sh.run('exit 3'), ['logout', 'Connection to 10.0.0.2 closed.']);
  assert.deepEqual(sh.run('echo $?'), ['3']);
});

test('user files are saved in the topology JSON and restored, never over generated files', () => {
  const { t, pc } = lab();
  createShell(pc, 'linux').run('mkdir -p proyectos && echo "datos" > proyectos/a.txt && ln -s proyectos/a.txt enlace');
  const json = JSON.parse(JSON.stringify(t.toJSON())) as { devices: { id: string; pc?: { files?: unknown[] } }[] };
  const rec = json.devices.find((d) => d.id === pc.id)?.pc;
  assert.ok(rec?.files?.some((f) => (f as { path: string }).path === '/home/alumno/proyectos/a.txt'));
  rec?.files?.push({ path: '/etc/resolv.conf', kind: 'file', content: 'malicioso', mode: 0o644, uid: 0, gid: 0 }, { path: '/../x', kind: 'file', content: '', mode: 0, uid: 0, gid: 0 });
  const t2 = Topology.fromJSON(json);
  const pc2 = t2.get(pc.id)?.device as Pc;
  const sh = createShell(pc2, 'linux');
  assert.deepEqual(sh.run('cat enlace; ls -ld proyectos | cut -c1'), ['datos', 'd']);
  assert.match(sh.run('cat /etc/resolv.conf').join('\n'), /^nameserver /m, 'a generated file is never replaced (/etc/hosts is an ordinary file since v0.10.3)');
  assert.equal(validFileRecords([{ path: '/a', kind: 'file', content: 'x'.repeat(300_000), mode: 0, uid: 0, gid: 0 }, 'x', null]).length, 0);
  assert.ok(exportFiles(hostSystem(pc2).fs).length >= 3);
});

test('SSH accounts keep their UID when other accounts are added or removed', () => {
  const { srv } = lab();
  const uidOf = (name: string): number | undefined => hostUsers(srv).find((u) => u.name === name)?.uid;
  const before = uidOf('ana');
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'bea', password: 'b' }, { name: 'ana', password: 'ana1' }] } });
  assert.equal(uidOf('ana'), before);
  assert.equal(uidOf('admin'), 1000);
  assert.notEqual(uidOf('bea'), before);
});
