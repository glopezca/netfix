/** Midnight Commander: panels, operations through the user's shell, viewer, editor, and running over SSH. */
import { mcCredits, MC_COPYRIGHT, MC_RELEASE, MC_SITE } from '../../src/editors/mc-credits.ts';
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
import { setLocale } from '../../src/i18n/locale.ts';
import { aboutInfo } from '../../src/docs/about.ts';

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
  sh.run('yes');
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

test('mc shows the credits of Netfix and the real ones of GNU Midnight Commander (F1 help, F2/F9), in the interface language', () => {
  const { sh } = pc();
  const a = aboutInfo();
  sh.run('mc');
  press(sh, 'F1');
  assert.ok(screen(sh).some((r) => r.includes(`Netfix ${a.version} · © ${a.author}`)), 'help footer');
  press(sh, 'Enter', 'F9');
  const credits = mcCredits().join('\n');
  for (const text of [`Netfix ${a.version}`, `Autoría: ${a.author}`, 'GPL-3.0-or-later', 'github.com/glopezca/netfix',
    `GNU Midnight Commander ${MC_RELEASE}`, MC_COPYRIGHT, 'GNU GPL v3 o posterior', MC_SITE, 'Fundado en 1994 por Miguel de Icaza',
    'Andrew Borodin', 'Yury V. Zaytsev', 'Pavel Roskin', 'Slava Zanko',
    'Traducción al español de mc:', 'David Martin (2011-2013)', 'Ismael Olea (2000)', 'Traducción al inglés británico de mc:', 'Andi Chandler (2016-2025)', 'app.transifex.com/mc/mc']) assert.ok(credits.includes(text), text);
  assert.doesNotMatch(credits, /@/, 'no e-mail addresses');
  // Shown in the scrollable viewer: the first screen and, after End, the last lines.
  assert.ok(screen(sh).join('\n').includes(`Netfix ${a.version}`));
  press(sh, 'End');
  assert.ok(screen(sh).join('\n').includes('q, Esc o F10'));
  assert.ok(mcCredits().every((l) => l.length <= 56), 'lines fit a narrow terminal');
  press(sh, 'q');
  press(sh, 'F10', 'Enter');
  assert.match(sh.run('mc --version')[0] ?? '', new RegExp(`GNU Midnight Commander ${MC_RELEASE.replace(/\./g, '\\.')}`));
  setLocale('en-GB');
  try {
    sh.run('mc');
    press(sh, 'Escape', '2');
    const en = screen(sh).join('\n');
    assert.ok(en.includes(`Author: ${a.author}`));
    assert.ok(mcCredits().join('\n').includes('Founded in 1994 by Miguel de Icaza'));
  } finally {
    setLocale('es-ES');
  }
});
