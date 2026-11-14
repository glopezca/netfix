/**
 * The SMB server of Windows (File and Printer Sharing for Microsoft Networks): with the box unticked nothing listens
 * on 139/445 and there is no NAME<20>; ticked, the shares of the device answer smbclient from GNU/Linux and net view /
 * net use / dir from another Windows, with what Everyone may do (read or full control) and inside the shared folder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { addWinShare, setWinShareOn } from '../../src/net/win-shares.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const sh = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');
const ipOf = (h: Host): string => win(h, 'ipconfig').match(/IPv4 Address[. ]*: ([\d.]+)/)?.[1] ?? '';

/** PC0 and PC1 share a subnet (PC2 is past the routers, out of reach of the NetBIOS broadcast). */
function lab() {
  const t = EXAMPLES.find((e) => e.id === 'internet')!.build();
  const [pc0, pc1] = ['PC0', 'PC1'].map((l) => t.byLabel(l) as Host) as [Host, Host];
  sh(pc1, 'apt install -y smbclient');
  return { pc0, pc1, ip0: ipOf(pc0) };
}

/** PC0 shares its folder docs as «docs» (full control) and as «Leer» (read only). */
function sharing(pc0: Host): void {
  setWinShareOn(pc0, true);
  win(pc0, 'mkdir C:\\Users\\user\\docs');
  win(pc0, 'echo hola> C:\\Users\\user\\docs\\a.txt');
  assert.equal(addWinShare(pc0, { name: 'docs', path: 'C:\\Users\\user\\docs', remark: 'Documentos', access: 'full' }), undefined);
  assert.equal(addWinShare(pc0, { name: 'Leer', path: 'C:\\Users\\user\\docs', remark: '', access: 'read' }), undefined);
}

test('the box unticked: no SMB on 139/445, no NAME<20>, and the clients cannot reach it', () => {
  const { pc0, pc1, ip0 } = lab();
  assert.match(sh(pc1, `nc -z -v -w 1 ${ip0} 445 2>&1`), /refused/);
  assert.match(sh(pc1, `nc -z -v -w 1 ${ip0} 139 2>&1`), /refused/);
  assert.equal(sh(pc1, `smbclient -L //${ip0} -N 2>&1`), `do_connect: Connection to ${ip0} failed (Error NT_STATUS_CONNECTION_REFUSED)`);
  assert.doesNotMatch(win(pc0, 'nbtstat -n'), /<20>/);
  pc1.os = 'windows';
  assert.match(win(pc1, 'nbtstat -a pc0'), /PC0 {12}<00>  UNIQUE/, 'PC0 answers NBSTAT');
  assert.doesNotMatch(win(pc1, 'nbtstat -a pc0'), /<20>/);
  assert.equal(win(pc1, 'net view \\\\pc0'), 'System error 53 has occurred.\n\nThe network path was not found.\n');
});

test('the box ticked: smbclient lists the shares and works in them with what Everyone may do', () => {
  const { pc0, pc1, ip0 } = lab();
  sharing(pc0);
  assert.match(sh(pc1, `nc -z -v -w 1 ${ip0} 445 2>&1`), /succeeded/);
  const list = sh(pc1, `smbclient -L //${ip0} -N 2>&1`);
  assert.match(list, /^\tdocs +Disk +Documentos$/m);
  assert.match(list, /^\tLeer +Disk *$/m);
  assert.match(list, /^\tIPC\$ +IPC +Remote IPC$/m);
  assert.ok(list.indexOf('docs') < list.indexOf('Leer') && list.indexOf('Leer') < list.indexOf('IPC$'), 'the disks by name, then IPC$');
  assert.match(sh(pc1, `smbclient //${ip0}/docs -N -c 'get a.txt /tmp/a.txt' 2>&1; cat /tmp/a.txt`), /hola/);
  sh(pc1, "echo 'desde linux' > /tmp/n.txt");
  sh(pc1, `smbclient //${ip0}/DOCS -N -c 'put /tmp/n.txt n.txt' 2>&1`);
  assert.equal(win(pc0, 'type C:\\Users\\user\\docs\\n.txt'), 'desde linux');
  assert.match(sh(pc1, `smbclient //${ip0}/leer -N -c 'put /tmp/n.txt m.txt' 2>&1`), /NT_STATUS_ACCESS_DENIED/);
  assert.match(sh(pc1, `smbclient //${ip0}/leer -N -c 'ls' 2>&1`), /^ {2}a\.txt +A? *\d+ /m);
  assert.match(sh(pc1, `smbclient //${ip0}/docs -N -c 'get ../Windows/x x' 2>&1`), /NT_STATUS_OBJECT_PATH_SYNTAX_BAD/);
  assert.match(sh(pc1, `smbclient //${ip0}/nada -N -c 'ls' 2>&1`), /tree connect failed: NT_STATUS_BAD_NETWORK_NAME/);
});

test('a share whose folder is gone is not found', () => {
  const { pc0, pc1, ip0 } = lab();
  setWinShareOn(pc0, true);
  win(pc0, 'mkdir C:\\Users\\user\\tmpshare');
  addWinShare(pc0, { name: 'tmp', path: 'C:\\Users\\user\\tmpshare', remark: '', access: 'full' });
  win(pc0, 'rmdir C:\\Users\\user\\tmpshare');
  assert.match(sh(pc1, `smbclient //${ip0}/tmp -N -c 'ls' 2>&1`), /tree connect failed: NT_STATUS_BAD_NETWORK_NAME/);
});

test('another Windows: net view lists the shares, net use maps one and dir reads it', () => {
  const { pc0, pc1 } = lab();
  sharing(pc0);
  pc1.os = 'windows';
  assert.match(win(pc1, 'net view \\\\pc0'), /^Shared resources at \\\\pc0\n\n\n\nShare name {2}Type {2}Used as {2}Comment\n\n-{79}\ndocs {8}Disk {11}Documentos\nLeer {8}Disk\nThe command completed successfully\.\n$/);
  assert.equal(win(pc1, 'net use Z: \\\\pc0\\docs'), 'The command completed successfully.\n');
  assert.match(win(pc1, 'dir Z:\\'), /a\.txt/);
  assert.match(win(pc1, 'dir \\\\pc0\\leer'), / Directory of \\\\pc0\\leer\n[\s\S]*a\.txt/);
  assert.equal(win(pc1, 'type Z:\\a.txt'), 'hola');
});

test('NAME<20> follows the box: nbtstat -n, nbtstat -a and nmblookup -S', () => {
  const { pc0, pc1 } = lab();
  setWinShareOn(pc0, true);
  assert.match(win(pc0, 'nbtstat -n'), /PC0 {12}<20>  UNIQUE {6}Registered/);
  assert.match(sh(pc1, 'apt install -y samba-common-bin >/dev/null 2>&1; nmblookup -S pc0 2>&1'), /^\tPC0 +<20> - +[A-Z<> ]*$/m);
  pc1.os = 'windows';
  assert.match(win(pc1, 'nbtstat -a pc0'), /PC0 {12}<20>  UNIQUE {6}Registered/);
  setWinShareOn(pc0, false);
  assert.doesNotMatch(win(pc0, 'nbtstat -n'), /<20>/);
  assert.doesNotMatch(win(pc1, 'nbtstat -a pc0'), /<20>/);
});
