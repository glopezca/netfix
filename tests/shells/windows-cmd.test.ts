/** cmd.exe on the Windows terminal: ^ escapes, & && || chains, set / set /a, if, for, batch files and mc.exe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { arith, expandLine, splitChain } from '../../src/shells/win-cmd-parse.ts';
import { splitCmdLine } from '../../src/shells/win-path.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { winMcFs } from '../../src/shells/win-mc.ts';
import { WinFs } from '../../src/shells/win-fsctx.ts';

function winPc(): { pc: Pc; w: ShellSession } {
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const w = createShell(pc, 'windows');
  w.prompt();
  return { pc, w };
}
const win = (): ShellSession => winPc().w;

/** Writes a batch file line by line (echo >> keeps each line as typed, with ^ escaping its specials). */
function batch(w: ShellSession, name: string, lines: readonly string[]): void {
  lines.forEach((l, i) => w.run(`echo ${l.replace(/[&|<>()^]/g, '^$&')}${i ? '>>' : '>'} ${name}`));
}

test('parsing: chains split outside quotes, groups and ^; expansion and set /a arithmetic', () => {
  assert.deepEqual(splitChain('echo a & echo b && dir || ver').map((l) => [l.op, l.text.trim()]), [['&', 'echo a'], ['&', 'echo b'], ['&&', 'dir'], ['||', 'ver']]);
  assert.equal(splitChain('echo "a & b" ^& c').length, 1);
  assert.equal(splitChain('if exist x (echo a & echo b) else (echo c)').length, 1);
  assert.deepEqual(splitCmdLine('type c^ d.txt').words, ['type', 'c d.txt']);
  assert.deepEqual(splitCmdLine('echo a ^> b').redirect, null);
  const get = (n: string): string | undefined => ({ x: '5' } as Record<string, string>)[n.toLowerCase()];
  assert.equal(expandLine('%X% %Y% %1', { get }), '5 %Y% %1', 'at the prompt an unknown name and %1 stay');
  assert.equal(expandLine('%X%%Y% %1 %~2 %* 100%%', { get, args: ['t.bat', 'a', '"b c"'] }), '5 a b c a "b c" 100%', 'in a batch file');
  assert.deepEqual(arith('n=2+3*4, n+=1', get), { sets: [['n', '14'], ['n', '15']], last: 15 });
  assert.deepEqual(arith('x*(2+1)', get), { sets: [], last: 15 });
  assert.equal(arith('x/0', get), 'Divide by zero error.');
});

test('names with spaces and specials: quotes, backslashes and ^', () => {
  const w = win();
  w.run('md "Mis Docs\\Sub (1)"');
  w.run('cd "Mis Docs"');
  assert.equal(w.prompt(), 'C:\\Users\\user\\Mis Docs>');
  w.run('echo hola> "a & b (1).txt"');
  assert.deepEqual(w.run('type "a & b (1).txt"'), ['hola']);
  w.run('copy "a & b (1).txt" "Sub (1)\\c d.txt"');
  assert.deepEqual(w.run('type Sub^ ^(1^)\\c^ d.txt'), ['hola']);
  w.run('cd C:\\Users\\user\\"Mis Docs"\\"Sub (1)"');
  assert.equal(w.prompt(), 'C:\\Users\\user\\Mis Docs\\Sub (1)>');
});

test('chains, variables and errorlevel at the prompt', () => {
  const w = win();
  assert.deepEqual(w.run('echo uno & echo dos'), ['uno', 'dos']);
  assert.deepEqual(w.run('type nada.txt && echo ok || echo falla'), ['The system cannot find the file specified.', 'falla']);
  assert.deepEqual(w.run('echo x > f.txt && type f.txt'), ['x ']);
  assert.deepEqual(w.run('set NOMBRE=Ana López'), []);
  assert.deepEqual(w.run('echo Hola %nombre%'), ['Hola Ana López']);
  assert.deepEqual(w.run('set nom'), ['NOMBRE=Ana López']);
  assert.deepEqual(w.run('set /a total=6*7'), ['42']);
  assert.deepEqual(w.run('echo %TOTAL% %ERRORLEVEL%'), ['42 0']);
  w.run('set NOMBRE=');
  assert.deepEqual(w.run('set NOMBRE'), ['Environment variable NOMBRE not defined']);
  assert.deepEqual(w.run('if exist f.txt (echo si) else (echo no)'), ['si']);
  assert.deepEqual(w.run('if not exist z.txt echo falta'), ['falta']);
  assert.deepEqual(w.run('if /i "A"=="a" echo igual'), ['igual']);
  assert.deepEqual(w.run('if 10 GTR 9 echo mayor'), ['mayor']);
  assert.deepEqual(w.run('for /l %i in (1,1,3) do echo %i'), ['1', '2', '3']);
  assert.deepEqual(w.run('for %f in (*.txt) do type %f'), ['x ']);
  assert.match(w.run('for /l %i in (1,1,200) do for /l %j in (1,1,200) do set /a k=%i').at(-1) ?? '', /stopped the for loop after 10000 turns/, 'nested loops are cut off');
});

test('batch files: @echo off, arguments, labels, goto, call, shift, if blocks and exit /b', () => {
  const w = win();
  batch(w, 'saluda.bat', [
    '@echo off',
    'rem Saluda a cada argumento',
    ':: comentario',
    'set N=0',
    ':bucle',
    'if "%~1"=="" goto fin',
    'set /a N+=1',
    'call :uno %1',
    'shift',
    'goto bucle',
    ':fin',
    'if %N% GEQ 2 (',
    '  echo %N% saludos',
    ') else (',
    '  echo pocos',
    ')',
    'exit /b 3',
    ':uno',
    'echo Hola %~1',
    'exit /b',
  ]);
  assert.deepEqual(w.run('saluda "Ana María" Luis'), ['Hola Ana María', 'Hola Luis', '2 saludos']);
  assert.deepEqual(w.run('echo %ERRORLEVEL%'), ['3']);
  assert.deepEqual(w.run('saluda.bat'), ['pocos']);
  assert.deepEqual(w.run('call saluda.bat Eva & echo después'), ['Hola Eva', 'pocos', 'después']);
});

test('batch files: echo on shows each line; .cmd and %PATH%; a loop is cut off', () => {
  const { pc, w } = winPc();
  batch(w, 'eco.cmd', ['echo uno', '@echo dos']);
  assert.deepEqual(w.run('eco'), ['C:\\Users\\user>echo uno', 'uno', 'dos']);
  batch(w, 'bucle.bat', ['@echo off', ':a', 'goto a']);
  assert.match(w.run('bucle').at(-1) ?? '', /stopped bucle\.bat after 10000 lines/);
  batch(w, 'mal.bat', ['@goto nada']);
  assert.deepEqual(w.run('mal'), ['The system cannot find the batch label specified - nada']);
  hostSystem(pc).fs.writeFile('/mnt/c/Program Files/Git/usr/bin/enpath.cmd', '@echo desde path\n');
  assert.deepEqual(w.run('enpath'), ['desde path'], 'found through %PATH%');
  assert.deepEqual(w.run('noexiste'), ['Invalid Command.']);
});

test('mc.exe: Midnight Commander on Windows paths, from Git\'s usr\\bin', () => {
  const { pc, w } = winPc();
  assert.deepEqual(w.run('dir /b "C:\\Program Files\\Git\\usr\\bin"'), ['mc.exe', 'nano.exe', 'vim.exe']);
  w.run('md "Mis Docs"');
  w.run('echo hola> "Mis Docs\\nota 1.txt"');
  assert.deepEqual(w.run('mc.exe "Mis Docs"'), []);
  const text = (): string => (w.screenFrame?.(100, 30)?.rows ?? []).map((r) => r.map((s) => s.text).join('')).join('\n');
  assert.match(text(), /C:\\Users\\user\\Mis Docs/);
  assert.match(text(), /nota 1\.txt/);
  assert.match(text(), /C:\\Users\\user\\Mis Docs>/, 'the command line shows the Windows prompt');
  // F5 copies into the other panel's folder, offered as a Windows path.
  w.screenKey?.({ key: 'ArrowDown' });
  w.screenKey?.({ key: 'F5' });
  assert.match(text(), /C:\\Users\\user\\Mis Docs\\/);
  w.screenKey?.({ key: 'Escape' });
  w.screenKey?.({ key: 'F10' });
  w.screenKey?.({ key: 'Enter' });
  assert.equal(w.screenFrame?.(100, 30) ?? null, null, 'F10 closes it');
  // F5 on a folder holding a link to itself copies the link, not an endless tree.
  hostSystem(pc).fs.symlink('/mnt/c/Users/user/Mis Docs', '/mnt/c/Users/user/Mis Docs/bucle', { uid: 0, gid: 0, groups: [] });
  assert.equal(winMcFs(new WinFs(hostSystem(pc).fs, { uid: 0, gid: 0, groups: [] }, '/mnt/c')).copy(['/mnt/c/Users/user/Mis Docs'], '/mnt/c/Users/user/Copia'), null);
  assert.equal(hostSystem(pc).fs.tryLookup('/mnt/c/Users/user/Copia/bucle', undefined, false)?.kind, 'link');
  assert.deepEqual(w.run('mc C:\\nada'), ['mc: C:\\nada: No such directory']);
  hostSystem(pc).fs.remove('/mnt/c/Program Files/Git/usr/bin/mc.exe');
  assert.deepEqual(w.run('mc .'), ['Invalid Command.'], 'gone from usr\\bin, gone from the terminal');
});
