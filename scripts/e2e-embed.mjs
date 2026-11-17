// End-to-end check of the embedded mode (classroom): netfix.embed with a topology and restrictions, no autosave.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const html = readFileSync(join(root, 'dist/netfix.html'), 'utf8').replace('<div id="app">', '<div id="app" data-embed>');
const browser = await playwright.chromium.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  // A lab over unsaved changes asks first (scripts/e2e-unsaved.mjs checks it); these flows always go ahead.
  const confirmOpen = page.locator('dialog.confirm-dialog[open]');
  await page.addLocatorHandler(confirmOpen, (d) => d.locator('button.danger').click());
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('http://aula.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://aula.test/practica');
  assert.equal(await page.locator('.topbar').count(), 0, 'data-embed: it waits for netfix.embed');
  // C5: mounted in the host's page, Netfix leaves the page itself alone (title, language, <html>, <body>, icon).
  const pageState = () => page.evaluate(() => ({
    title: document.title, lang: document.documentElement.lang, html: document.documentElement.getAttribute('style'),
    body: [...document.body.attributes].map((a) => `${a.name}=${a.value}`).join(' '), icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null,
  }));
  const hostPage = await pageState();
  await page.evaluate(() => {
    globalThis.changes = 0;
    globalThis.handle = netfix.embed(document.getElementById('app'), {
      restrictions: { labs: ['basico'], devices: ['pc', 'switch'], tabs: { pc: ['ip', 'windows'] }, docs: false, fileOpen: false, clock: false, simulation: false, drawing: false, timestampPrompt: 'on' },
      onChange: () => { globalThis.changes++; },
    });
  });
  await page.waitForSelector('.topbar');
  assert.deepEqual(await pageState(), hostPage, 'the host page is untouched while Netfix runs');
  assert.equal(await page.getAttribute('#app', 'class'), 'netfix-root');
  assert.deepEqual(await page.locator('.pal-devices .pal-name').allTextContents(), ['PC', 'Switch IOS']);
  assert.equal(await page.locator('[data-view="docs"]').count(), 0, 'no Documentation view');
  assert.equal(await page.getByRole('button', { name: 'Importar…' }).count(), 0, 'no Import');
  assert.equal(await page.locator('.segmented[aria-label="Modo"]').count(), 0, 'no simulation mode');
  const labs = await page.locator('select[aria-label] option').allTextContents();
  assert.ok(labs.length >= 2, String(labs));
  await page.selectOption('.file-actions select', 'basico');
  await page.waitForSelector('g.device-pc');
  await page.dblclick('g.device-pc >> nth=0');
  await page.waitForSelector('.window');
  assert.deepEqual(await page.locator('.window .win-tabs > .win-tab').allTextContents(), ['Equipo', 'TCP/IP', 'Terminal Windows']);
  await page.waitForTimeout(1200);
  assert.ok(await page.evaluate(() => globalThis.changes) > 0, 'changes reach the host page');
  assert.equal(await page.evaluate(() => localStorage.getItem('netfix:workspace:v1')), null, 'nothing autosaved in the browser');
  // The teacher locked the timestamp prompt on: the box is ticked and greyed, and the prompt carries the date.
  await page.click('.win-tab:has-text("Terminal Windows")');
  const box = page.locator('.terminal:visible .term-foot-box');
  assert.equal(await box.isChecked(), true);
  assert.equal(await box.isDisabled(), true);
  assert.match(await page.locator('.terminal:visible .term-foot').innerText(), /Prompt con marca de fecha y hora\s*\(bloqueado por el profesor\)/);
  assert.match(await page.locator('.terminal:visible .term-prompt').innerText(), /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \w+@pc\d+ C:\\.*\$ $/);
  // Lab areas cannot be touched with drawing off; a language change keeps the restrictions and stores nothing.
  await page.click('.win-close');
  assert.equal(await page.locator('.pal-draw').count(), 0, 'no drawing bar');
  await page.selectOption('.select-lang', 'en-GB');
  await page.waitForSelector('.topbar');
  assert.deepEqual(await page.locator('.pal-devices .pal-name').allTextContents(), ['PC', 'IOS switch']);
  assert.equal(await page.locator('[data-view="docs"]').count(), 0, 'still no Documentation view');
  assert.equal(await page.evaluate(() => localStorage.getItem('netfix:locale')), null, 'the language is not stored when embedded');
  const file = await page.evaluate(() => globalThis.handle.exportTopology());
  assert.equal(file.devices.length, 5);
  const marks = await page.evaluate((f) => netfix.evaluate(f, [{ id: 'gw', check: { type: 'ping', from: 'PC0', to: '192.168.10.1' } }]), file);
  assert.equal(marks.score, 1);
  // Embedded, the settings leave the host page's theme and this browser's storage alone (no theme, no confirm choice).
  await page.click('[data-view="settings"]');
  await page.waitForSelector('.settings');
  assert.equal(await page.locator('input[name="set-theme"]').count(), 0, 'no theme choice when embedded');
  await page.click('[data-view="net"]');
  // Something copied in this mount must not reach the next one (a teacher reviewing one student after another).
  await page.click('g.device-pc >> nth=0');
  await page.keyboard.press('Control+c');
  await page.evaluate(() => globalThis.handle.destroy());
  assert.equal(await page.locator('.topbar').count(), 0);
  await page.evaluate(() => { globalThis.handle = netfix.embed(document.getElementById('app'), { restrictions: {}, onChange: () => undefined }); });
  await page.waitForSelector('.topbar');
  const before = await page.locator('g.device').count();
  await page.locator('.workspace').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('g.device').count(), before, 'the clipboard of the last mount is gone');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('netfix:'))), [], 'nothing kept in the host browser');
  await page.evaluate(() => globalThis.handle.destroy());
  assert.deepEqual(await page.evaluate(() => [...document.getElementById('app').attributes].map((a) => a.name)), ['id', 'data-embed'], 'the mount is given back as it was');
  assert.deepEqual(await pageState(), hostPage);
  // netfix.lab: the whole standalone lab in the host's element (settings open, autosave, theme), the page left alone.
  await page.evaluate(() => { globalThis.handle = netfix.lab(document.getElementById('app')); });
  await page.waitForSelector('.topbar');
  assert.deepEqual(await pageState(), hostPage, 'the lab leaves the host page alone');
  await page.selectOption('.file-actions select', 'basico');
  await page.waitForSelector('g.device-pc');
  await page.click('[data-view="settings"]');
  await page.waitForSelector('.settings');
  assert.equal(await page.locator('.settings input[data-feature]:disabled').count(), 0, 'lab settings are not locked');
  await page.check('input[name="set-theme"][value="dark"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.evaluate(() => globalThis.handle.destroy());
  assert.ok(await page.evaluate(() => localStorage.getItem('netfix:workspace:v1')), 'the lab autosaves on leaving');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined, 'destroy puts the host theme back');
  assert.deepEqual(await page.evaluate(() => [...document.getElementById('app').attributes].map((a) => a.name)), ['id', 'data-embed']);
  assert.deepEqual(await pageState(), hostPage);
  await assert.rejects(page.evaluate(() => netfix.embed('#app')), /elemento/);
  await assert.rejects(page.evaluate(() => netfix.lab('#app')), /elemento/);
  // toolbar: the top bar goes in the host's element (its menu), without the logo; the mount is all workspace.
  await page.evaluate(() => { const m = document.createElement('div'); m.id = 'host-menu'; document.body.prepend(m); });
  await assert.rejects(page.evaluate(() => netfix.lab(document.getElementById('app'), { toolbar: '#host-menu' })), /toolbar/);
  await assert.rejects(page.evaluate(() => netfix.lab(document.getElementById('app'), { theme: 'dark' })), /única opción/);
  await page.evaluate(() => { globalThis.handle = netfix.lab(document.getElementById('app'), { toolbar: document.getElementById('host-menu') }); });
  await page.waitForSelector('#host-menu .topbar.is-hosted');
  assert.equal(await page.locator('#app .topbar').count(), 0, 'no bar left in the mount');
  assert.equal(await page.locator('#host-menu .brand-logo, #host-menu .menu-toggle').count(), 0, 'no logo nor phone menu in the host');
  assert.equal(await page.getAttribute('#app', 'data-bar'), 'host');
  assert.ok(await page.locator('#host-menu').getByRole('button', { name: 'Importar…' }).isVisible());
  const stageTop = await page.evaluate(() => document.querySelector('#app .stage').getBoundingClientRect().top - document.getElementById('app').getBoundingClientRect().top);
  assert.equal(stageTop, 0, 'the workspace starts at the top of the mount');
  // Windows and dialogs go in the mount, not in the host's element (it comes first in the page and wears .netfix-root).
  await page.selectOption('#host-menu .file-actions select', 'basico');
  await page.dblclick('#app g.device-pc >> nth=0');
  await page.waitForSelector('#app .window');
  await page.keyboard.press('Escape');
  await page.click('#app .pal-devices .pal-item >> nth=0');
  await page.click('#app .workspace', { position: { x: 40, y: 30 } });
  await page.locator('#app dialog.os-dialog .btn-primary').click({ timeout: 5000 });
  assert.equal(await page.locator('#host-menu .window, #host-menu dialog').count(), 0, 'nothing of the workspace in the host menu');
  // handle.open / markSaved: a file from the host's storage, asked over unsaved changes like Import….
  const saved = await page.evaluate(() => globalThis.handle.exportTopology());
  await assert.rejects(page.evaluate(() => globalThis.handle.open({ format: 'otro' }, 'x.json')));
  await page.evaluate(() => globalThis.handle.markSaved());
  let asked = 0;
  const count = () => { asked++; };
  await page.exposeFunction('countAsk', count);
  await page.evaluate(() => new MutationObserver(() => { if (document.querySelector('dialog.confirm-dialog[open]')) globalThis.countAsk(); }).observe(document.body, { subtree: true, attributes: true, childList: true }));
  assert.equal(await page.evaluate((f) => globalThis.handle.open(f, 'guardada.json'), saved), true);
  assert.equal(asked, 0, 'a saved network is replaced without asking');
  assert.match(await page.locator('#app .hint').innerText(), /guardada\.json/);
  await page.click('#host-menu [data-view="settings"]'); // an unsaved change: a lab feature off
  await page.locator('#app .settings input[data-feature] >> nth=0').click();
  await page.click('#host-menu [data-view="net"]');
  await page.removeLocatorHandler(confirmOpen); // from here the question is answered by hand
  const opening = page.evaluate((f) => globalThis.handle.open(f, 'otra.json'), saved);
  await page.locator('#app dialog.confirm-dialog[open] button.danger').click(); // the question over unsaved changes
  assert.equal(await opening, true);
  assert.ok(asked > 0, 'unsaved changes are asked about first');
  await page.click('#host-menu [data-view="settings"]');
  await page.waitForSelector('#app .settings');
  await page.click('#host-menu [data-view="net"]');
  await page.selectOption('#host-menu select[aria-label="Idioma"]', 'en-GB');
  await page.waitForSelector('#host-menu button:text-is("Import…")');
  assert.equal(await page.locator('#host-menu .topbar').count(), 1, 'a language change rebuilds the bar in the host');
  await page.evaluate(() => globalThis.handle.destroy());
  assert.deepEqual(await page.evaluate(() => [...document.getElementById('host-menu').attributes].map((a) => a.name)), ['id'], 'the host menu is given back as it was');
  assert.equal(await page.locator('#host-menu *').count(), 0);
  assert.deepEqual(await page.evaluate(() => [...document.getElementById('app').attributes].map((a) => a.name)), ['id', 'data-embed']);
  assert.deepEqual(errors, []);
  process.stdout.write('e2e embed: ok\n');
} finally {
  await browser.close();
}
