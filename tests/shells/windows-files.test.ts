/** Windows terminal on the Linux file system of the same device: C:\ is /, cd, dir, md, rd, del, copy, move, ren, type, echo > and edit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { toWindowsPath, splitCmdLine, wildMatch } from '../../src/shells/win-path.ts';

const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function pcShells(): { pc: Pc; win: ShellSession; bash: ShellSession } {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  return { pc, win: createShell(pc, 'windows'), bash: createShell(pc, 'linux') };
}

test('paths: C:\\ is the Linux root; the command line keeps quoted names and redirections apart', () => {
  assert.equal(toWindowsPath('/'), 'C:\\');
  assert.equal(toWindowsPath('/home/alumno/Mis notas'), 'C:\\home\\alumno\\Mis notas');
  assert.deepEqual(splitCmdLine('copy "a b.txt" c.txt').words, ['copy', 'a b.txt', 'c.txt']);
  const r = splitCmdLine('echo hola>>"x y.txt"');
  assert.deepEqual([r.words, r.redirect, r.text], [['echo', 'hola'], { path: 'x y.txt', append: true }, 'echo hola']);
  assert.deepEqual([splitCmdLine('echo "a > b"').words, splitCmdLine('echo "a > b"').redirect], [['echo', 'a > b'], null]);
  assert.equal(wildMatch('*.TXT', 'notas.txt'), true);
  assert.equal(wildMatch('n?tas.*', 'notas.md'), true);
  assert.equal(wildMatch('*.txt', 'notas.md'), false);
});

test('the Windows terminal starts in the home folder of the Linux account and sees the same files', () => {
  const { win, bash } = pcShells();
  assert.equal(win.prompt(), 'C:\\home\\alumno>');
  bash.run('echo "desde linux" > ~/compartido.txt');
  assert.deepEqual(win.run('type compartido.txt'), ['desde linux']);
  win.run('echo desde windows> Notas.txt');
  assert.deepEqual(bash.run('cat ~/Notas.txt').map(plain), ['desde windows']);
  win.run('echo segunda línea>> notas.txt');
  assert.deepEqual(bash.run('cat ~/Notas.txt').map(plain), ['desde windows', 'segunda línea'], 'names are case-insensitive, as on Windows');
  const ip = win.run('ipconfig > ip.txt');
  assert.deepEqual(ip, []);
  assert.match(bash.run('cat ~/ip.txt').map(plain).join('\n'), /IPv4 Address/);
});

test('cd and dir move around and list the Linux tree in cmd.exe format', () => {
  const { win } = pcShells();
  assert.deepEqual(win.run('cd'), ['C:\\home\\alumno']);
  assert.deepEqual(win.run('cd \\etc'), []);
  assert.equal(win.prompt(), 'C:\\etc>');
  assert.deepEqual(win.run('cd ..'), []);
  assert.equal(win.prompt(), 'C:\\>');
  assert.deepEqual(win.run('cd C:\\no\\existe'), ['The system cannot find the path specified.']);
  assert.deepEqual(win.run('cd D:\\'), ['The system cannot find the drive specified.']);
  win.run('cd /home/alumno');
  win.run('echo hola> a.txt');
  win.run('md docs');
  const out = win.run('dir').join('\n');
  assert.match(out, / Directory of C:\\home\\alumno/);
  assert.match(out, /<DIR> {10}docs/);
  assert.match(out, / {17}5 a\.txt/);
  assert.match(out, /File\(s\)/);
  assert.match(out, /Dir\(s\) +[\d,]+ bytes free/);
  assert.deepEqual(win.run('dir /b *.txt'), ['a.txt']);
  assert.deepEqual(win.run('dir nada.txt').slice(-1), ['File Not Found']);
});

test('md, rd, del, copy, move and ren with the messages of cmd.exe', () => {
  const { win, bash } = pcShells();
  assert.deepEqual(win.run('mkdir trabajo\\fase1'), [], 'intermediate folders are created');
  assert.deepEqual(win.run('md trabajo'), ['A subdirectory or file trabajo already exists.']);
  win.run('echo uno> uno.txt');
  assert.deepEqual(win.run('copy uno.txt trabajo'), ['        1 file(s) copied.']);
  assert.deepEqual(win.run('copy uno.txt dos.txt'), ['        1 file(s) copied.']);
  assert.deepEqual(win.run('ren dos.txt tres.txt'), []);
  assert.deepEqual(win.run('move tres.txt trabajo\\fase1'), ['        1 file(s) moved.']);
  assert.deepEqual(bash.run('ls ~/trabajo ~/trabajo/fase1').map(plain).filter(Boolean), ['/home/alumno/trabajo:', 'fase1  uno.txt', '/home/alumno/trabajo/fase1:', 'tres.txt']);
  assert.deepEqual(win.run('rd trabajo'), ['The directory is not empty.']);
  assert.deepEqual(win.run('del uno.txt'), []);
  assert.deepEqual(win.run('del uno.txt'), [`Could Not Find C:\\home\\alumno\\uno.txt`]);
  assert.deepEqual(win.run('rd /s /q trabajo'), []);
  assert.deepEqual(bash.run('ls ~').map(plain).filter(Boolean), []);
  assert.deepEqual(win.run('type nada.txt'), ['The system cannot find the file specified.']);
  assert.deepEqual(win.run('echo x> \\etc\\prohibido'), ['Access is denied.'], 'the Linux permissions apply');
});

test('edit opens the full-screen editor on the Windows path and saves to the Linux file', () => {
  const { win, bash } = pcShells();
  assert.deepEqual(win.run('edit carta.txt'), []);
  const spec = win.editRequest?.();
  assert.equal(spec?.editor, 'msedit');
  assert.equal(spec?.path, '/home/alumno/carta.txt');
  assert.equal(spec?.exists, false);
  assert.equal(win.saveEdit?.(spec?.path ?? '', 'Querida red:\n'), null);
  assert.deepEqual(win.closeEdit?.(), []);
  assert.equal(win.editRequest?.(), null);
  assert.deepEqual(bash.run('cat ~/carta.txt').map(plain), ['Querida red:']);
  assert.deepEqual(win.run('edit \\etc\\hostname').length, 0);
  assert.equal(win.editRequest?.()?.readOnly, true, 'a file the user cannot write opens read-only');
  win.closeEdit?.();
  assert.deepEqual(win.run('edit'), ['The syntax of the command is incorrect.']);
});

test('a Windows server works as the admin account of its Linux system', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const win = createShell(srv, 'windows');
  assert.equal(win.prompt(), 'C:\\home\\admin>');
  assert.deepEqual(win.run('echo web> \\var\\www\\html\\prueba.html'), ['Access is denied.'], 'the web root is root\'s, as in its Linux terminal');
  assert.deepEqual(win.run('type \\var\\www\\html\\index.html').length > 0, true);
  assert.equal(srv.services.http.files.some((f) => f.name === 'prueba.html'), false);
});

test('rd /s, del of a folder or *.* and overwriting ask first, as cmd.exe does; /q and /y do not', () => {
  const { win, bash } = pcShells();
  bash.run('mkdir -p ~/d/sub && echo a > ~/d/a.txt && echo b > ~/d/b && echo c > ~/c.txt');
  assert.deepEqual(win.run('rd /s d'), []);
  assert.equal(win.prompt(), 'd, Are you sure (Y/N)? ');
  assert.deepEqual(win.run('n'), []);
  assert.equal(win.prompt(), 'C:\\home\\alumno>');
  win.run('del d');
  assert.equal(win.prompt(), 'C:\\home\\alumno\\d\\*, Are you sure (Y/N)? ');
  win.run('quizá');
  assert.match(win.prompt(), /Are you sure/, 'asked again until yes or no');
  win.run('Y');
  assert.deepEqual(bash.run('ls ~/d').map(plain).filter(Boolean), ['sub'], 'files only, the subfolder stays');
  win.run('copy c.txt d\\c.txt');
  assert.deepEqual(win.run('copy c.txt d'), []);
  assert.equal(win.prompt(), 'Overwrite C:\\home\\alumno\\d\\c.txt? (Yes/No/All): ');
  assert.deepEqual(win.run('yes'), ['        1 file(s) copied.']);
  assert.deepEqual(win.run('copy /y c.txt d'), ['        1 file(s) copied.']);
  assert.deepEqual(win.run('copy c.txt c.txt'), ['The file cannot be copied onto itself.', '        0 file(s) copied.']);
  assert.deepEqual(win.run('rd /s /q d'), []);
});

test('move renames a whole folder; copy joins several files; *.* matches names without a dot', () => {
  const { win, bash } = pcShells();
  bash.run('mkdir ~/docs && echo uno > ~/docs/a.txt && echo dos > ~/docs/b.txt && echo tres > ~/LEEME');
  assert.deepEqual(win.run('move docs archivo'), ['        1 dir(s) moved.']);
  assert.deepEqual(bash.run('ls ~/archivo').map(plain).filter(Boolean), ['a.txt  b.txt']);
  assert.deepEqual(win.run('copy archivo\\*.txt todo.txt'), ['a.txt', 'b.txt', '        1 file(s) copied.']);
  assert.deepEqual(win.run('type todo.txt'), ['uno', 'dos']);
  assert.deepEqual(win.run('move archivo\\*.txt solo.txt'), ['Cannot move multiple files to a single file.', '        0 file(s) moved.']);
  assert.deepEqual(win.run('dir /b *.*'), ['.bash_logout', '.bashrc', '.profile', 'LEEME', 'archivo', 'todo.txt'], 'Linux dotfiles are ordinary files for cmd');
  assert.deepEqual(win.run('ren todo.txt leeme'), ['A duplicate file name exists, or the file cannot be found.'], 'names collide whatever their case');
});

test('dir of an empty folder, of a missing file and with a broken link; echo., nul and a > without a name', () => {
  const { win, bash } = pcShells();
  win.run('md vacia');
  const empty = win.run('dir vacia').join('\n');
  assert.match(empty, /<DIR> {10}\.\n.*<DIR> {10}\.\.\n {15}0 File\(s\)/);
  assert.deepEqual(win.run('dir nada.txt').slice(-3), [' Directory of C:\\home\\alumno', '', 'File Not Found']);
  bash.run('ln -s /no/existe ~/roto');
  assert.match(win.run('dir').join('\n'), /<SYMLINK> {6}roto \[\/no\/existe\]/);
  assert.deepEqual(win.run('echo.'), ['']);
  assert.deepEqual(win.run('echo'), ['ECHO is on.']);
  assert.deepEqual(win.run('ping -n 1 127.0.0.1 > nul'), []);
  assert.deepEqual(win.run('dir nul'), win.run('dir nul'));
  assert.deepEqual(win.run('echo hola >'), ['The syntax of the command is incorrect.']);
  assert.deepEqual(win.run('type nada.txt 2>nul'), ['The system cannot find the file specified.'], 'errors are not told apart from output: 2> is ignored');
  assert.deepEqual(bash.run('ls ~').map(plain).filter(Boolean), ['roto  vacia']);
});
