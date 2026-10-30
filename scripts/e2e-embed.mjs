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
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('http://aula.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://aula.test/practica');
  assert.equal(await page.locator('.topbar').count(), 0, 'data-embed: it waits for netfix.embed');
  await page.evaluate(() => {
    globalThis.changes = 0;
    globalThis.handle = netfix.embed(document.getElementById('app'), {
      restrictions: { labs: ['basico'], devices: ['pc', 'switch'], tabs: { pc: ['ip', 'windows'] }, docs: false, fileOpen: false, clock: false, simulation: false, drawing: false, timestampPrompt: 'on' },
      onChange: () => { globalThis.changes++; },
    });
  });
  await page.waitForSelector('.topbar');
  assert.deepEqual(await page.locator('.pal-devices .pal-name').allTextContents(), ['PC', 'Switch IOS']);
  assert.equal(await page.locator('[data-view="docs"]').count(), 0, 'no Documentation view');
  assert.equal(await page.getByRole('button', { name: 'Abrir' }).count(), 0, 'no Open');
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
  await page.evaluate(() => globalThis.handle.destroy());
  assert.equal(await page.locator('.topbar').count(), 0);
  await assert.rejects(page.evaluate(() => netfix.embed('#app')), /elemento/);
  assert.deepEqual(errors, []);
  process.stdout.write('e2e embed: ok\n');
} finally {
  await browser.close();
}
