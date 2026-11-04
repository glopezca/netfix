/**
 * Samba as a file server on a GNU/Linux server (the «samba» lab): smb.conf shares with guest, read-only and valid-users
 * access; smbpasswd/pdbedit keep the Samba accounts apart from the Linux ones; testparm checks the file; smbclient (Linux)
 * and net view / net use with dir, copy and type (Windows) reach the shares with the permissions of the Linux account
 * smbd works as (nobody for a guest).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { configSources } from '../../src/services/config-files.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string, user = 'root'): string => plain(createShell(h, 'linux', user).run(cmd).join('\n'));
const SRV = '172.20.0.10';

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'samba')!.build();
  return { t, srv: t.byLabel('SRV') as Host, pc0: t.byLabel('PC0') as Host, pc1: t.byLabel('PC1') as Host };
}

test('the Samba lab: SRV runs smbd and nmbd with the shares publico and profes; testparm checks smb.conf', () => {
  const { srv } = lab();
  assert.equal(run(srv, 'systemctl is-active smbd nmbd'), 'active');
  const check = run(srv, 'testparm -s 2>&1');
  assert.match(check, /^Load smb config files from \/etc\/samba\/smb\.conf\nLoaded services file OK\.\nWeak crypto is allowed by GnuTLS[^\n]*\n\nServer role: ROLE_STANDALONE\n\n# Global parameters\n\[global\]\n\tworkgroup = WORKGROUP/);
  assert.match(check, /\[publico\]\n\tcomment = Carpeta pública\n\tguest ok = Yes\n\tpath = \/srv\/samba\/publico\n\tread only = No/);
  assert.match(check, /\[profes\][\s\S]*\tvalid users = ana/);
  run(srv, 'echo "   colour = blue" >> /etc/samba/smb.conf');
  assert.match(run(srv, 'testparm -s 2>&1'), /Unknown parameter encountered: "colour"\nIgnoring unknown parameter "colour"/);
});

test('smbpasswd and pdbedit: Samba accounts for Linux users, managed by root, in a file only root reads', () => {
  const { srv } = lab();
  const ana = run(srv, 'id -u ana');
  assert.equal(run(srv, 'pdbedit -L'), `ana:${ana}:`);
  assert.match(run(srv, 'smbpasswd -a admin 2>&1; echo "status $?"', 'admin'), /When run by root:[\s\S]*status 1$/);
  assert.equal(run(srv, "printf 'clave1\\nclave1\\n' | smbpasswd -s -a admin"), 'Added user admin.');
  assert.equal(run(srv, "printf 'x\\nx\\n' | smbpasswd -s -a pepe 2>&1; echo \"status $?\""), 'Failed to add entry for user pepe.\nstatus 1');
  assert.equal(run(srv, "printf 'a\\nb\\n' | smbpasswd -s ana 2>&1"), 'Mismatch - password unchanged.\nUnable to get new password.');
  assert.equal(run(srv, 'pdbedit -L | sort'), [`admin:${run(srv, 'id -u admin')}:`, `ana:${ana}:`].sort().join('\n'));
  assert.equal(run(srv, 'smbpasswd -d admin'), 'Disabled user admin.');
  assert.equal(run(srv, 'smbpasswd -e admin'), 'Enabled user admin.');
  assert.equal(run(srv, 'smbpasswd -x admin'), 'Deleted user admin.');
  assert.match(run(srv, 'ls -l /var/lib/samba/private/passdb.tdb'), /^-rw------- 1 root root /);
  assert.match(run(srv, 'cat /var/lib/samba/private/passdb.tdb 2>&1', 'admin'), /Permission denied/);
});

test('smbclient from PC1: installed with apt; lists the shares and copies to and from the guest share', () => {
  const { srv, pc1 } = lab();
  assert.match(run(pc1, `smbclient -L //${SRV} -N 2>&1; echo "status $?"`), /Command 'smbclient' not found, but can be installed with:\nsudo apt install smbclient\nstatus 127$/);
  run(pc1, 'apt install -y smbclient');
  const list = run(pc1, `smbclient -L //${SRV} -N`);
  assert.match(list, /\tSharename       Type      Comment\n\t---------       ----      -------\n\tprint\$          Disk      Printer Drivers\n\tpublico         Disk      Carpeta pública\n\tprofes          Disk      Solo profesorado\n\tIPC\$            IPC       IPC Service \(srv server \(Samba, Ubuntu\)\)\nSMB1 disabled -- no workgroup available$/);
  run(pc1, 'echo hola > /tmp/nota.txt');
  const put = run(pc1, `smbclient //${SRV}/publico -N -c 'put /tmp/nota.txt nota.txt; ls'`);
  assert.match(put, /putting file \/tmp\/nota\.txt as \\nota\.txt \(/);
  assert.match(put, /^ {2}nota\.txt +A +5 {2}\w{3} \w{3} /m);
  assert.equal(run(srv, 'cat /srv/samba/publico/nota.txt'), 'hola');
  assert.match(run(srv, 'ls -l /srv/samba/publico/nota.txt'), / nobody /, 'a guest writes as nobody');
  assert.match(run(pc1, `cd /tmp && smbclient //${SRV}/publico -N -c 'get nota.txt copia.txt'`), /getting file \\nota\.txt of size 5 as copia\.txt/);
  assert.equal(run(pc1, 'cat /tmp/copia.txt'), 'hola');
  assert.match(run(pc1, `smbclient //${SRV}/nada -N -c ls 2>&1; echo "status $?"`), /tree connect failed: NT_STATUS_BAD_NETWORK_NAME\nstatus 1$/);
});

test('valid users: a guest is refused, a wrong password fails the login, ana works as ana', () => {
  const { srv, pc1 } = lab();
  run(pc1, 'apt install -y smbclient');
  assert.match(run(pc1, `smbclient //${SRV}/profes -N -c ls 2>&1`), /tree connect failed: NT_STATUS_ACCESS_DENIED/);
  assert.match(run(pc1, `smbclient //${SRV}/profes -U ana%mal -c ls 2>&1; echo "status $?"`), /session setup failed: NT_STATUS_LOGON_FAILURE\nstatus 1$/);
  assert.match(run(pc1, `smbclient //${SRV}/profes -U ana%ana1 -c 'mkdir notas; ls'`), /^ {2}notas +D +0 /m);
  assert.match(run(srv, 'ls -ld /srv/samba/profes/notas'), / ana ana /);
  assert.match(run(pc1, `smbclient //${SRV}/publico -U pepe%x -c ls`), /^ {2}\. +D /m, 'an unknown user is the guest (map to guest = bad user)');
});

test('read only shares and the share root: no writes, no way out by .. or by a link', () => {
  const { srv, pc1 } = lab();
  run(pc1, 'apt install -y smbclient; echo x > /tmp/x.txt');
  run(srv, "printf '\\n[lectura]\\n   path = /srv/samba/publico\\n   guest ok = yes\\n' >> /etc/samba/smb.conf; ln -s /etc /srv/samba/publico/etc");
  assert.match(run(pc1, `smbclient //${SRV}/lectura -N -c 'put /tmp/x.txt x.txt' 2>&1`), /NT_STATUS_ACCESS_DENIED opening remote file \\x\.txt/);
  assert.match(run(pc1, `smbclient //${SRV}/publico -N -c 'get ../../../etc/passwd /tmp/p' 2>&1`), /NT_STATUS_OBJECT_PATH_SYNTAX_BAD opening remote file \\\.\.\\\.\.\\\.\.\\etc\\passwd/);
  assert.match(run(pc1, `smbclient //${SRV}/publico -N -c 'get etc/passwd /tmp/p' 2>&1`), /NT_STATUS_ACCESS_DENIED opening remote file \\etc\\passwd/);
  assert.match(run(pc1, 'cat /tmp/p 2>&1'), /No such file or directory/);
});

test('Windows: net view lists the visible shares, net use maps a drive, and dir, copy, type and del work on it', () => {
  const { srv, pc0 } = lab();
  const win = (cmd: string): string => createShell(pc0, 'windows').run(cmd).join('\n');
  assert.match(win('net view \\\\srv'), /^Shared resources at \\\\srv\n\nsrv server \(Samba, Ubuntu\)\n\nShare name {2}Type {2}Used as {2}Comment\n\n-{79}\nprofes {6}Disk {11}Solo profesorado\npublico {5}Disk {11}Carpeta pública\nThe command completed successfully\.\n$/);
  assert.equal(win('net use'), 'New connections will be remembered.\n\nThere are no entries in the list.\n');
  assert.equal(win('net use Z: \\\\srv\\publico'), 'The command completed successfully.\n');
  assert.match(win('net use'), /^New connections will be remembered\.\n\n\nStatus {7}Local {5}Remote {20}Network\n\n-{79}\nOK {11}Z: {8}\\\\srv\\publico {13}Microsoft Windows Network\nThe command completed successfully\.\n$/);
  assert.equal(win('net use Z: \\\\srv\\profes'), 'System error 85 has occurred.\n\nThe local device name is already in use.\n');
  win('echo hola desde windows> w.txt');
  assert.match(win('copy w.txt Z:\\'), /1 file\(s\) copied\./);
  assert.equal(run(srv, 'cat /srv/samba/publico/w.txt'), 'hola desde windows');
  assert.equal(win('type Z:\\w.txt'), 'hola desde windows');
  assert.match(win('dir Z:\\'), /Volume in drive Z is publico[\s\S]* Directory of Z:\\\n\n[\s\S]*w\.txt\n[\s\S]*1 File\(s\)/);
  assert.match(win('dir \\\\srv\\publico'), / Directory of \\\\srv\\publico\n[\s\S]*w\.txt/);
  assert.equal(win('copy Z:\\w.txt vuelta.txt'), '        1 file(s) copied.');
  assert.equal(win('type vuelta.txt'), 'hola desde windows');
  // Onto itself (the same share by another name too): refused, and the file stays.
  const onto = 'The file cannot be copied onto itself.\n        0 file(s) moved.';
  assert.equal(win('move Z:\\w.txt Z:\\'), onto);
  assert.equal(win('move Z:\\w.txt \\\\SRV\\PUBLICO\\w.txt'), onto);
  assert.equal(win('copy Z:\\w.txt Z:\\'), 'The file cannot be copied onto itself.\n        0 file(s) copied.');
  assert.equal(run(srv, 'cat /srv/samba/publico/w.txt'), 'hola desde windows');
  assert.equal(win('del Z:\\w.txt'), '');
  assert.match(run(srv, 'ls /srv/samba/publico'), /^$/);
  assert.equal(win('net use Z: /delete'), 'Z: was deleted successfully.\n');
  assert.match(win('dir Z:\\'), /The system cannot find the drive specified\./);
  assert.equal(win('net use Z: /delete'), 'The network connection could not be found.\n\nMore help is available by typing NET HELPMSG 2250.\n');
});

test('Windows: net use with credentials, and the errors of a wrong name, share, password or right', () => {
  const { pc0 } = lab();
  const win = (cmd: string): string => createShell(pc0, 'windows').run(cmd).join('\n');
  assert.equal(win('net use Y: \\\\srv\\profes'), 'System error 5 has occurred.\n\nAccess is denied.\n');
  assert.equal(win('net use Y: \\\\srv\\profes mal /user:ana'), 'System error 1326 has occurred.\n\nThe user name or password is incorrect.\n');
  assert.equal(win('net use Y: \\\\srv\\nada'), 'System error 67 has occurred.\n\nThe network name cannot be found.\n');
  assert.equal(win('net use Y: \\\\noexiste\\x'), 'System error 53 has occurred.\n\nThe network path was not found.\n');
  assert.equal(win('net use Y: \\\\srv\\profes ana1 /user:ana'), 'The command completed successfully.\n');
  assert.equal(win('md Y:\\curso'), '');
  assert.match(win('dir Y:\\'), /<DIR> {10}curso/);
  assert.match(win('net view \\\\srv'), /\nprofes {6}Disk  Y: {7}Solo profesorado\n/);
  const sh = createShell(pc0, 'windows');
  assert.deepEqual(sh.run('net use * \\\\srv\\profes /user:ana'), []);
  assert.equal(sh.prompt(), "Enter the password for 'ana' to connect to 'srv': ");
  assert.ok(sh.secret());
  assert.equal(sh.run('ana1').join('\n'), '\nDrive Z: is now connected to \\\\srv\\profes.\n\nThe command completed successfully.\n');
  assert.ok(!sh.secret());
  assert.equal(win('type \\\\srv\\publico\\nada.txt'), 'The system cannot find the file specified.');
  assert.equal(win('rd Y:\\curso'), '');
});

test('the Samba lab keeps its shares across a saved file, and the Files view lists smb.conf', () => {
  const { srv, pc1 } = lab();
  assert.ok(configSources(srv).some((s) => s.id === 'samba'));
  run(pc1, 'apt install -y samba nftables');
  assert.deepEqual(configSources(pc1).map((s) => s.id), ['sysctl', 'firewall', 'samba']);
  run(pc1, 'apt remove -y samba nftables');
  assert.deepEqual(configSources(pc1).map((s) => s.id), ['sysctl']);
});
