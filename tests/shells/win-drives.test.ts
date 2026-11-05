/**
 * A drive mapped with net use is used as C: is: `Z:` makes it the current drive, cd moves through its folders (each
 * drive keeps its own), relative paths of the file commands and of > / >> start there and the prompt says where the
 * terminal is. When the mapping goes, the terminal is back on C:.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { addSambaShare } from '../../src/shells/samba-admin.ts';

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const srv = t.byLabel('SRV') as Host;
  const sh = createShell(t.byLabel('PC0') as Host, 'windows');
  const win = (cmd: string): string => sh.run(cmd).join('\n');
  const linux = (cmd: string): string => createShell(srv, 'linux', 'root').run(cmd).join('\n');
  return { sh, win, linux, srv };
}

test('Z: switches to the mapped drive; cd, cd .., cd \\ and the prompt follow its folders', () => {
  const { sh, win, linux } = lab();
  const home = sh.prompt();
  assert.match(home, /^C:\\.*>$/);
  assert.equal(win('Z:'), 'The system cannot find the drive specified.');
  win('net use Z: \\\\srv\\publico');
  assert.equal(win('Z:'), '');
  assert.equal(sh.prompt(), 'Z:\\>');
  assert.equal(win('md cursos'), '');
  assert.equal(linux('ls --color=never -d /srv/samba/publico/cursos'), '/srv/samba/publico/cursos');
  assert.equal(win('cd cursos'), '');
  assert.equal(sh.prompt(), 'Z:\\cursos>');
  assert.equal(win('cd'), 'Z:\\cursos');
  assert.equal(win('md 2026'), '');
  assert.equal(win('cd 2026\\..\\2026'), '');
  assert.equal(sh.prompt(), 'Z:\\cursos\\2026>');
  assert.equal(win('cd ..'), '');
  assert.equal(sh.prompt(), 'Z:\\cursos>');
  assert.equal(win('cd \\'), '');
  assert.equal(sh.prompt(), 'Z:\\>');
  assert.equal(win('cd ..'), '', 'above the root is still the root');
  assert.equal(sh.prompt(), 'Z:\\>');
  assert.equal(win('cd nada'), 'The system cannot find the path specified.');
  assert.equal(win('C:'), '');
  assert.equal(sh.prompt(), home);
});

test('relative paths on the drive: dir, type, del, ren, copy, move and > / >> write on the share', () => {
  const { sh, win, linux } = lab();
  win('net use Z: \\\\srv\\publico');
  win('Z:');
  win('md docs');
  win('cd docs');
  assert.equal(win('echo primera> nota.txt'), '');
  assert.equal(win('echo segunda>> nota.txt'), '');
  assert.equal(linux('cat /srv/samba/publico/docs/nota.txt'), 'primera\nsegunda');
  assert.equal(win('type nota.txt'), 'primera\nsegunda');
  assert.match(win('dir'), / Volume in drive Z is publico[\s\S]* Directory of Z:\\docs\n\n[\s\S]*nota\.txt\n[\s\S]*1 File\(s\)/);
  assert.match(win('dir ..'), / Directory of Z:\\\n[\s\S]*<DIR> {10}docs/);
  assert.equal(win('ren nota.txt aviso.txt'), '');
  assert.equal(win('copy aviso.txt ..'), '        1 file(s) copied.');
  assert.equal(linux('ls --color=never /srv/samba/publico'), 'aviso.txt  docs');
  assert.equal(win('cd aviso.txt'), 'The directory name is invalid.');
  assert.equal(win('del ..\\aviso.txt'), '');
  assert.equal(win('C:'), '');
  win('echo local> local.txt');
  assert.equal(win('copy local.txt Z:'), '        1 file(s) copied.', 'Z: alone is its current folder');
  assert.equal(linux('cat /srv/samba/publico/docs/local.txt'), 'local');
  assert.equal(win('type Z:aviso.txt'), 'primera\nsegunda');
  assert.equal(win('cd Z:'), 'Z:\\docs');
  assert.match(sh.prompt(), /^C:\\/);
  win('del local.txt');
  assert.equal(win('move Z:local.txt'), '        1 file(s) moved.');
  assert.equal(win('type local.txt'), 'local');
});

test('cd /d changes drive and folder; cd to another drive only sets its folder; UNC folders are refused', () => {
  const { sh, win } = lab();
  const home = sh.prompt();
  win('net use Z: \\\\srv\\publico');
  win('md Z:\\uno');
  assert.equal(win('cd Z:\\uno'), '');
  assert.equal(sh.prompt(), home, 'cd to another drive does not switch to it');
  assert.equal(win('Z:'), '');
  assert.equal(sh.prompt(), 'Z:\\uno>');
  assert.equal(win('cd /d C:\\'), '');
  assert.equal(sh.prompt(), 'C:\\>');
  assert.equal(win('cd /d Z:\\'), '');
  assert.equal(sh.prompt(), 'Z:\\>');
  assert.equal(win('cd \\\\srv\\publico'), 'CMD does not support UNC paths as current directories.');
  assert.equal(win('cd C:'), 'C:\\');
});

test('md and type take several names on a mapped drive, as on C:; edit does not open a C: file there', () => {
  const { win, linux } = lab();
  win('net use Z: \\\\srv\\publico');
  const local = (): string => win('type a.txt b.txt');
  win('echo uno> a.txt');
  win('echo dos> b.txt');
  const onC = local();
  win('Z:');
  assert.equal(win('md q w'), '');
  assert.equal(linux('ls --color=never -d /srv/samba/publico/q /srv/samba/publico/w'), '/srv/samba/publico/q  /srv/samba/publico/w');
  win('echo uno> a.txt');
  win('echo dos> b.txt');
  assert.equal(local(), onC, 'type lists every file, as the local command does');
  assert.equal(win('edit nota.txt'), win('edit Z:\\nota.txt'), 'a relative name is on the current drive');
  assert.notEqual(win('edit nota.txt'), '');
});

test('cd into a file or a missing folder by path, cd /d to a missing folder, and ren to another drive are refused', () => {
  const { sh, win } = lab();
  win('net use Z: \\\\srv\\publico');
  win('Z:');
  win('md docs');
  win('echo x> docs\\nota.txt');
  assert.equal(win('cd docs\\nota.txt'), 'The directory name is invalid.');
  assert.equal(win('cd /d Z:\\nada'), 'The system cannot find the path specified.');
  assert.equal(sh.prompt(), 'Z:\\>');
  assert.equal(win('ren docs\\nota.txt Z:\\otra.txt'), 'The syntax of the command is incorrect.');
});

test('a letter mapped again to another share starts at its root', () => {
  const { sh, win, srv } = lab();
  assert.equal(addSambaShare(srv, { name: 'otro', path: '/srv/samba/otro', comment: '', readOnly: false, guestOk: true }), null);
  win('net use Z: \\\\srv\\publico');
  win('md Z:\\uno');
  win('cd Z:\\uno');
  win('net use Z: /delete');
  win('net use Z: \\\\srv\\otro');
  assert.equal(win('Z:'), '');
  assert.equal(sh.prompt(), 'Z:\\>');
});

test('the drive goes with its mapping: the terminal is back on C:', () => {
  const { sh, win } = lab();
  win('net use Z: \\\\srv\\publico');
  win('Z:');
  assert.equal(sh.prompt(), 'Z:\\>');
  win('net use Z: /delete');
  assert.match(sh.prompt(), /^C:\\/);
  assert.equal(win('Z:'), 'The system cannot find the drive specified.');
});
