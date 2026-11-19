/** cmd.exe input and output: | pipes, find / findstr / sort / more, < input, set /p, for /f and exact errorlevels. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { forFLines, forFOptions, splitPipe, takeInput } from '../../src/shells/win-cmd-io.ts';

function win(): ShellSession {
  const t = new Topology();
  const w = createShell(t.add('pc', 0, 0).device as Pc, 'windows');
  w.prompt();
  return w;
}

/** Writes a file line by line (echo >> keeps each line as typed, with ^ escaping its specials). */
function file(w: ShellSession, name: string, lines: readonly string[]): void {
  lines.forEach((l, i) => w.run(`echo ${l.replace(/[&|<>()^]/g, '^$&')}${i ? '>>' : '>'} ${name}`));
}

test('parsing: | outside quotes, ^ and groups; < input; for /f options and tokens', () => {
  assert.deepEqual(splitPipe('type a.txt | find "x|y" | sort'), ['type a.txt ', ' find "x|y" ', ' sort']);
  assert.deepEqual(splitPipe('echo a ^| b'), ['echo a ^| b']);
  assert.deepEqual(takeInput('sort < "mis notas.txt" /r'), { text: 'sort  /r', path: 'mis notas.txt' });
  assert.deepEqual(takeInput('echo "a < b"'), { text: 'echo "a < b"', path: null });
  const o = forFOptions('tokens=1,3* delims=,; skip=1');
  assert.ok(typeof o !== 'string');
  assert.deepEqual(forFLines(['cabecera', 'a,b;c,d e', '', ';comentario', 'x'], o), [['a', 'c', 'd e'], ['x', '', '']]);
  const all = forFOptions('tokens=* usebackq');
  assert.ok(typeof all !== 'string');
  assert.deepEqual(forFLines(['  dos  palabras'], all), [['dos  palabras']]);
  assert.equal(forFOptions('tokens=0'), 'tokens=0" was unexpected at this time.');
});

test('pipes into find, findstr, sort and more, with their errorlevels', () => {
  const w = win();
  file(w, 'nombres.txt', ['Luis', 'ana', 'Bea López', 'Ana María']);
  assert.deepEqual(w.run('type nombres.txt | find "Ana"'), ['Ana María']);
  assert.deepEqual(w.run('type nombres.txt | find /i /n "ana"'), ['[2]ana', '[4]Ana María']);
  assert.deepEqual(w.run('type nombres.txt | find /c /v "Ana"'), ['3']);
  assert.deepEqual(w.run('find "Luis" nombres.txt'), ['', '---------- NOMBRES.TXT', 'Luis']);
  assert.deepEqual(w.run('find Luis nombres.txt'), ['FIND: Parameter format not correct']);
  assert.deepEqual(w.run('type nombres.txt | find "Eva" && echo hay || echo no hay'), ['no hay']);
  assert.deepEqual(w.run('echo %ERRORLEVEL%'), ['0'], 'echo itself succeeded');
  assert.deepEqual(w.run('type nombres.txt | find "Eva" > nul & echo %ERRORLEVEL%'), ['0'], '%ERRORLEVEL% is expanded before the line runs');
  assert.deepEqual(w.run('type nombres.txt | findstr /i "^a lopez$"'), ['ana', 'Ana María']);
  assert.deepEqual(w.run('findstr /n /c:"Bea L" nombres.txt'), ['3:Bea López']);
  assert.deepEqual(w.run('findstr "x" nada.txt'), ['FINDSTR: Cannot open nada.txt']);
  file(w, 'raros.txt', ['*nota', 'a**b']);
  assert.deepEqual(w.run('findstr "*nota" raros.txt'), ['*nota'], 'a leading * is literal');
  assert.deepEqual(w.run('findstr "^*" raros.txt'), ['*nota']);
  assert.deepEqual(w.run('findstr "[z-a]" raros.txt'), ['FINDSTR: Bad command line'], 'a bad class is an error, not a crash');
  assert.deepEqual(w.run('type nombres.txt | sort'), ['ana', 'Ana María', 'Bea López', 'Luis']);
  assert.deepEqual(w.run('sort /r < nombres.txt'), ['Luis', 'Bea López', 'Ana María', 'ana']);
  assert.deepEqual(w.run('type nombres.txt | sort | more > orden.txt & type orden.txt'), ['ana', 'Ana María', 'Bea López', 'Luis']);
  assert.deepEqual(w.run('dir /b | find "orden"'), ['orden.txt']);
});

test('set /p: a typed answer at the prompt and in a batch file, < input and the no-newline idiom', () => {
  const w = win();
  assert.deepEqual(w.run('set /p NOMBRE=¿Cómo te llamas? '), []);
  assert.equal(w.prompt(), '¿Cómo te llamas? ');
  assert.deepEqual(w.run('Ana López'), []);
  assert.deepEqual(w.run('echo Hola %NOMBRE%'), ['Hola Ana López']);
  file(w, 'pide.bat', ['@echo off', 'set /p EDAD=Edad: ', 'call :doble', 'echo fin', 'exit /b', ':doble', 'set /p X=Otro: ', 'set /a D=EDAD*2', 'echo %D% %X%']);
  assert.deepEqual(w.run('pide'), []);
  assert.equal(w.prompt(), 'Edad: ');
  assert.deepEqual(w.run('21'), []);
  assert.equal(w.prompt(), 'Otro: ', 'a call :label waits too and goes on after');
  assert.deepEqual(w.run('y'), ['42 y', 'fin']);
  file(w, 'linea.txt', ['primera', 'segunda']);
  assert.deepEqual(w.run('set /p L=<linea.txt'), []);
  assert.deepEqual(w.run('echo %L%'), ['primera']);
  assert.deepEqual(w.run('<nul set /p =sin salto'), ['sin salto']);
  assert.deepEqual(w.run('set /p'), ['The syntax of the command is incorrect.']);
});

test('set /p: an empty answer keeps the variable and sets errorlevel 1; Ctrl+C stops the batch file', () => {
  const w = win();
  w.run('set V=antes');
  w.run('set /p V=? ');
  w.run('');
  assert.deepEqual(w.run('echo %V% %ERRORLEVEL%'), ['antes 1']);
  file(w, 'para.bat', ['@echo off', 'set /p R=Sigo? ', 'echo no debe salir']);
  w.run('para');
  assert.equal(w.prompt(), 'Sigo? ');
  w.interrupt?.();
  assert.notEqual(w.prompt(), 'Sigo? ');
  assert.deepEqual(w.run('echo ok'), ['ok']);
});

test('for /f: a file, a "string" and a \'command\', with tokens, delims, skip and usebackq', () => {
  const w = win();
  file(w, 'notas.csv', ['alumno,nota', 'Ana,9', 'Luis,6']);
  assert.deepEqual(w.run('for /f "skip=1 tokens=1,2 delims=," %a in (notas.csv) do echo %a: %b'), ['Ana: 9', 'Luis: 6']);
  assert.deepEqual(w.run('for /f "tokens=2" %w in ("uno dos tres") do echo %w'), ['dos']);
  assert.deepEqual(w.run('for /f %f in (\'dir /b *.csv\') do echo [%f]'), ['[notas.csv]']);
  assert.deepEqual(w.run('for /f "usebackq tokens=*" %l in (`type notas.csv ^| find "Luis"`) do echo %l'), ['Luis,6']);
  w.run('ren notas.csv "mis notas.csv"');
  assert.deepEqual(w.run('for /f "usebackq skip=2 delims=," %n in ("mis notas.csv") do echo %n'), ['Luis']);
  assert.deepEqual(w.run('for /f %x in (falta.txt) do echo %x'), ['The system cannot find the file falta.txt.']);
  file(w, 'cuenta.bat', ['@echo off', 'set N=0', 'for /f "skip=1" %%l in (\'type "mis notas.csv"\') do set /a N+=1', 'echo %N% filas']);
  assert.deepEqual(w.run('cuenta'), ['2 filas']);
});
