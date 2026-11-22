/**
 * Midnight Commander's command line: what is typed on the panels goes to the prompt under them, and Enter runs it in the
 * shell from the active panel's folder, as mc does. Its output shows until a key is pressed; a cd moves the panel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import type { KeyInput } from '../../src/editors/buffer.ts';

const screen = (sh: ShellSession): string[] => (sh.screenFrame?.(80, 24)?.rows ?? []).map((r) => r.map((s) => s.text).join(''));
const press = (sh: ShellSession, ...keys: (string | KeyInput)[]): void => { for (const k of keys) sh.screenKey?.(typeof k === 'string' ? { key: k } : k); };
const type = (sh: ShellSession, text: string): void => { for (const ch of text) press(sh, ch); };

function pc(os: 'linux' | 'windows'): ShellSession {
  const t = new Topology();
  const host = t.add('pc', 0, 0).device as Pc;
  host.os = os;
  const sh = createShell(host, os);
  sh.run(os === 'linux' ? 'mkdir -p docs' : 'mkdir docs');
  return sh;
}

test('GNU/Linux: typing on the panels goes to the command line, Backspace takes it back', () => {
  const sh = pc('linux');
  sh.run('mc');
  type(sh, 'echo hola');
  press(sh, 'Backspace');
  assert.equal(screen(sh)[22]?.trimEnd(), 'alumno@PC0:~$ echo hol');
  assert.equal(sh.screenFrame?.(80, 24)?.cursor?.col, 'alumno@PC0:~$ echo hol'.length, 'the cursor after the text');
});

test('GNU/Linux: Enter runs the line from the panel\'s folder; its output stays until a key, then the panels come back', () => {
  const sh = pc('linux');
  sh.run('mc');
  type(sh, 'echo hola > nuevo.txt; echo hecho; pwd');
  press(sh, 'Enter');
  const out = screen(sh).join('\n');
  assert.match(out, /hecho\n\/home\/alumno/);
  assert.match(out, /Press any key to continue/);
  press(sh, 'x');
  const rows = screen(sh);
  assert.ok(rows.some((r) => /│ nuevo\.txt +│/.test(r)), 'the panels read their folders again');
  assert.equal(rows[22]?.trimEnd(), 'alumno@PC0:~$', 'the command line is empty again');
  press(sh, 'F10', 'Enter');
  assert.equal(sh.run('cat nuevo.txt').join('\n'), 'hola');
});

test('GNU/Linux: cd on the command line moves the active panel; Enter with nothing typed still opens the entry', () => {
  const sh = pc('linux');
  sh.run('mc');
  type(sh, 'cd docs');
  press(sh, 'Enter');
  assert.equal(screen(sh)[22]?.trimEnd(), 'alumno@PC0:~/docs$', 'no output: straight back to the panels, now in docs');
  assert.match(screen(sh)[1] ?? '', /~\/docs/);
  press(sh, 'Enter'); // on «..»
  assert.equal(screen(sh)[22]?.trimEnd(), 'alumno@PC0:~$');
});

test('Windows: mc.exe runs the line with cmd.exe from the panel\'s folder, and cd moves the panel', () => {
  const sh = pc('windows');
  sh.run('mc.exe');
  type(sh, 'echo hola> nuevo.txt');
  press(sh, 'Enter'); // nothing printed: straight back to the panels
  assert.ok(screen(sh).some((r) => /│ nuevo\.txt +│/.test(r)));
  type(sh, 'cd docs');
  press(sh, 'Enter');
  assert.equal(screen(sh)[22]?.trimEnd(), 'C:\\Users\\user\\docs>');
  press(sh, 'F10', 'Enter');
  assert.deepEqual(sh.run('cd'), ['C:\\Users\\user'], 'the shell\'s own folder is as it was');
});
