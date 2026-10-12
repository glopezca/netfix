import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnsi, clearRequest, stripAnsi } from '../../src/core/ansi.ts';

test('SGR sequences become styled runs and the state carries to the next line', () => {
  const { runs, style } = parseAnsi('\x1b[01;32malumno@pc0\x1b[00m:\x1b[01;34m~\x1b[00m$ \x1b[31m');
  assert.deepEqual(runs, [
    { bold: true, fg: 2, text: 'alumno@pc0' },
    { text: ':' },
    { bold: true, fg: 4, text: '~' },
    { text: '$ ' },
  ]);
  assert.deepEqual(style, { fg: 1 });
  assert.deepEqual(parseAnsi('rojo', style).runs, [{ fg: 1, text: 'rojo' }]);
});

test('bright, 256-colour, background, inverse and resets; erase-line codes are dropped', () => {
  assert.deepEqual(parseAnsi('\x1b[91;44;7ma\x1b[27;39;49mb').runs, [{ fg: 9, bg: 4, inverse: true, text: 'a' }, { fg: undefined, bg: undefined, inverse: false, text: 'b' }]);
  assert.deepEqual(parseAnsi('\x1b[38;5;208mx\x1b[38;2;1;2;3my').runs, [{ fg: 208, text: 'x' }, { fg: undefined, text: 'y' }]);
  assert.deepEqual(parseAnsi('\x1b[01;31m\x1b[KPS1\x1b[m\x1b[K=').runs, [{ bold: true, fg: 1, text: 'PS1' }, { text: '=' }]);
  assert.deepEqual(parseAnsi('\x1b[1;2;3;4mz\x1b[22;23;24m.').runs, [{ bold: true, dim: true, italic: true, underline: true, text: 'z' }, { bold: false, dim: false, italic: false, underline: false, text: '.' }]);
});

test('clear requests and stripping', () => {
  assert.deepEqual(clearRequest('\x1b[H\x1b[2J\x1b[3Jhola'), { clear: true, after: 'hola' });
  assert.deepEqual(clearRequest('nada'), { clear: false, after: 'nada' });
  assert.equal(stripAnsi('\x01\x1b[1m\x02a\x1b(Bb'), 'ab');
});
