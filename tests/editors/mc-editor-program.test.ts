/**
 * An extension program marked `editor` (shells/programs.ts) is Midnight Commander's editor on the hosts that have it,
 * as mc with use_internal_edit off runs $EDITOR: F4, and Enter on a file that is not a program, open the file with it.
 * Hosts without one keep mc's own editor (nano) and viewer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Host } from '../../src/devices/host.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { registerProgram } from '../../src/shells/programs.ts';
import type { KeyInput } from '../../src/editors/buffer.ts';

const DOC = { synopsis: 'xedit-mc FILE', summary: 'Editor de una extensión.' };
const on = new Set<Host>();
const opened: string[] = [];
registerProgram({
  name: 'xedit-mc', systems: ['linux', 'windows'], editor: true, doc: { es: DOC, en: { ...DOC, summary: 'An extension\'s editor.' } },
  applies: (host) => on.has(host),
  run: (call) => { opened.push(call.files.resolve(call.argv[1] ?? '')); },
});

const screen = (sh: ShellSession): string => (sh.screenFrame?.(80, 24)?.rows ?? []).map((r) => r.map((s) => s.text).join('')).join('\n');
const press = (sh: ShellSession, ...keys: (string | KeyInput)[]): void => { for (const k of keys) sh.screenKey?.(typeof k === 'string' ? { key: k } : k); };

function pc(os: 'linux' | 'windows', withEditor: boolean): ShellSession {
  const t = new Topology();
  const host = t.add('pc', 0, 0).device as Pc;
  if (withEditor) on.add(host);
  host.os = os;
  const sh = createShell(host, os);
  sh.run(os === 'linux' ? 'mkdir -p docs && printf "uno\\n" > docs/a.txt && printf "echo hi\\n" > docs/run.sh && chmod +x docs/run.sh' : 'mkdir docs & echo uno> docs\\a.txt');
  return sh;
}

test('GNU/Linux: F4 and Enter on a text file open it with the editor program, and mc stays on its panels', () => {
  opened.length = 0;
  const sh = pc('linux', true);
  sh.run('mc docs');
  press(sh, 'ArrowDown', 'F4');
  assert.deepEqual(opened, ['/home/alumno/docs/a.txt']);
  assert.doesNotMatch(screen(sh), /GNU nano/, 'not mc\'s own editor');
  press(sh, 'Enter');
  assert.deepEqual(opened, ['/home/alumno/docs/a.txt', '/home/alumno/docs/a.txt']);
  press(sh, 'ArrowDown', 'Enter');
  assert.equal(opened.length, 2, 'a program (run.sh, executable) is not opened in the editor');
});

test('Windows: mc.exe opens a text file with the editor program too', () => {
  opened.length = 0;
  const sh = pc('windows', true);
  sh.run('mc.exe docs');
  press(sh, 'ArrowDown', 'F4');
  assert.deepEqual(opened, ['C:\\Users\\user\\docs\\a.txt']);
});

test('a host without an editor program keeps nano on F4 and the viewer on Enter', () => {
  opened.length = 0;
  const sh = pc('linux', false);
  sh.run('mc docs');
  press(sh, 'ArrowDown', 'Enter');
  assert.match(screen(sh), /Line: 1\/2/, 'the viewer');
  press(sh, 'q', 'F4');
  assert.match(screen(sh), /GNU nano/);
  assert.deepEqual(opened, []);
});
