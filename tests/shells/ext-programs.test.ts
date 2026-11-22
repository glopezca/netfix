/** Terminal programs added from outside the core (extension SDK): in /usr/bin or in %PATH%, with the user's permissions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Host } from '../../src/devices/host.ts';
import { createShell } from '../../src/shells/factory.ts';
import { registerProgram, type ProgramCall } from '../../src/shells/programs.ts';
import { hostFiles } from '../../src/shells/host-files.ts';
import { utilDocs } from '../../src/docs/index.ts';

const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const DOC = { synopsis: 'NAME [archivo]', summary: 'Programa de ejemplo de una extensión.' };
const doc = (name: string): { es: typeof DOC; en: typeof DOC } => ({ es: { ...DOC, synopsis: `${name} [archivo]` }, en: { synopsis: `${name} [file]`, summary: 'An extension\'s sample program.' } });

/** Only the PCs named in `on` have it: an extension decides per host (its lab, its class). */
function sample(name: string, on: Set<Host>, calls: ProgramCall[] = []): void {
  registerProgram({
    name, systems: ['linux', 'windows'], windowsDir: 'Program Files/Sample', doc: doc(name),
    applies: (host) => on.has(host),
    run: (call) => {
      calls.push(call);
      const [, path] = call.argv;
      if (path === undefined) { call.out(`${call.user} ${call.cwd}\n`); return 0; }
      try {
        call.files.write(path, `${call.files.read(path) ?? ''}+`);
        call.out(`${call.files.resolve(path)}\n`);
        return 0;
      } catch (e) {
        call.err(`${name}: ${(e as Error).message}\n`);
        return 1;
      }
    },
  });
}

function twoPcs(): { a: Pc; b: Pc } {
  const t = new Topology();
  return { a: t.add('pc', 0, 0).device as Pc, b: t.add('pc', 100, 0).device as Pc };
}

test('GNU/Linux: in /usr/bin where it applies, run with its arguments, files with the terminal user\'s permissions', () => {
  const { a, b } = twoPcs();
  const calls: ProgramCall[] = [];
  sample('xprog-linux', new Set([a]), calls);
  const sh = createShell(a, 'linux');
  assert.deepEqual(sh.run('which xprog-linux').map(plain), ['/usr/bin/xprog-linux']);
  assert.deepEqual(sh.run('xprog-linux').map(plain), ['alumno /home/alumno']);
  assert.deepEqual(sh.run('cd /tmp && xprog-linux notas.txt && cat notas.txt').map(plain), ['/tmp/notas.txt', '+']);
  assert.equal(calls.at(-1)?.system, 'linux');
  const denied = sh.run('xprog-linux /root/x.txt').map(plain).join('\n');
  assert.match(denied, /^xprog-linux: .*(denied|Permission)/i, 'not root: as nano, no writing what the user cannot');
  // Another PC of the same lab does not have it.
  assert.match(createShell(b, 'linux').run('xprog-linux').map(plain).join('\n'), /command not found/);
});

test('Windows: <name>.exe in its folder of %PATH%, found with or without .exe, as the Windows account', () => {
  const { a } = twoPcs();
  const calls: ProgramCall[] = [];
  sample('xprog-win', new Set([a]), calls);
  const win = createShell(a, 'windows');
  win.prompt();
  assert.deepEqual(win.run('dir /b "C:\\Program Files\\Sample"'), ['xprog-win.exe']);
  assert.match(win.run('echo %PATH%').join(''), /C:\\Program Files\\Sample/);
  assert.match(win.run('path').join(''), /;C:\\Program Files\\Sample$/, 'path shows it too');
  assert.deepEqual(win.run('xprog-win'), ['user C:\\Users\\user']);
  assert.deepEqual(win.run('xprog-win.exe notas.txt'), ['C:\\Users\\user\\notas.txt']);
  assert.deepEqual(win.run('type notas.txt'), ['+']);
  assert.equal(calls.at(-1)?.system, 'windows');
});

test('documented like the core\'s programs (man, help) in each language', () => {
  sample('xprog-doc', new Set());
  assert.equal(utilDocs('es-ES')['xprog-doc']?.synopsis, 'xprog-doc [archivo]');
  assert.equal(utilDocs('en-GB')['xprog-doc']?.summary, 'An extension\'s sample program.');
});

test('names: one registration each, never over a core program, letters and digits only', () => {
  sample('xprog-twice', new Set());
  assert.throws(() => sample('xprog-twice', new Set()), /ya existe/);
  assert.throws(() => sample('ls', new Set()), /ya existe/);
  assert.throws(() => sample('Mal Nombre', new Set()), /no válido/);
  assert.throws(() => registerProgram({ name: 'xprog-nosys', systems: [], doc: doc('x'), applies: () => true, run: () => 0 }), /sistema/);
});

test('hostFiles: a device\'s files without a terminal, as its default user and with the same permissions', () => {
  const { a } = twoPcs();
  assert.equal(hostFiles(a).home, 'C:\\Users\\user', 'a new PC is a Windows PC: its own system by default');
  const files = hostFiles(a, 'linux');
  assert.equal(files.home, '/home/alumno');
  files.write('hola.py', 'print(1)\n');
  assert.equal(files.read('/home/alumno/hola.py'), 'print(1)\n');
  assert.deepEqual(files.list('.').filter((e) => e.name === 'hola.py'), [{ name: 'hola.py', kind: 'file' }]);
  assert.equal(files.read('no-existe.txt'), null);
  assert.throws(() => files.write('/root/x.txt', 'x'), /denied|Permission/i);
  assert.deepEqual(createShell(a, 'linux').run('cat hola.py').map(plain), ['print(1)']);
});

test('aliases: a symlink in /usr/bin on GNU/Linux, another .exe on Windows; argv[0] is the name typed', () => {
  const { a } = twoPcs();
  const calls: ProgramCall[] = [];
  registerProgram({ name: 'xprog-main', aliases: ['xprog-alias'], systems: ['linux', 'windows'], windowsDir: 'Program Files/Alias', doc: doc('xprog-main'), applies: (h) => h === a, run: (call) => { calls.push(call); call.out('ok\n'); } });
  const sh = createShell(a, 'linux');
  assert.deepEqual(sh.run('readlink /usr/bin/xprog-alias').map(plain), ['xprog-main']);
  assert.deepEqual(sh.run('xprog-alias').map(plain), ['ok']);
  assert.equal(calls.at(-1)?.argv[0], 'xprog-alias');
  const win = createShell(a, 'windows');
  win.prompt();
  assert.deepEqual(win.run('dir /b "C:\\Program Files\\Alias"'), ['xprog-alias.exe', 'xprog-main.exe']);
  assert.deepEqual(win.run('xprog-alias.exe'), ['ok']);
  assert.deepEqual(win.run('xprog-alias'), ['ok']);
  assert.throws(() => registerProgram({ name: 'xprog-other', aliases: ['ls'], systems: ['linux'], doc: doc('x'), applies: () => true, run: () => 0 }), /ya existe/);
  assert.throws(() => registerProgram({ name: 'xprog-other2', aliases: ['xprog-alias'], systems: ['linux'], doc: doc('x'), applies: () => true, run: () => 0 }), /ya existe/);
});
