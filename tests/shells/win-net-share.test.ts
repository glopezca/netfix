/**
 * net share on Windows: the shares of the device (what its Servicios → SMB panel shows), listed, published with what
 * Everyone may do and a remark, shown one by one and deleted, with the wording of net.exe; nothing while File and
 * Printer Sharing is off (the Server service not bound).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { setWinShareOn, winShares } from '../../src/net/win-shares.ts';
import { publishWinShare, unpublishWinShare } from '../../src/services/smb-windows.ts';
import { hostPanels } from '../../src/net/pkg-units.ts';
import type { Host } from '../../src/devices/host.ts';

const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');

function pc(): Host {
  const h = EXAMPLES.find((e) => e.id === 'basico')!.build().byLabel('PC0') as Host;
  setWinShareOn(h, true);
  win(h, 'mkdir C:\\home\\alumno\\docs');
  return h;
}

const LIST_HEAD = '\nShare name   Resource                        Remark\n\n' + '-'.repeat(79) + '\n';

test('the box unticked: the Server service is not started', () => {
  const h = pc();
  setWinShareOn(h, false);
  assert.equal(win(h, 'net share'), 'The Server service is not started.\n\nMore help is available by typing NET HELPMSG 2114.\n');
});

test('net share lists IPC$ and the shares, publishes one and shows it', () => {
  const h = pc();
  assert.equal(win(h, 'net share'), `${LIST_HEAD}IPC$                                         Remote IPC\nThe command completed successfully.\n`);
  assert.equal(win(h, 'net share docs=C:\\home\\alumno\\docs /grant:everyone,FULL /remark:"Mis documentos"'), 'docs was shared successfully.\n');
  assert.deepEqual(winShares(h), [{ name: 'docs', path: 'C:\\home\\alumno\\docs', remark: 'Mis documentos', access: 'full' }]);
  assert.equal(win(h, 'net share'), `${LIST_HEAD}IPC$                                         Remote IPC\ndocs         C:\\home\\alumno\\docs             Mis documentos\nThe command completed successfully.\n`);
  assert.equal(win(h, 'net share DOCS'), [
    'Share name        docs', 'Path              C:\\home\\alumno\\docs', 'Remark            Mis documentos', 'Maximum users     No limit',
    'Users', 'Caching           Manual caching of documents', 'Permission        Everyone, FULL', '', 'The command completed successfully.', '',
  ].join('\n'));
});

test('without /grant Everyone may read; a long name goes on a line of its own', () => {
  const h = pc();
  assert.equal(win(h, 'net share documentacion=C:\\home\\alumno\\docs'), 'documentacion was shared successfully.\n');
  assert.equal(winShares(h)[0]?.access, 'read');
  assert.match(win(h, 'net share'), /\ndocumentacion\n {13}C:\\home\\alumno\\docs\n/);
});

test('what net share refuses, in the words of net.exe', () => {
  const h = pc();
  win(h, 'echo x> C:\\home\\alumno\\f.txt');
  const help = (text: string, code: number): string => `${text}\n\nMore help is available by typing NET HELPMSG ${code}.\n`;
  const sys = (code: number, text: string): string => `System error ${code} has occurred.\n\n${text}\n`;
  win(h, 'net share docs=C:\\home\\alumno\\docs');
  assert.equal(win(h, 'net share Docs=C:\\home\\alumno\\docs'), help('The name has already been shared.', 2118));
  assert.equal(win(h, 'net share ipc$=C:\\home\\alumno\\docs'), help('The name has already been shared.', 2118));
  assert.equal(win(h, 'net share nada=C:\\home\\alumno\\nada'), help('The device or directory does not exist.', 2116));
  assert.equal(win(h, 'net share f=C:\\home\\alumno\\f.txt'), help('The device or directory does not exist.', 2116));
  assert.equal(win(h, 'net share d=D:\\datos'), help('The device or directory does not exist.', 2116));
  assert.equal(win(h, 'net share a*b=C:\\home\\alumno\\docs'), sys(123, 'The filename, directory name, or volume label syntax is incorrect.'));
  assert.equal(win(h, 'net share x=C:\\home\\alumno\\docs /grant:pepe,full'), sys(1332, 'No mapping between account names and security IDs was done.'));
  assert.equal(win(h, 'net share nada'), help('This shared resource does not exist.', 2310));
  assert.match(win(h, 'net share x=C:\\home\\alumno\\docs /grant:everyone,LEER'), /^The syntax of this command is:\n\nNET SHARE\n/);
  assert.match(win(h, 'net share /?'), /^The syntax of this command is:/);
  assert.equal(winShares(h).length, 1);
});

test('net share NAME /delete stops sharing (the folder stays); so does the folder with /delete', () => {
  const h = pc();
  win(h, 'net share docs=C:\\home\\alumno\\docs');
  assert.equal(win(h, 'net share docs /delete'), 'docs was deleted successfully.\n');
  assert.equal(win(h, 'net share docs /delete'), 'This shared resource does not exist.\n\nMore help is available by typing NET HELPMSG 2310.\n');
  assert.match(win(h, 'dir C:\\home\\alumno'), /docs/);
  win(h, 'net share a=C:\\home\\alumno\\docs');
  win(h, 'net share b=C:\\home\\alumno\\docs\\');
  assert.equal(win(h, 'net share c:\\home\\alumno\\docs /d'), 'c:\\home\\alumno\\docs was deleted successfully.\n');
  assert.deepEqual(winShares(h), []);
});

test('the panel publishes through the same checks, and the device hears about it', () => {
  const h = pc();
  let heard = 0;
  h.onChange(() => heard++);
  assert.equal(publishWinShare(h, { name: 'x', path: 'C:\\home\\alumno\\nada', remark: '', access: 'read' }), 'folder');
  assert.equal(heard, 0);
  assert.equal(publishWinShare(h, { name: 'x', path: 'c:\\home\\alumno\\docs\\', remark: '', access: 'full' }), undefined);
  assert.equal(winShares(h)[0]?.path, 'C:\\home\\alumno\\docs');
  assert.equal(unpublishWinShare(h, 'X'), true);
  assert.equal(unpublishWinShare(h, 'X'), false);
  assert.equal(heard, 2);
});

test('Servicios → SMB follows the box: a Windows PC or Server has the panel only while it shares', () => {
  const h = pc();
  assert.deepEqual(hostPanels(h), ['winshare']);
  setWinShareOn(h, false);
  assert.deepEqual(hostPanels(h), []);
  const srv = EXAMPLES.find((e) => e.id === 'internet')!.build().byLabel('SRV-SEDE2') as Host;
  srv.os = 'windows';
  assert.ok(!hostPanels(srv).includes('winshare'));
  setWinShareOn(srv, true);
  assert.ok(hostPanels(srv).includes('winshare'));
});
