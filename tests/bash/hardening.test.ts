/** Limits that keep one command from freezing the page or corrupting the simulated system. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCatastrophic } from '../../src/bash/regex-guard.ts';
import { Vfs } from '../../src/bash/vfs.ts';
import { importFiles, validFileRecords } from '../../src/bash/vfs-persist.ts';
import { runScript } from './harness.ts';

test('exponential regular expressions are refused everywhere, ordinary ones work', () => {
  for (const re of ['(a|aa)+$', '(a|a)*b', '(a+)+', '(\\w|_)*', '((ab)+)+', '(.*a){20}']) assert.equal(isCatastrophic(re), true, re);
  for (const re of ['(ab|cd)+', 'a+b*', '(foo|bar)', '(a|b|c)*', '^([0-9]{1,3}\\.){3}[0-9]{1,3}$', '[(]+']) assert.equal(isCatastrophic(re), false, re);
  const long = `${'a'.repeat(60)}b`;
  const r = runScript(`echo ${long} | grep -E '(a|aa)+$'; echo "g=$?"; [[ ${long} =~ (a|aa)+$ ]]; echo "t=$?"; shopt -s extglob; case ${long} in +(a|aa)) echo m;; *) echo n;; esac; echo abcd | grep -oE '(ab|cd)+'`);
  assert.equal(r.out, `grep: Netfix: expresión regular demasiado costosa (grupos repetidos con alternativas o cuantificadores)\ng=2\nt=2\nn\nabcd\n`);
});

test('symbolic link chains are bounded (ELOOP) instead of exploding', () => {
  const fs = new Vfs();
  for (let i = 1; i <= 16; i++) fs.symlink(i === 16 ? '/' : `/L${i + 1}/L${i + 1}/L${i + 1}/L${i + 1}`, `/L${i}`);
  const t = Date.now();
  assert.throws(() => fs.realpath('/L1/x'), /Too many levels of symbolic links/);
  assert.ok(Date.now() - t < 500);
});

test('mv keeps mode and owner, refuses to move a file onto itself', () => {
  const r = runScript('printf x > a; chmod 750 a; mkdir d; mv a d/; stat -c "%a %U" d/a; mv d/a d; echo $?');
  assert.equal(r.out, "750 alumno\nmv: 'd/a' and 'd/a' are the same file\n1\n");
});

test('restored topology files cannot touch system areas, follow links or keep setuid bits', () => {
  const fs = new Vfs();
  fs.mkdir('/etc');
  fs.seed('/etc/passwd', { kind: 'file', content: 'root:x:0:0::/root:/bin/bash\n' });
  fs.mkdir('/usr/bin', undefined, true);
  fs.mkdir('/home/a', undefined, true);
  const records = validFileRecords([
    { path: '/etc/passwd', kind: 'file', content: 'evil', mode: 0o644, uid: 0, gid: 0 },
    { path: '/usr/bin/ls', kind: 'file', content: 'evil', mode: 0o755, uid: 0, gid: 0 },
    { path: '/home/a/l', kind: 'link', target: '/etc', mode: 0o777, uid: 0, gid: 0 },
    { path: '/home/a/l/x', kind: 'file', content: 'via link', mode: 0o644, uid: 0, gid: 0 },
    { path: '/home/a/s', kind: 'file', content: '#!/bin/sh', mode: 0o4755, uid: 0, gid: 0 },
    { path: '/home/a/big', kind: 'link', target: 'x'.repeat(300), mode: 0o777, uid: 0, gid: 0 },
  ]);
  assert.equal(records.length, 5);
  importFiles(fs, records);
  assert.equal(fs.readFile('/etc/passwd'), 'root:x:0:0::/root:/bin/bash\n');
  assert.equal(fs.exists('/usr/bin/ls'), false);
  assert.equal(fs.exists('/etc/x'), false);
  assert.equal(fs.stat('/home/a/s').mode & 0o7777, 0o755);
  assert.equal(fs.usedBytes, '#!/bin/sh'.length);
});
