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

const spans = (e: MsEditEditor, row: number): { text: string; style?: string }[] => [...(e.frame(60, 10).rows[row] ?? [])];

test('the menu bar highlights the access letter of each menu; F10 or Alt+letter opens it', () => {
  const e = new MsEditEditor({ editor: 'msedit', path: '/home/alumno/a.txt', content: 'uno\ndos\ntres\n', exists: true, readOnly: false }, { save: () => null });
  assert.deepEqual(spans(e, 0).filter((s) => s.style === 'hotkey').map((s) => s.text), ['F', 'E', 'V', 'H']);
  e.key({ key: 'F10' });
  assert.match(screen(e)[1] ?? '', /^u Save +Ctrl\+S /, 'File menu over the text, under its title');
  assert.match(screen(e)[2] ?? '', /^d Exit +Ctrl\+Q /);
  assert.deepEqual(spans(e, 1).filter((s) => s.style === 'hotkeySel').map((s) => s.text), ['S'], 'the selected item shows its letter too');
  assert.deepEqual(spans(e, 2).filter((s) => s.style === 'hotkey').map((s) => s.text), ['x']);
  assert.equal(e.frame(60, 10).cursor, null);
  e.key({ key: 'ArrowRight' });
  assert.match(screen(e)[1] ?? '', /Undo +Ctrl\+Z/);
  e.key({ key: 'Escape' });
  assert.match(screen(e)[1] ?? '', /^uno/, 'Esc closes the menu, not the editor');
  assert.equal(e.closed, false);
  e.key({ key: 'v', alt: true });
  e.key({ key: 'e' });
  assert.match(screen(e)[9] ?? '', /Ln 4, Col 1/, 'View > End of file by its letter');
  e.key({ key: 'h', alt: true });
  e.key({ key: 'k' });
  assert.match(screen(e)[9] ?? '', /F10\/Alt menus/);
  e.key({ key: 'f', alt: true });
  e.key({ key: 'ArrowDown' });
  e.key({ key: 'Enter' });
  assert.equal(e.closed, true, 'File > Exit with no changes');
});

test('Alt shortcuts go by the physical key (Option+F types ƒ on a Mac); Cmd+V is left to the browser; menus fit narrow screens', () => {
  const e = new MsEditEditor({ editor: 'msedit', path: '/tmp/a', content: 'x\n', exists: true, readOnly: false }, { save: () => null });
  e.key({ key: 'ƒ', alt: true, code: 'KeyF' });
  assert.match(screen(e)[1] ?? '', /Save/);
  e.key({ key: 'Escape' });
  e.key({ key: 'v', alt: true, meta: true, code: 'KeyV' });
  assert.doesNotMatch(screen(e)[1] ?? '', /Go to line/);
  e.key({ key: 'h', alt: true, code: 'KeyH' });
  const narrow = e.frame(24, 8).rows.map((r) => r.map((s) => s.text).join(''));
  assert.ok(narrow.every((r) => r.length <= 24), 'no row wider than the screen');
  e.key({ key: 'k' });
  assert.match(e.frame(80, 10).rows[9]?.map((s) => s.text).join('') ?? '', /\^Z\/\^Y undo/, 'the whole help fits an 80-column bar');
});
