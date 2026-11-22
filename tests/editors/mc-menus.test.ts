/** Midnight Commander's menu bar (F9), its dialogs, its setup file and its shortcuts, in mc's own Spanish and English. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import type { KeyInput } from '../../src/editors/buffer.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import { MC_MENUS } from '../../src/editors/mc-menu.ts';
import { MC_ES } from '../../src/editors/mc-es.ts';

const W = 80;
const H = 24;
const screen = (sh: ShellSession): string[] => (sh.screenFrame?.(W, H)?.rows ?? []).map((r) => r.map((s) => s.text).join(''));
const press = (sh: ShellSession, ...keys: (string | KeyInput)[]): void => { for (const k of keys) sh.screenKey?.(typeof k === 'string' ? { key: k } : k); };
const type = (sh: ShellSession, text: string): void => { for (const ch of text) press(sh, ch); };
const has = (sh: ShellSession, text: string): boolean => screen(sh).some((r) => r.includes(text));
const ctrl = (key: string): KeyInput => ({ key, ctrl: true });
const alt = (key: string): KeyInput => ({ key, alt: true });
const stacked = (sh: ShellSession): number => screen(sh).filter((r) => /^┌─+ ~ ─+┐$/.test(r)).length;
/** F9 (the left panel's menu, Left), `right` menus further on, then an item's hotkey. */
const menu = (sh: ShellSession, right: number, hotkey: string): void => press(sh, 'F9', ...Array<string>(right).fill('ArrowRight'), hotkey);
const OPTIONS = 3;
const COMMAND = 2;

function pc(os: 'linux' | 'windows' = 'linux'): { host: Pc; sh: ShellSession } {
  const t = new Topology();
  const host = t.add('pc', 0, 0).device as Pc;
  const sh = createShell(host, 'linux');
  sh.run('mkdir -p docs dest && printf "uno\\ndos\\n" > docs/a.txt && printf "x" > b.txt && printf "yy" > c.txt');
  return { host, sh: os === 'linux' ? sh : createShell(host, 'windows') };
}

test('every menu title and item has its Spanish text from mc\'s translation', () => {
  for (const m of MC_MENUS) {
    assert.ok(MC_ES[m.title], m.title);
    for (const x of m.items) if (x) assert.ok(MC_ES[x.label], x.label);
  }
});

test('F9 opens the active panel\'s menu; arrows move between menus, Esc closes', () => {
  const { sh } = pc();
  sh.run('mc .');
  press(sh, 'F9');
  assert.ok(has(sh, 'forMato de listado...') && has(sh, 'conexión por FTP...'), 'Izquierdo');
  press(sh, 'ArrowRight');
  assert.ok(has(sh, 'cambiar Permisos...') && has(sh, 'C-x c'), 'Archivo, with its shortcuts');
  press(sh, 'ArrowRight', 'ArrowRight');
  assert.ok(has(sh, 'Presentación...') && has(sh, 'Guardar configuración'), 'Opciones');
  press(sh, 'Escape');
  assert.ok(!has(sh, 'Presentación...'));
  // The right panel's menu is Derecho; an item's hotkey runs it: Utilidades › Intercambiar paneles.
  press(sh, 'Tab', 'ArrowDown', 'Enter', 'Tab');
  assert.match(screen(sh)[1] ?? '', /^┌─+ ~ ─+┐┌─+ ~\/dest ─+┐$/);
  menu(sh, COMMAND, 'i');
  assert.match(screen(sh)[1] ?? '', /^┌─+ ~\/dest ─+┐┌─+ ~ ─+┐$/, 'the panels swapped');
});

test('Options › Layout: the split, the menu bar and the key bar; Save setup writes mc\'s ini, read when mc starts', () => {
  const { host, sh } = pc();
  sh.run('mc .');
  menu(sh, OPTIONS, 'p');
  assert.ok(has(sh, 'Disposición de paneles') && has(sh, '(*) Vertical') && has(sh, '( ) Horizontal'));
  press(sh, 'ArrowDown', ' ', 'Enter');
  assert.equal(stacked(sh), 2, 'one over the other');
  menu(sh, OPTIONS, 'g');
  assert.ok(has(sh, 'Configuración guardada en /home/alumno/.config/mc/ini'));
  press(sh, 'Enter');
  assert.match(hostSystem(host).fs.readFile('/home/alumno/.config/mc/ini'), /\[Layout\]\nhorizontal_split=true\nmenubar_visible=true/);
  press(sh, 'F10', 'Enter');
  sh.run('mc .');
  assert.equal(stacked(sh), 2, 'read again when mc starts');
  menu(sh, OPTIONS, 'p');
  press(sh, 'ArrowDown', 'ArrowDown', ' ', 'ArrowDown', ' ', 'Enter');
  assert.doesNotMatch(screen(sh)[0] ?? '', /aRriba/, 'no menu bar');
  assert.doesNotMatch(screen(sh).join('\n'), /1Ayuda/, 'no key bar');
  press(sh, 'F9');
  assert.match(screen(sh)[0] ?? '', /^ {2}aRriba +Archivo +Utilidades +Opciones +aBajo/, 'F9 still shows it; one over the other, Left and Right are Above and Below');
});

test('Alt+, and Esc , switch the split for the session, without writing the setup', () => {
  const { host, sh } = pc();
  sh.run('mc .');
  press(sh, alt(','));
  assert.equal(stacked(sh), 2);
  press(sh, 'Escape', ',');
  assert.match(screen(sh)[1] ?? '', /^┌─+ ~ ─+┐┌─+ ~ ─+┐$/);
  press(sh, alt(','), 'F10', 'Enter');
  assert.equal(hostSystem(host).fs.exists('/home/alumno/.config/mc/ini'), false);
});

test('Options: confirmation off quits at once; panel options hide dot files', () => {
  const { sh } = pc();
  sh.run('touch .oculto && mc .');
  assert.ok(screen(sh).some((r) => r.includes('.oculto')));
  menu(sh, OPTIONS, 'l');
  press(sh, ' ', 'Enter');
  assert.ok(!screen(sh).some((r) => r.includes('.oculto')), 'mostrar archivos Ocultos off');
  menu(sh, OPTIONS, 'o');
  assert.ok(has(sh, '[x] Borrar') && has(sh, '[x] saliR'), 'mc\'s Spanish shows the hotkey as a capital');
  press(sh, 'r', 'Enter', 'F10');
  assert.equal(sh.screenFrame?.(W, H), null, 'no question');
});

test('File: select group (+), invert (*), chmod (C-x c), symlink (C-x s), quick cd (M-c), as the user', () => {
  const { host, sh } = pc();
  const fs = hostSystem(host).fs;
  sh.run('cp b.txt docs/ && touch docs/d.txt && mc docs');
  press(sh, '+');
  assert.ok(has(sh, 'Seleccionar grupo'));
  press(sh, 'Backspace');
  type(sh, '?.txt');
  press(sh, 'Enter');
  assert.ok(has(sh, '3 marcados'), 'a.txt, b.txt and d.txt');
  press(sh, '*');
  assert.ok(!has(sh, 'marcados'), 'invert: no file left marked');
  press(sh, 'Escape', 'c');
  type(sh, '~');
  press(sh, 'Enter');
  press(sh, 'End', ctrl('x'), 'c');
  assert.ok(has(sh, 'Comando Chmod'));
  type(sh, '600');
  press(sh, 'Enter');
  assert.equal((fs.stat('/home/alumno/c.txt').mode & 0o777).toString(8), '600');
  press(sh, ctrl('x'), 's');
  assert.ok(has(sh, 'Nombre del nuevo enlace simbólico:'));
  press(sh, 'Enter');
  assert.equal(fs.tryLookup('/home/alumno/docs/c.txt', undefined, false)?.kind, 'link', 'into the other panel');
  assert.equal(fs.readFile('/home/alumno/docs/c.txt'), 'yy');
  press(sh, 'Escape', 'c');
  assert.ok(has(sh, 'Cambiar directorio'));
  type(sh, '/etc');
  press(sh, 'Enter');
  assert.match(screen(sh)[1] ?? '', /─ \/etc ─/);
  press(sh, 'End', ctrl('x'), 'c', '7', '7', '7', 'Enter');
  assert.ok(has(sh, ' Error '), 'not root: chmod refuses');
});

test('Command: history (M-h), hotlist (C-\\), compare directories (C-x d), directory sizes (C-Space), find file (M-?)', () => {
  const { sh } = pc();
  sh.run('cp c.txt dest/ && printf "z" > dest/b.txt && mc .');
  type(sh, 'echo hola');
  press(sh, 'Enter', 'x', alt('h'));
  assert.ok(has(sh, 'echo hola'));
  press(sh, 'Enter');
  assert.match(screen(sh)[H - 2]?.trimEnd() ?? '', /echo hola$/, 'back on the command line');
  press(sh, ...Array<string>('echo hola'.length).fill('Backspace'), ctrl('\\'));
  assert.ok(has(sh, 'añaDir actual'));
  press(sh, 'Enter', ctrl('\\'));
  assert.ok(has(sh, '/home/alumno'), 'the folder added');
  press(sh, 'Escape', 'Tab', 'ArrowDown', 'Enter', 'Tab', ctrl('x'), 'd');
  assert.ok(has(sh, 'Comparar directorios') && has(sh, '(*) Rápido'));
  press(sh, 'Enter');
  assert.ok(has(sh, 'marcados'), 'files only on one side, or different');
  press(sh, 'Home', 'ArrowDown', ctrl(' '));
  assert.ok(screen(sh).some((r) => /\/dest +│ +3│/.test(r)), 'dest holds 3 bytes');
  press(sh, alt('?'), 'Backspace');
  type(sh, '*.txt');
  press(sh, 'Enter');
  assert.ok(has(sh, './docs/a.txt'));
});

test('Left/Right: sort order, filter, brief listing, quick view and info', () => {
  const { sh } = pc();
  sh.run('mc .');
  press(sh, 'F9', 'o');
  assert.ok(has(sh, 'Ordenar') && has(sh, '(*) Nombre') && has(sh, '[ ] inveRtir'));
  press(sh, 'Escape', 'F9', 'f', 'Backspace');
  type(sh, 'c*');
  press(sh, 'Enter');
  const left = screen(sh).map((r) => r.slice(0, W / 2));
  assert.ok(!left.some((r) => /│ b\.txt/.test(r)) && left.some((r) => /│ c\.txt/.test(r)), 'only c.txt left in that panel');
  press(sh, 'F9', 'm', 'b', 'Enter');
  assert.match(screen(sh)[2] ?? '', /^│\.n {2}Nombre +│Nombre/, 'Brief: two columns of names');
  press(sh, 'End', ctrl('x'), 'q');
  assert.ok(has(sh, 'yy'), 'the right panel shows the file');
  press(sh, ctrl('x'), 'q', ctrl('x'), 'i');
  assert.ok(has(sh, 'c.txt') && has(sh, 'Modificado:'), 'Info');
});

test('what has nothing to act on in Netfix says so, in mc\'s words', () => {
  const { sh } = pc();
  sh.run('mc .');
  press(sh, 'F9', 'p');
  assert.ok(has(sh, 'No implementado todavía'), 'Izquierdo › conexión por FTP');
  press(sh, 'Enter', 'F2');
  assert.ok(has(sh, 'No implementado todavía'), 'F2: the user menu');
});

test('in English: menus, dialogs and key bar in mc\'s own English', () => {
  setLocale('en-GB');
  try {
    const { sh } = pc();
    sh.run('mc .');
    assert.match(screen(sh)[0] ?? '', /^ {2}Left {5}File {5}Command {5}Options {5}Right/);
    assert.match(screen(sh)[H - 1] ?? '', /^1Help +2Menu +3View +4Edit +5Copy +6RenMov +7Mkdir +8Delete +9PullDn +10Quit/);
    menu(sh, OPTIONS, 'l');
    assert.ok(has(sh, 'Panel split') && has(sh, '(*) Vertical'));
  } finally {
    setLocale('es-ES');
  }
});

test('Windows: the ini under %APPDATA%; chmod and links are not there', () => {
  const { host, sh } = pc('windows');
  sh.prompt();
  sh.run('mc.exe .');
  menu(sh, OPTIONS, 'g');
  press(sh, 'Enter');
  assert.ok(hostSystem(host).fs.exists('/mnt/c/Users/user/AppData/Roaming/Midnight Commander/ini'));
  press(sh, ctrl('x'), 'c');
  assert.ok(has(sh, 'No implementado todavía'));
});
