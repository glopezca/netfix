/** Codefix on Netfix (D24): a one-PC lab with the starting files, marked by running commands in its bash or cmd.exe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_LAB_DEVICE, codeLab } from '../../src/classroom/code-lab.ts';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { Topology } from '../../src/net/topology.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';

const item = (id: string, command: string, contains: string, shell?: 'bash' | 'cmd'): unknown => ({ id, weight: 1, check: { type: 'run', device: CODE_LAB_DEVICE, command, contains, ...(shell ? { shell } : {}) } });

test('a bash lab: the files in /home/alumno, owned by alumno, and run checks on them', () => {
  const file = codeLab('linux', [{ path: 'suma.sh', content: 'echo $(( $1 + $2 ))\n' }, { path: 'lib/saludo.sh', content: 'echo "Hola, $1"\n' }]);
  const pc = Topology.fromJSON(file).byLabel(CODE_LAB_DEVICE) as Host;
  assert.equal(pc.os, 'linux');
  const sh = createShell(pc, 'linux');
  sh.prompt();
  assert.deepEqual(sh.run('cat lib/saludo.sh'), ['echo "Hola, $1"']);
  assert.deepEqual(sh.run('ls -l suma.sh')[0]?.split(/\s+/).slice(2, 4), ['alumno', 'alumno'], 'the pupil can edit them');
  const e = evaluate(file, parseChecklist([item('a', 'bash suma.sh 2 3', '5'), item('b', 'bash lib/saludo.sh Ana', 'Hola, Ana'), item('c', 'bash suma.sh 1 1', '3')]));
  assert.deepEqual(e.items.map((i) => i.passed), [true, true, false]);
});

test('a DOS lab: the files in C:\\Users\\user and run checks in cmd.exe', () => {
  const file = codeLab('windows', [{ path: 'suma.bat', content: '@echo off\nset /a r=%1+%2\necho %r%\n' }]);
  const e = evaluate(file, parseChecklist([item('a', 'suma 2 3', '5', 'cmd'), item('b', 'type suma.bat | find "set"', 'set /a', 'cmd'), item('c', 'suma 2 2', '5', 'cmd')]));
  assert.deepEqual(e.items.map((i) => i.passed), [true, true, false]);
});

test('run checks are validated, and run only on a PC or server', () => {
  assert.throws(() => parseChecklist([{ id: 'x', weight: 1, check: { type: 'run', device: 'PC', contains: '5' } }]), /command es obligatorio/);
  assert.throws(() => parseChecklist([item('x', 'ls', 'a', 'zsh' as 'bash')]), /shell/);
  assert.throws(() => codeLab('linux', [{ path: '../etc/passwd', content: '' }]), /ruta/);
  assert.throws(() => codeLab('linux', [{ path: '/etc/passwd', content: '' }]), /ruta/);
  const t = new Topology();
  t.add('switch', 0, 0, { label: 'SW' });
  const e = evaluate(t.toJSON(), parseChecklist([{ id: 'x', weight: 1, check: { type: 'run', device: 'SW', command: 'ls', contains: 'a' } }]));
  assert.match(e.items[0]?.detail ?? '', /no es un PC ni un servidor/);
});
