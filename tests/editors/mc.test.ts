/** Midnight Commander: panels, operations through the user's shell, viewer, editor, and running over SSH. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import type { KeyInput } from '../../src/editors/buffer.ts';
import { parseIp } from '../../src/core/ip.ts';

const W = 80;
const H = 24;
const screen = (sh: ShellSession): string[] => (sh.screenFrame?.(W, H)?.rows ?? []).map((r) => r.map((s) => s.text).join(''));
const press = (sh: ShellSession, ...keys: (string | KeyInput)[]): string[] =>
  keys.flatMap((k) => sh.screenKey?.(typeof k === 'string' ? { key: k } : k) ?? []);
const type = (sh: ShellSession, text: string): void => { for (const ch of text) press(sh, ch); };

function pc(): { t: Topology; host: Pc; sh: ShellSession } {
  const t = new Topology();
  const host = t.add('pc', 0, 0).device as Pc;
  const sh = createShell(host, 'linux');
  sh.run('mkdir -p docs dest && printf "uno\\ndos\\n" > docs/a.txt && printf "x" > b.txt');
  return { t, host, sh };
}

test('mc opens two panels with the menu, the command line and the function keys', () => {
  const { sh } = pc();
  assert.deepEqual(sh.run('mc'), []);
  const rows = screen(sh);
  assert.equal(rows.length, H);
  assert.match(rows[0] ?? '', /^ {2}Left {5}File {5}Command/);
  assert.match(rows[1] ?? '', /^┌─+ ~ ─+┐┌─+ ~ ─+┐$/);
  assert.match(rows[2] ?? '', /\.n {3}Name/);
  assert.match(rows[3] ?? '', /^│\/\.\. +│UP--DIR│/);
  assert.ok(rows.some((r) => /^│\/docs +│ +DIR│/.test(r)));
  assert.ok(rows.some((r) => /^│ b\.txt +│ +1│/.test(r)));
  assert.equal(rows[H - 2]?.trimEnd(), 'alumno@pc0:~$');
  assert.match(rows[H - 1] ?? '', /^1Help +2Menu +3View +4Edit +5Copy/);
});

test('F7 creates a directory, F5 copies to the other panel, F8 deletes, F10 quits', () => {
  const { host, sh } = pc();
  sh.run('mc');
  const fs = hostSystem(host).fs;
  press(sh, 'F7');
  assert.ok(screen(sh).some((r) => r.includes('Create a new Directory')));
  type(sh, 'nuevo');
  press(sh, 'Enter');
  assert.equal(fs.tryLookup('/home/alumno/nuevo')?.kind, 'dir');
  press(sh, 'Tab', 'ArrowDown', 'Enter', 'Tab');
  assert.match(screen(sh)[1] ?? '', /~\/dest/, 'the right panel shows ~/dest');
  press(sh, 'End');
  assert.match(screen(sh)[screen(sh).length - 4] ?? '', /b\.txt/, 'the mini-status shows the file under the cursor');
  press(sh, 'F5');
  assert.ok(screen(sh).some((r) => /Copy "b\.txt" to:/.test(r)));
  press(sh, 'Enter');
  assert.equal(fs.readFile('/home/alumno/dest/b.txt'), 'x');
  press(sh, 'F8');
  assert.ok(screen(sh).some((r) => r.includes('Delete file "b.txt"?')));
  press(sh, 'Enter');
  assert.equal(fs.exists('/home/alumno/b.txt'), false);
  press(sh, 'Escape', '0');
  assert.ok(screen(sh).some((r) => r.includes('Do you really want to quit')));
  assert.deepEqual(press(sh, 'Enter'), []);
  assert.equal(sh.screenFrame?.(W, H), null);
  assert.deepEqual(sh.run('echo $?; ls --color=never'), ['0', 'dest  docs  nuevo']);
});

test('errors are shown in a dialog: no permission to copy into /etc', () => {
  const { sh } = pc();
  sh.run('mc ~ /etc');
  press(sh, 'End', 'F5');
  press(sh, 'Enter');
  const rows = screen(sh);
  assert.ok(rows.some((r) => r.includes(' Error ')));
  assert.ok(rows.some((r) => /cp: cannot create regular file '\/etc\/b\.txt': Permission/.test(r)));
  press(sh, 'Enter');
  assert.ok(!screen(sh).some((r) => r.includes(' Error ')));
});

test('F3 views and F4 edits with nano, saving with the user rights', () => {
  const { host, sh } = pc();
  sh.run('mc docs');
  press(sh, 'ArrowDown', 'F3');
  assert.match(screen(sh)[0] ?? '', /\/home\/alumno\/docs\/a\.txt +Line: 1\/3/);
  assert.equal(screen(sh)[1]?.trimEnd(), 'uno');
  press(sh, 'q', 'F4');
  assert.match(screen(sh)[0] ?? '', /GNU nano 8\.4 +a\.txt/);
  type(sh, 'cero ');
  press(sh, { key: 'o', ctrl: true }, 'Enter', { key: 'x', ctrl: true });
  assert.equal(hostSystem(host).fs.readFile('/home/alumno/docs/a.txt'), 'cero uno\ndos\n');
  assert.match(screen(sh)[0] ?? '', /Left/, 'back in the panels');
});

test('mc works through SSH: frames and keys travel in the session', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const client = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: client.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  client.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  t.settle();
  const sh = createShell(client, 'linux');
  sh.run('ssh admin@10.0.0.2');
  sh.run('cisco');
  sh.run('mkdir remoto; mc');
  assert.match(screen(sh)[H - 2] ?? '', /^admin@server0:~\$/);
  assert.ok(screen(sh).some((r) => /\/remoto/.test(r)));
  press(sh, 'F7');
  type(sh, 'otro');
  press(sh, 'Enter', 'F10', 'Enter');
  assert.equal(sh.screenFrame?.(W, H), null);
  assert.deepEqual(sh.run('ls --color=never'), ['otro  remoto']);
  assert.equal(hostSystem(srv).fs.tryLookup('/home/admin/otro')?.kind, 'dir');
});
