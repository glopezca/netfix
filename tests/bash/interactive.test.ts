/** The interactive session: history expansion, completion, jobs, continuation lines, read prompts, Ctrl+C/D, nested shells. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BashSession } from '../../src/bash/shell.ts';
import { makeEnv, USER } from './harness.ts';

const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const SUDOER = { ...USER, groups: [USER.gid, 27] };
const session = (): BashSession => new BashSession(makeEnv(), SUDOER);

test('the Ubuntu prompt, PS2 continuation lines and cmdhist', () => {
  const s = session();
  assert.equal(plain(s.prompt()), 'alumno@pc0:~$ ');
  assert.equal(s.input('for i in 1 2'), '');
  assert.equal(s.prompt(), '> ');
  assert.equal(s.input('do echo $i'), '');
  assert.equal(s.input('done'), '1\n2\n');
  assert.equal(s.input('history 1').trim(), '2  history 1'.replace('2', String(s.sh.history.lines.length)));
  assert.ok(s.sh.history.lines.includes('for i in 1 2; do echo $i; done'));
});

test('history expansion: !!, !$, !n, !prefix, ^old^new, :p and errors', () => {
  const s = session();
  s.input('echo uno dos');
  assert.equal(s.input('echo !$'), 'echo dos\ndos\n');
  assert.equal(s.input('!!'), 'echo dos\ndos\n');
  assert.equal(s.input('!echo:p'), 'echo dos\n');
  assert.equal(s.input('^dos^tres'), 'echo tres\ntres\n');
  assert.equal(s.input('echo !1'), 'echo echo uno dos\necho uno dos\n');
  assert.match(s.input('!nada'), /bash: !nada: event not found/);
  assert.equal(s.input("echo '!!'"), '!!\n');
});

test('Tab completion of commands, files and variables', () => {
  const s = session();
  s.input('touch notas.txt nota2.txt; mkdir dir1');
  assert.deepEqual(s.complete('hostnamec'), { line: 'hostnamectl ', candidates: ['hostnamectl'] });
  assert.deepEqual(s.complete('hostn').candidates, ['hostname', 'hostnamectl']);
  assert.equal(s.complete('cat no').line, 'cat nota');
  assert.deepEqual(s.complete('cat no').candidates, ['nota2.txt', 'notas.txt']);
  assert.equal(s.complete('cd di').line, 'cd dir1/');
  assert.equal(s.complete('echo $HOM').line, 'echo $HOME ');
  assert.equal(s.complete('ls ~/no').line, 'ls ~/nota');
  assert.deepEqual(s.complete('zzzz').candidates, []);
});

test('background jobs report Done; jobs, wait, kill %n and fg errors', () => {
  const s = session();
  assert.match(s.input('sleep 1 &'), /^\[1\] \d+\n\[1\]\+  Done {20}sleep 1\n$/);
  assert.match(s.input('false &'), /\[1\]\+  Exit 1 {18}false/);
  assert.equal(s.input('wait; echo $?'), '0\n');
  assert.match(s.input('fg'), /fg: current: no such job/);
  assert.match(s.input('kill %3'), /kill: %3: no such job/);
});

test('read waits for a line with its prompt; Ctrl+C and Ctrl+D', () => {
  const s = session();
  assert.equal(s.input('read -p "Nombre: " n; echo "hola $n"'), '');
  assert.equal(s.prompt(), 'Nombre: ');
  assert.equal(s.input('Ana'), 'hola Ana\n');
  s.input('cat');
  assert.equal(s.input('linea'), 'linea\n');
  assert.equal(s.eof(), '');
  s.input('read x');
  s.interrupt();
  assert.equal(s.input('echo $?'), '130\n');
  s.input('echo "abierta');
  assert.equal(s.interrupt(), '');
  assert.equal(plain(s.prompt()), 'alumno@pc0:~$ ');
  assert.equal(s.eof(), 'exit\n');
  assert.equal(s.closed, true);
});

test('nested shells: bash, sudo -i and su, with SHLVL and exit statuses', () => {
  const s = session();
  s.input('bash');
  assert.equal(s.input('echo $SHLVL'), '2\n');
  assert.equal(s.input('exit 4'), 'exit\n');
  assert.equal(s.input('echo $?'), '4\n');
  s.input('sudo -i');
  assert.equal(s.prompt(), 'root@pc0:~# ');
  assert.equal(s.input('logout'), 'logout\n');
  assert.equal(s.input('su -'), '');
  assert.equal(s.prompt(), 'Password: ');
  assert.equal(s.secret(), true);
  assert.equal(s.input('x'), 'su: Authentication failure\n');
  assert.equal(s.input('echo $?'), '1\n');
});

test('runaway recursion is stopped and the session keeps working', () => {
  const s = session();
  assert.equal(s.input('f(){ f; }; f; echo no'), 'bash: f: maximum function nesting level exceeded (200)\n');
  assert.equal(s.input('echo "$? ${#FUNCNAME[@]}"'), '1 0\n');
  assert.equal(s.input('echo "source s.sh" > s.sh; source s.sh'), 'bash: maximum recursion depth exceeded\n');
  assert.equal(s.input('x=$(f); echo "[$x] $?"'), 'bash: f: maximum function nesting level exceeded (200)\n[] 1\n');
  assert.match(s.input('return'), /can only `return'/);
});

test('help with a long run of * answers at once (no catastrophic backtracking)', () => {
  const started = Date.now();
  assert.match(session().input(`help ${'*'.repeat(40)}zzz`), /no help topics match/);
  assert.ok(Date.now() - started < 1000);
});
