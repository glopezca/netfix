// End-to-end check of guided labs and classroom mission restrictions.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8113;
const html = readFileSync(join(root, 'dist/netfix.html'), 'utf8').replace('<div id="app">', '<div id="app" data-embed>');
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-ES' });
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device');
  // Off by default: no panel and no Laboratorios group in Help until Configuración → Generales turns them on.
  await page.locator('select.select').first().selectOption('basico');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.mission').isHidden(), true, 'hidden by default');
  await page.click('button.seg[data-view="docs"]');
  assert.equal(await page.locator('details[data-group="labs"]').count(), 0, 'no Labs group in Help');
  await page.click('button.seg[data-view="settings"]');
  await page.locator('input[data-setting="missions"]').check();
  await page.click('button.seg[data-view="docs"]');
  assert.equal(await page.locator('details[data-group="labs"]').count(), 1, 'the Labs group once on');
  await page.click('button.seg[data-view="net"]');
  await page.waitForSelector('.mission:not([hidden])');
  await page.waitForTimeout(1500); // the autosave of the lab
  await page.reload(); // the option is kept in this browser
  await page.waitForSelector('.mission:not([hidden])', { timeout: 5000 });
  assert.match(await page.locator('.mission').innerText(), /Misión|DHCP/i);
  await page.locator('.mission-hint-btn').first().click();
  assert.equal(await page.locator('.mission-hints li').count(), 1, 'the first hint is revealed');
  await page.locator('.mission-actions button').filter({ hasText: 'Comprobar' }).click();
  assert.match(await page.locator('.mission-score').innerText(), /\d+ de \d+ puntos/);
  await page.locator('.mission-actions button').filter({ hasText: 'Ver solución' }).click();
  await page.waitForSelector('.mission-solution');
  await page.locator('.mission-actions button').filter({ hasText: 'Comprobar' }).click();
  assert.equal(await page.locator('.mission-score').getAttribute('data-state'), 'ok', 'the solved mission passes');

  // The classroom can independently hide checking, hints and the solution action.
  const classroom = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-ES' });
  await classroom.route('http://aula.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await classroom.goto('http://aula.test/practica');
  await classroom.evaluate(() => {
    globalThis.handle = netfix.embed(document.getElementById('app'), {
      restrictions: { labs: ['basico'], missionCheck: false, hints: false, solution: false },
    });
  });
  await classroom.waitForSelector('.topbar');
  await classroom.locator('.file-actions select').selectOption('basico');
  await classroom.waitForSelector('.mission:not([hidden])');
  assert.equal(await classroom.locator('.mission-hint-btn').count(), 0);
  assert.equal(await classroom.locator('.mission-actions').count(), 0);
  assert.deepEqual(errors, []);
  await classroom.evaluate(() => globalThis.handle.destroy());
  console.log('e2e missions OK: off by default and turned on in Configuración, hint, check, solution, passing score and classroom restrictions');
} finally {
  await browser.close();
  server.kill();
}
