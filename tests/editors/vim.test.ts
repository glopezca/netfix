import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VimEditor } from '../../src/editors/vim.ts';
import { keys, screen, spec, disk } from './helpers.ts';

const W = 60;
const H = 8;
const vim = (content: string, extra = {}, io = disk()): VimEditor => new VimEditor(spec(content, { editor: 'vim', ...extra }), io);
const text = (ed: VimEditor): string => ed.buf.text();
const last = (ed: VimEditor): string => screen(ed.frame(W, H))[H - 1] ?? '';

test('vim shows the file, ~ rows, the file message and the ruler', () => {
  const ed = vim('uno\ndos\n');
  const rows = screen(ed.frame(W, H));
  assert.deepEqual(rows.slice(0, 3), ['uno', 'dos', '~']);
  assert.match(rows[H - 1] ?? '', /^"\/home\/alumno\/notas\.txt" 2L, 8B +1,1 +All$/);
  assert.match(last(vim('', { exists: false })), /^"\/home\/alumno\/notas\.txt" \[New\] +0,0-1 +All$/);
  assert.match(last(vim('a\n', { readOnly: true })), /\[readonly\] 1L, 2B/);
});

test('insert mode, Esc, :wq writes "file" NL, NB written and closes', () => {
  const io = disk();
  const ed = vim('', { exists: false }, io);
  keys(ed, 'ihola');
  assert.match(last(ed), /^-- INSERT --/);
  keys(ed, '<CR>mundo<Esc>:wq');
  assert.equal(last(ed), ':wq');
  keys(ed, '<CR>');
  assert.deepEqual(io.saves, [['/home/alumno/notas.txt', 'hola\nmundo\n']]);
  assert.equal(ed.closed, true);
});

test(':q refuses with E37 when modified; :q! quits; ZZ writes', () => {
  const ed = vim('a\n');
  keys(ed, 'x:q<CR>');
  assert.match(last(ed), /^E37: No write since last change \(add ! to override\)/);
  assert.equal(ed.closed, false);
  keys(ed, ':q!<CR>');
  assert.equal(ed.closed, true);
  const io = disk();
  const zz = vim('a\n', {}, io);
  keys(zz, 'AB<Esc>ZZ');
  assert.deepEqual(io.saves, [['/home/alumno/notas.txt', 'aB\n']]);
  assert.equal(zz.closed, true);
});

test('readonly files warn on change and refuse :w without !', () => {
  const ed = vim('a\n', { readOnly: true, path: '/etc/hosts' }, disk("Permission denied"));
  keys(ed, 'ix');
  assert.match(last(ed), /W10: Warning: Changing a readonly file/);
  keys(ed, '<Esc>:w<CR>');
  assert.match(last(ed), /^E45: 'readonly' option is set \(add ! to override\)/);
  keys(ed, ':w!<CR>');
  assert.match(last(ed), /^"\/etc\/hosts" E212: Can't open file for writing/);
});

test('operators with counts and motions: dd, 2dw, cw, yy p, D, x, J, r, ~ and .', () => {
  const ed = vim('uno dos tres\ncuatro\ncinco\n');
  keys(ed, 'dw');
  assert.equal(text(ed), 'dos tres\ncuatro\ncinco\n');
  keys(ed, 'cwDOS<Esc>');
  assert.equal(text(ed), 'DOS tres\ncuatro\ncinco\n');
  keys(ed, 'jyyP');
  assert.equal(text(ed), 'DOS tres\ncuatro\ncuatro\ncinco\n');
  keys(ed, 'dd.');
  assert.equal(text(ed), 'DOS tres\ncinco\n');
  keys(ed, 'ggJ');
  assert.equal(text(ed), 'DOS tres cinco\n');
  keys(ed, '0rx~');
  assert.equal(text(ed), 'XOS tres cinco\n');
  keys(ed, 'wD');
  assert.equal(text(ed), 'XOS \n');
  keys(ed, '02x');
  assert.equal(text(ed), 'S \n');
  keys(ed, 'u');
  assert.equal(text(ed), 'XOS \n');
  assert.match(last(ed), /1 change; before #\d+/);
  keys(ed, '<C-r>');
  assert.equal(text(ed), 'S \n');
});

test('o/O, A, counts on motions, G/gg, f and $', () => {
  const ed = vim('a\nb\nc\nd\n');
  keys(ed, 'Gox<Esc>ggOy<Esc>');
  assert.equal(text(ed), 'y\na\nb\nc\nd\nx\n');
  keys(ed, '3jAz<Esc>');
  assert.equal(text(ed), 'y\na\nb\ncz\nd\nx\n');
  keys(ed, 'gg2dd');
  assert.equal(text(ed), 'b\ncz\nd\nx\n');
  keys(ed, 'jfzx$');
  assert.equal(text(ed), 'b\nc\nd\nx\n');
});

test('search with / n N, wrap message, E486 and :%s', () => {
  const ed = vim('gato\nperro\ngato\n');
  keys(ed, '/gato<CR>');
  assert.equal(ed.buf.row, 2);
  keys(ed, 'n');
  assert.equal(ed.buf.row, 0);
  assert.match(last(ed), /search hit BOTTOM, continuing at TOP/);
  keys(ed, '/nada<CR>');
  assert.match(last(ed), /E486: Pattern not found: nada/);
  keys(ed, ':%s/gato/leon/g<CR>');
  assert.equal(text(ed), 'leon\nperro\nleon\n');
  keys(ed, ':foo<CR>');
  assert.match(last(ed), /E492: Not an editor command: foo/);
});

test(':set nu shows line numbers, :N goes to a line and long lines wrap', () => {
  const ed = vim(`${'x'.repeat(70)}\nfin\n`);
  keys(ed, ':set nu<CR>:2<CR>');
  const rows = screen(ed.frame(W, H));
  assert.match(rows[0] ?? '', /^ {2}1 x+$/);
  assert.match(rows[1] ?? '', /^ {4}x+$/);
  assert.match(rows[2] ?? '', /^ {2}2 fin$/);
  assert.deepEqual(ed.frame(W, H).cursor, { row: 2, col: 4 });
  assert.match(last(ed), /2,1 +All$/);
});
