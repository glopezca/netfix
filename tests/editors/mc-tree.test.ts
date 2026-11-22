/** Midnight Commander opened with no folder named: the tree in the left (top) panel, the chosen folder's files beside it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import type { KeyInput } from '../../src/editors/buffer.ts';

const H = 24;
const screen = (sh: ShellSession, w = 80): string[] => (sh.screenFrame?.(w, H)?.rows ?? []).map((r) => r.map((s) => s.text).join(''));
const press = (sh: ShellSession, ...keys: (string | KeyInput)[]): void => { for (const k of keys) sh.screenKey?.(typeof k === 'string' ? { key: k } : k); };
const left = (sh: ShellSession): string[] => screen(sh).map((r) => r.slice(0, 40));
const right = (sh: ShellSession): string[] => screen(sh).map((r) => r.slice(40));

function pc(): { host: Pc; sh: ShellSession } {
  const t = new Topology();
  const host = t.add('pc', 0, 0).device as Pc;
  const sh = createShell(host, 'linux');
  sh.run('mkdir -p docs proyecto/src && printf "uno\\n" > docs/a.txt && printf "x" > b.txt');
  return { host, sh };
}

test('mc with no folder: the tree on the left, open down to the home folder; on the right only its files', () => {
  const { sh } = pc();
  sh.run('mc');
  const tree = left(sh).join('\n');
  assert.match(tree, /│\//, 'from the top folder');
  assert.match(tree, /└─alumno|├─alumno/, 'open down to the home folder');
  assert.match(tree, /docs/);
  assert.match(tree, /proyecto/);
  const files = right(sh);
  assert.match(files[1] ?? '', /~/, 'the right panel shows the home folder');
  assert.ok(files.some((r) => /│ b\.txt/.test(r)), 'its files');
  assert.ok(!files.some((r) => /│\/docs|│\/\.\./.test(r)), 'no folders: they are in the tree');
});

test('moving on the tree changes the other panel; → opens a folder, ← closes it; Enter goes to the files', () => {
  const { host, sh } = pc();
  sh.run('mc');
  press(sh, 'ArrowDown');
  assert.match(right(sh)[1] ?? '', /~\/docs/);
  assert.ok(right(sh).some((r) => /│ a\.txt/.test(r)));
  press(sh, 'ArrowDown', 'ArrowRight');
  assert.ok(left(sh).some((r) => /src/.test(r)), 'proyecto opened');
  press(sh, 'ArrowLeft');
  assert.ok(!left(sh).some((r) => /src/.test(r)), 'and closed');
  press(sh, 'ArrowUp', 'Enter', 'F8', 'Enter');
  assert.equal(hostSystem(host).fs.exists('/home/alumno/docs/a.txt'), false, 'Enter moved to the files: F8 deleted a.txt');
});

test('Left › Tree turns the tree off: two listings again', () => {
  const { sh } = pc();
  sh.run('mc');
  press(sh, 'F9', 'b');
  assert.match(screen(sh)[1] ?? '', /^┌─+ ~ ─+┐┌─+ ~ ─+┐$/);
  assert.ok(right(sh).some((r) => /│\/docs/.test(r)), 'folders back in the other panel');
});

test('Codefix IDE: one over the other, the tree on top and the files below; the menus say Above and Below', () => {
  const { sh } = pc();
  sh.run('mc');
  press(sh, 'Escape', ',');
  const rows = screen(sh, 40);
  assert.match(rows[0] ?? '', /^ {2}aRriba Archivo Utilidades Opciones/, 'Opciones still fits a 40-column panel (the titles close up)');
  const bottom = rows.findIndex((r, i) => i > 2 && /^┌/.test(r));
  assert.ok(bottom > 0 && rows.slice(1, bottom).some((r) => /docs/.test(r)), 'the tree on top');
  assert.ok(rows.slice(bottom).some((r) => /│ b\.txt/.test(r)) && !rows.slice(bottom).some((r) => /│\/docs/.test(r)), 'the files below');
});

test('Options › Panel split (M-,) switches it from the menu', () => {
  const { sh } = pc();
  sh.run('mc .');
  press(sh, 'F9', 'ArrowRight', 'ArrowRight', 'ArrowRight');
  assert.ok(screen(sh).some((r) => /Disposición de paneles +M-,/.test(r)));
  press(sh, 'd');
  assert.equal(screen(sh).filter((r) => /^┌─+ ~ ─+┐$/.test(r)).length, 2);
});

test('Ctrl+R reads both panels again: a file made elsewhere shows beside the tree', () => {
  const { host, sh } = pc();
  sh.run('mc');
  hostSystem(host).fs.writeFile('/home/alumno/nuevo.sh', 'echo');
  press(sh, { key: 'r', ctrl: true });
  assert.ok(right(sh).some((r) => /│ nuevo\.sh/.test(r)));
});
