/** edit of the Windows terminal: typing, Ctrl+S, Ctrl+Q asking to save, find, go to line and read-only files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MsEditEditor } from '../../src/editors/msedit.ts';
import type { KeyInput } from '../../src/editors/buffer.ts';

const typeText = (e: MsEditEditor, text: string): void => { for (const ch of text) e.key({ key: ch === '\n' ? 'Enter' : ch }); };
const ctrl = (key: string): KeyInput => ({ key, ctrl: true });
const screen = (e: MsEditEditor): string[] => e.frame(60, 10).rows.map((r) => r.map((s) => s.text).join(''));

test('Ctrl+S saves, Ctrl+Q closes; with unsaved changes it asks first', () => {
  const saved: string[] = [];
  const e = new MsEditEditor({ editor: 'msedit', path: '/home/alumno/carta.txt', content: '', exists: false, readOnly: false }, { save: (_p, c) => { saved.push(c); return null; } });
  assert.match(screen(e)[0] ?? '', /File {2}Edit {2}View {2}Help.*carta\.txt - Microsoft Edit/);
  typeText(e, 'hola\nred');
  assert.match(screen(e)[0] ?? '', /● carta\.txt/);
  assert.match(screen(e)[9] ?? '', /Ln 2, Col 4/);
  e.key(ctrl('s'));
  assert.deepEqual(saved, ['hola\nred']);
  typeText(e, '!');
  e.key(ctrl('q'));
  assert.equal(e.closed, false);
  assert.match(screen(e)[9] ?? '', /save the changes to carta\.txt\?/);
  e.key({ key: 'Escape' });
  e.key(ctrl('q'));
  e.key({ key: 'y' });
  assert.equal(e.closed, true);
  assert.deepEqual(saved, ['hola\nred', 'hola\nred!']);
});

test('find, go to line, undo and a read-only file', () => {
  const e = new MsEditEditor({ editor: 'msedit', path: '/etc/hostname', content: 'uno\ndos\ntres\n', exists: true, readOnly: true }, { save: () => 'no' });
  assert.match(screen(e)[9] ?? '', /read-only/);
  typeText(e, 'x');
  assert.match(screen(e)[1] ?? '', /^uno/);
  e.key(ctrl('f'));
  typeText(e, 'tres');
  e.key({ key: 'Enter' });
  assert.match(screen(e)[9] ?? '', /Ln 3, Col 1/);
  e.key(ctrl('g'));
  typeText(e, '2');
  e.key({ key: 'Enter' });
  assert.match(screen(e)[9] ?? '', /Ln 2, Col 1/);
  e.key(ctrl('q'));
  assert.equal(e.closed, true, 'nothing to save in a read-only file');
  const w = new MsEditEditor({ editor: 'msedit', path: '/tmp/a', content: 'a\n', exists: true, readOnly: false }, { save: () => null });
  typeText(w, 'b');
  w.key(ctrl('z'));
  assert.match(screen(w)[1] ?? '', /^a /);
  w.key({ key: 'Escape' });
  w.key({ key: 'n' });
  assert.equal(w.closed, true);
});
