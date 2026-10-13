/** OpenSSH workflow between a PC and a Server: known_hosts, ssh-keygen, ssh-copy-id, key login and sshd_config. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const all = (lines: string[]): string => lines.join('\n');

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  t.settle();
  return { t, srv, pc };
}

/** Generates ~/.ssh/id_ed25519, installs it with ssh-copy-id and then sets its passphrase. */
function installKey(sh: ShellSession, pass = ''): void {
  sh.run(`ssh-keygen -q -t ed25519 -f ~/.ssh/id_ed25519 -N ''`);
  sh.run('ssh-copy-id admin@10.0.0.2');
  sh.run('yes');
  sh.run('cisco');
  if (pass) sh.run(`ssh-keygen -p -f ~/.ssh/id_ed25519 -N '${pass}'`);
}

test('first connection asks for the host key and saves it in ~/.ssh/known_hosts', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  sh.run('ssh admin@10.0.0.2');
  assert.match(sh.prompt(), /continue connecting \(yes\/no\/\[fingerprint\]\)/);
  assert.deepEqual(sh.run('quizás'), ["Please type 'yes', 'no' or the fingerprint: "]);
  sh.run('yes');
  sh.run('cisco');
  sh.run('exit');
  const kh = hostSystem(pc).fs.readFile('/home/alumno/.ssh/known_hosts');
  assert.match(kh, /^10\.0\.0\.2 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI\S+\n$/);
  assert.equal(hostSystem(pc).fs.stat('/home/alumno/.ssh').mode & 0o777, 0o700);
  // The server's fingerprint matches its key file.
  const srvSh = createShell(srv, 'linux');
  const fp = all(srvSh.run('ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub'));
  assert.match(fp, /^256 SHA256:\S+ root@\S+ \(ED25519\)$/);
  // The second connection goes straight to the password; -F finds it.
  sh.run('ssh admin@10.0.0.2');
  assert.equal(sh.prompt(), "admin@10.0.0.2's password: ");
  sh.run('cisco');
  sh.run('exit');
  assert.match(all(sh.run('ssh-keygen -F 10.0.0.2')), /^# Host 10\.0\.0\.2 found: line 1 \n10\.0\.0\.2 ssh-ed25519 /);
  assert.deepEqual(sh.run('ssh -o StrictHostKeyChecking=yes admin@10.0.0.9; echo $?').slice(-1), ['255']);
});

test('ssh-keygen: interactive generation, fingerprint, -y, -p and permissions', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('ssh-keygen'), ['Generating public/private ed25519 key pair.']);
  assert.equal(sh.prompt(), 'Enter file in which to save the key (/home/alumno/.ssh/id_ed25519): ');
  assert.deepEqual(sh.run(''), ["Created directory '/home/alumno/.ssh'."]);
  assert.equal(sh.prompt(), 'Enter passphrase for "/home/alumno/.ssh/id_ed25519" (empty for no passphrase): ');
  assert.equal(sh.secret(), true);
  sh.run('uno');
  assert.deepEqual(sh.run('dos'), ['Passphrases do not match.  Try again.']);
  sh.run('');
  const out = sh.run('');
  assert.equal(out[0], 'Your identification has been saved in /home/alumno/.ssh/id_ed25519');
  assert.match(out[3] ?? '', /^SHA256:[A-Za-z0-9+/]{43} alumno@pc\d+$/);
  assert.equal(out[5], '+--[ED25519 256]--+');
  assert.equal(out[15], '+----[SHA256]-----+');
  const fs = hostSystem(pc).fs;
  assert.equal(fs.stat('/home/alumno/.ssh/id_ed25519').mode & 0o777, 0o600);
  assert.equal(fs.stat('/home/alumno/.ssh/id_ed25519.pub').mode & 0o777, 0o644);
  assert.match(fs.readFile('/home/alumno/.ssh/id_ed25519'), /^-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE/);
  assert.equal(all(sh.run('ssh-keygen -y -f ~/.ssh/id_ed25519')), fs.readFile('/home/alumno/.ssh/id_ed25519.pub').trim());
  assert.match(all(sh.run('ssh-keygen -l -f ~/.ssh/id_ed25519')), /^256 SHA256:\S+ alumno@pc\d+ \(ED25519\)$/);
  // Overwrite asks; "n" keeps the key.
  sh.run('ssh-keygen -f ~/.ssh/id_ed25519');
  assert.equal(sh.prompt(), 'Overwrite (y/n)? ');
  sh.run('n');
  assert.deepEqual(sh.run('echo $?'), ['1']);
  // -p adds a passphrase; -y then asks for it.
  sh.run('ssh-keygen -p -f ~/.ssh/id_ed25519 -N secreta');
  sh.run('ssh-keygen -y -f ~/.ssh/id_ed25519');
  assert.equal(sh.prompt(), 'Enter passphrase: ');
  assert.match(all(sh.run('mala')), /incorrect passphrase supplied/);
  assert.match(all(sh.run('ssh-keygen -t rsa -b 4096 -q -N "" -f rsa_key -C prueba; ssh-keygen -lf rsa_key.pub')), /^4096 SHA256:\S+ prueba \(RSA\)$/);
  assert.match(all(sh.run('ssh-keygen -t dsa')), /unknown key type dsa/);
});

test('ssh-copy-id installs the key and ssh then logs in without a password', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  assert.match(all(sh.run('ssh-copy-id admin@10.0.0.2')), /ERROR: No identities found/);
  sh.run(`ssh-keygen -q -f ~/.ssh/id_ed25519 -N ''`);
  const info = all(sh.run('ssh-copy-id admin@10.0.0.2'));
  assert.match(info, /INFO: Source of key\(s\) to be installed: "\/home\/alumno\/\.ssh\/id_ed25519\.pub"/);
  assert.match(info, /The authenticity of host/);
  sh.run('yes');
  assert.equal(sh.prompt(), "admin@10.0.0.2's password: ");
  assert.match(all(sh.run('cisco')), /Number of key\(s\) added: 1/);
  const fs = hostSystem(srv).fs;
  assert.equal(fs.readFile('/home/admin/.ssh/authorized_keys'), hostSystem(pc).fs.readFile('/home/alumno/.ssh/id_ed25519.pub'));
  assert.equal(fs.stat('/home/admin/.ssh').mode & 0o777, 0o700);
  assert.equal(fs.stat('/home/admin/.ssh/authorized_keys').mode & 0o777, 0o600);
  // Key login: no password prompt.
  assert.match(all(sh.run('ssh admin@10.0.0.2')), /Welcome to Ubuntu/);
  assert.equal(plain(sh.prompt()), 'admin@server0:~$ ');
  sh.run('exit');
  assert.match(all(createShell(srv, 'linux').run('journalctl -u ssh')), /Accepted publickey for admin from 10\.0\.0\.10 port \d+ ssh2: ED25519 SHA256:/);
  // Remote command with the key; a second ssh-copy-id does not duplicate it.
  assert.deepEqual(sh.run('ssh admin@10.0.0.2 whoami; echo "st=$?"'), ['admin', 'st=0']);
  assert.match(all(sh.run('ssh-copy-id admin@10.0.0.2')), /All keys were skipped because they already exist/);
  assert.equal(fs.readFile('/home/admin/.ssh/authorized_keys').split('\n').filter(Boolean).length, 1);
});

test('passphrase-protected keys, unprotected private keys and StrictModes', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  installKey(sh, 'clave');
  sh.run('ssh admin@10.0.0.2');
  assert.equal(sh.prompt(), "Enter passphrase for key '/home/alumno/.ssh/id_ed25519': ");
  sh.run('mala');
  assert.equal(sh.prompt(), "Enter passphrase for key '/home/alumno/.ssh/id_ed25519': ");
  assert.match(all(sh.run('clave')), /Welcome to Ubuntu/);
  sh.run('exit');
  // A private key readable by others is ignored: ssh falls back to the password.
  sh.run('chmod 644 ~/.ssh/id_ed25519');
  const warn = all(sh.run('ssh admin@10.0.0.2'));
  assert.match(warn, /WARNING: UNPROTECTED PRIVATE KEY FILE![\s\S]*Permissions 0644 for '\/home\/alumno\/\.ssh\/id_ed25519' are too open\.[\s\S]*bad permissions/);
  assert.equal(sh.prompt(), "admin@10.0.0.2's password: ");
  sh.run('cisco');
  // StrictModes: a group-writable home on the server refuses the key.
  sh.run('chmod 775 ~ ; exit');
  sh.run('chmod 600 ~/.ssh/id_ed25519');
  sh.run('ssh admin@10.0.0.2');
  sh.run('clave');
  assert.equal(sh.prompt(), "admin@10.0.0.2's password: ");
  sh.run('cisco');
  sh.run('exit');
  assert.match(all(createShell(srv, 'linux').run('journalctl -u ssh')), /Authentication refused: bad ownership or modes for directory \/home\/admin/);
});

test('sshd_config: PasswordAuthentication no, reload and host key change', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  const root = createShell(srv, 'linux', 'root');
  sh.run('ssh admin@10.0.0.2');
  sh.run('yes');
  sh.run('cisco');
  sh.run('exit');
  root.run("echo 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/50-nopass.conf");
  assert.deepEqual(root.run('systemctl reload ssh; echo $?'), ['0']);
  assert.deepEqual(sh.run('ssh admin@10.0.0.2'), ['admin@10.0.0.2: Permission denied (publickey).']);
  // A broken configuration makes reload fail and keeps the running settings.
  root.run("echo 'Nonsense yes' >> /etc/ssh/sshd_config.d/50-nopass.conf");
  assert.match(all(root.run('systemctl reload ssh')), /Job for ssh\.service failed/);
  assert.match(all(root.run('journalctl -u ssh')), /Bad configuration option: Nonsense/);
  root.run('rm /etc/ssh/sshd_config.d/50-nopass.conf; systemctl reload ssh');
  // New host key: the client refuses to connect.
  root.run('rm /etc/ssh/ssh_host_ed25519_key*; ssh-keygen -q -t ed25519 -N "" -f /etc/ssh/ssh_host_ed25519_key; systemctl restart ssh');
  const changed = all(sh.run('ssh admin@10.0.0.2'));
  assert.match(changed, /REMOTE HOST IDENTIFICATION HAS CHANGED![\s\S]*Offending ED25519 key in \/home\/alumno\/\.ssh\/known_hosts:1[\s\S]*ssh-keygen -f '\/home\/alumno\/\.ssh\/known_hosts' -R '10\.0\.0\.2'[\s\S]*Host key verification failed\./);
  assert.match(all(sh.run("ssh-keygen -f '/home/alumno/.ssh/known_hosts' -R '10.0.0.2'")), /# Host 10\.0\.0\.2 found: line 1\n\/home\/alumno\/\.ssh\/known_hosts updated\.\nOriginal contents retained as \/home\/alumno\/\.ssh\/known_hosts\.old/);
  sh.run('ssh admin@10.0.0.2');
  assert.match(sh.prompt(), /continue connecting/);
});

test('ssh options: -i, -p, BatchMode, accept-new and Windows clients', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.match(all(sh.run('ssh -i ~/.ssh/nohay -o StrictHostKeyChecking=accept-new -o BatchMode=yes admin@10.0.0.2; echo $?')),
    /Warning: Identity file \/home\/alumno\/\.ssh\/nohay not accessible: No such file or directory\.\nWarning: Permanently added '10\.0\.0\.2' \(ED25519\) to the list of known hosts\.\nadmin@10\.0\.0\.2: Permission denied \(publickey,password\)\.\n255/);
  assert.deepEqual(sh.run('ssh -p 2222 admin@10.0.0.2'), ['ssh: connect to host 10.0.0.2 port 2222: Connection refused']);
  const win = createShell(pc, 'windows');
  win.run('ssh admin@10.0.0.2');
  assert.match(win.prompt(), /continue connecting/);
  win.run('yes');
  win.run('cisco');
  win.run('exit');
  win.run('ssh admin@10.0.0.2');
  assert.equal(win.prompt(), "admin@10.0.0.2's password: ");
});

test('review fixes: relative -i from the working directory, remote words are not ssh options, MaxAuthTries', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  sh.run('mkdir lab; cd lab; ssh-keygen -q -f k -N ""');
  sh.run('ssh-copy-id -i k -o StrictHostKeyChecking=accept-new admin@10.0.0.2');
  sh.run('cisco');
  assert.deepEqual(sh.run('ssh -i k admin@10.0.0.2 whoami'), ['admin']);
  assert.deepEqual(sh.run('ssh -i nohay -o BatchMode=yes admin@10.0.0.2 true').slice(0, 1), ['Warning: Identity file nohay not accessible: No such file or directory.']);
  assert.match(all(sh.run('ssh -i k admin@10.0.0.2 ls -a -h')), /\.ssh/, '-h belongs to ls');
  // MaxAuthTries 2: the server disconnects after the second failure.
  createShell(srv, 'linux', 'root').run("echo 'MaxAuthTries 2' > /etc/ssh/sshd_config.d/10-tries.conf; systemctl reload ssh");
  sh.run('cd; ssh admin@10.0.0.2');
  sh.run('mal');
  assert.deepEqual(sh.run('peor'), ['Received disconnect from 10.0.0.2 port 22:2: Too many authentication failures', 'Disconnected from 10.0.0.2 port 22']);
  assert.match(all(createShell(srv, 'linux', 'root').run('journalctl -u ssh')), /error: maximum authentication attempts exceeded for admin from 10\.0\.0\.10 port \d+ ssh2 \[preauth\]/);
});

test('review fixes: StrictHostKeyChecking=no with a changed key disables passwords; ssh-keygen -A and -q overwrite', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  const root = createShell(srv, 'linux', 'root');
  sh.run('ssh -o StrictHostKeyChecking=accept-new admin@10.0.0.2 true');
  sh.run('cisco');
  assert.deepEqual(root.run('rm /etc/ssh/ssh_host_*; ssh-keygen -A'), ['ssh-keygen: generating new host keys: RSA ECDSA ED25519 ']);
  assert.match(all(root.run('ls -l --color=never /etc/ssh/ssh_host_ed25519_key')), /^-rw------- 1 root root/);
  root.run('systemctl restart ssh');
  const out = all(sh.run('ssh -o StrictHostKeyChecking=no admin@10.0.0.2'));
  assert.match(out, /REMOTE HOST IDENTIFICATION HAS CHANGED![\s\S]*Password authentication is disabled to avoid man-in-the-middle attacks\.\nKeyboard-interactive authentication is disabled to avoid man-in-the-middle attacks\.\nadmin@10\.0\.0\.2: Permission denied \(publickey,password\)\.$/);
  sh.run('ssh-keygen -q -f clave -N ""');
  sh.run('ssh-keygen -q -f clave -N ""');
  assert.equal(sh.prompt(), 'Overwrite (y/n)? ');
  sh.run('n');
});

test('review fixes: ssh-copy-id keeps an authorized_keys without final newline intact and dedupes by key', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  const root = createShell(srv, 'linux', 'root');
  root.run("mkdir -p /home/admin/.ssh && printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBB vieja' > /home/admin/.ssh/authorized_keys && chown -R admin:admin /home/admin/.ssh && chmod 700 /home/admin/.ssh && chmod 600 /home/admin/.ssh/authorized_keys");
  sh.run('ssh-keygen -q -f ~/.ssh/id_ed25519 -N "" -C uno');
  sh.run('ssh-copy-id -o StrictHostKeyChecking=accept-new admin@10.0.0.2');
  sh.run('cisco');
  const lines = hostSystem(srv).fs.readFile('/home/admin/.ssh/authorized_keys').split('\n');
  assert.equal(lines[0], 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBB vieja');
  assert.match(lines[1] ?? '', /^ssh-ed25519 \S+ uno$/);
  // Same key, another comment: still "already installed".
  sh.run("sed -i 's/ uno$/ dos/' ~/.ssh/id_ed25519.pub");
  assert.match(all(sh.run('ssh-copy-id admin@10.0.0.2')), /All keys were skipped/);
});

test('authorized_keys from= and PermitRootLogin are enforced end to end', () => {
  const { pc, srv } = lab();
  const sh = createShell(pc, 'linux');
  sh.run('ssh-keygen -q -f ~/.ssh/id_ed25519 -N ""');
  sh.run('ssh-copy-id -o StrictHostKeyChecking=accept-new admin@10.0.0.2');
  sh.run('cisco');
  const root = createShell(srv, 'linux', 'root');
  root.run(`sed -i 's/^/from="10.0.0.99" /' /home/admin/.ssh/authorized_keys`);
  sh.run('ssh admin@10.0.0.2');
  assert.equal(sh.prompt(), "admin@10.0.0.2's password: ", 'the key is refused from 10.0.0.10');
  sh.run('cisco');
  sh.run('exit');
  assert.match(all(root.run('journalctl -u ssh')), /with correct key but not from a permitted host \(host=10\.0\.0\.10/);
  srv.setServices({ ...srv.services, ssh: { ...srv.services.ssh, users: [...srv.services.ssh.users, { name: 'root', password: 'toor' }] } });
  sh.run('ssh root@10.0.0.2');
  assert.deepEqual(sh.run('toor'), ['Permission denied, please try again.']);
  assert.match(all(root.run('journalctl -u ssh')), /ROOT LOGIN REFUSED FROM 10\.0\.0\.10 port \d+/);
});

test('touch and redirections honour the umask, for users and for root', () => {
  const { srv } = lab();
  const root = createShell(srv, 'linux', 'root');
  assert.match(all(root.run('umask 077; touch /root/t; ls -l --color=never /root/t')), /^-rw------- /);
  const admin = createShell(srv, 'linux', 'admin');
  assert.match(all(admin.run('cd; touch a; umask 027; touch b; ls -l --color=never a b')), /^-rw-rw-r-- .* a\n-rw-r----- .* b$/);
});

test('DenyUsers also applies to SSH accounts that are not valid Linux user names', () => {
  const { pc, srv } = lab();
  srv.setServices({ ...srv.services, ssh: { ...srv.services.ssh, users: [...srv.services.ssh.users, { name: 'Bob', password: 'b0b' }] } });
  createShell(srv, 'linux', 'root').run("echo 'DenyUsers Bob' > /etc/ssh/sshd_config.d/10-deny.conf; systemctl reload ssh");
  const sh = createShell(pc, 'linux');
  sh.run('ssh -o StrictHostKeyChecking=accept-new Bob@10.0.0.2');
  assert.deepEqual(sh.run('b0b'), ['Permission denied, please try again.']);
  assert.match(all(createShell(srv, 'linux', 'root').run('journalctl -u ssh')), /User Bob from 10\.0\.0\.10 not allowed because listed in DenyUsers/);
});
