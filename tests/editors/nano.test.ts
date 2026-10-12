import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NanoEditor } from '../../src/editors/nano.ts';
import { keys, screen, spec, disk } from './helpers.ts';

const W = 80;
const H = 12;

test('nano draws the title bar, the text, the status line and two shortcut rows', () => {
  const ed = new NanoEditor(spec('uno\ndos\n'), disk());
  const rows = screen(ed.frame(W, H));
  assert.equal(rows.length, H);
  assert.match(rows[0] ?? '', /^ {2}GNU nano 8\.4 +notas\.txt$/);
  assert.deepEqual(rows.slice(1, 3), ['uno', 'dos']);
  assert.match(rows[H - 3] ?? '', /\[ Read 2 lines \]/);
  assert.match(rows[H - 2] ?? '', /^\^G Help +\^O Write Out/);
  assert.match(rows[H - 1] ?? '', /^\^X Exit/);
  assert.deepEqual(ed.frame(W, H).cursor, { row: 1, col: 0 });
});

test('typing marks the buffer Modified; ^O writes it with a [ Wrote N lines ] message', () => {
  const io = disk();
  const ed = new NanoEditor(spec('', { exists: false }), io);
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /\[ New File \]/);
  keys(ed, 'hola<CR>mundo');
  assert.match(screen(ed.frame(W, H))[0] ?? '', /Modified$/);
  keys(ed, '<C-o>');
  assert.equal(screen(ed.frame(W, H))[H - 3], 'File Name to Write: /home/alumno/notas.txt');
  keys(ed, '<CR>');
  assert.deepEqual(io.saves, [['/home/alumno/notas.txt', 'hola\nmundo\n']]);
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /\[ Wrote 2 lines \]/);
  assert.doesNotMatch(screen(ed.frame(W, H))[0] ?? '', /Modified/);
});

test('^X on a modified buffer asks to save: N discards, Y + Enter writes and exits, ^C cancels', () => {
  const io = disk();
  const a = new NanoEditor(spec('x\n'), io);
  keys(a, 'y<C-x>');
  assert.equal(screen(a.frame(W, H))[H - 3], 'Save modified buffer?');
  assert.match(screen(a.frame(W, H))[H - 2] ?? '', /Y Yes/);
  keys(a, '<C-c>');
  assert.equal(a.closed, false);
  keys(a, '<C-x>n');
  assert.equal(a.closed, true);
  assert.deepEqual(io.saves, []);
  const b = new NanoEditor(spec('x\n'), io);
  keys(b, 'z<C-x>y<CR>');
  assert.equal(b.closed, true);
  assert.deepEqual(io.saves, [['/home/alumno/notas.txt', 'zx\n']]);
});

test('write errors are reported like nano and the editor stays open', () => {
  const ed = new NanoEditor(spec('a\n', { path: '/etc/hosts', readOnly: true }), disk('Permission denied'));
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /File '\/etc\/hosts' is unwritable/);
  keys(ed, 'b<C-x>y<CR>');
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /\[ Error writing \/etc\/hosts: Permission denied \]/);
  assert.equal(ed.closed, false);
});

test('cut and paste whole lines (consecutive ^K accumulate), undo and redo', () => {
  const ed = new NanoEditor(spec('1\n2\n3\n'), disk());
  keys(ed, '<C-k><C-k><Down><C-u>');
  assert.deepEqual(screen(ed.frame(W, H)).slice(1, 4), ['3', '1', '2']);
  keys(ed, '<M-u>');
  assert.deepEqual(screen(ed.frame(W, H)).slice(1, 3), ['3', '']);
  keys(ed, '<M-e>');
  assert.deepEqual(screen(ed.frame(W, H)).slice(1, 4), ['3', '1', '2']);
});

test('Where Is, Replace (one by one and All), Go To Line and Location', () => {
  const ed = new NanoEditor(spec('gato perro\ngato\nfin\n'), disk());
  keys(ed, '<C-w>perro<CR>');
  assert.deepEqual(ed.frame(W, H).cursor, { row: 1, col: 5 });
  keys(ed, '<C-w>nada<CR>');
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /\[ "nada" not found \]/);
  keys(ed, '<C-\\>gato<CR>leon<CR>');
  assert.equal(screen(ed.frame(W, H))[H - 3], 'Replace this instance?');
  keys(ed, 'a');
  assert.deepEqual(screen(ed.frame(W, H)).slice(1, 3), ['leon perro', 'leon']);
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /\[ Replaced 2 occurrences \]/);
  keys(ed, '<C-/>3<CR><C-c>');
  assert.match(screen(ed.frame(W, H))[H - 3] ?? '', /\[ line 3\/4 \(75%\), col 1\/4 \(25%\), char 16\/20 \(80%\) \]/);
});

test('help screen and long lines scroll horizontally', () => {
  const ed = new NanoEditor(spec(`${'x'.repeat(100)}\n`), disk());
  keys(ed, '<End>');
  const f = ed.frame(40, H);
  assert.match(screen(f)[1] ?? '', /^</);
  assert.ok((f.cursor?.col ?? 99) < 40);
  keys(ed, '<C-g>');
  assert.match(screen(ed.frame(W, H))[1] ?? '', /Main nano help text/);
  keys(ed, '<C-x>');
  assert.equal(ed.closed, false);
  assert.match(screen(ed.frame(W, H))[0] ?? '', /notas\.txt/);
});
