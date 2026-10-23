// End-to-end check of phase 24: interface names on their cables (never over a device's name or addresses), the
// cloud's «Equipo» tab and the read-only host name.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8099;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

/** Interface names that overlap a device's name or the lines below it. */
const overlaps = (page) => page.evaluate(() => {
  const box = (e) => e.getBoundingClientRect();
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const captions = [...document.querySelectorAll('g.device .device-label, g.device .device-host')].map(box);
  return [...document.querySelectorAll('.port-label')].filter((l) => captions.some((c) => hit(box(l), c))).map((l) => l.textContent);
});

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  const labs = page.locator('select.select').first();
  for (const lab of ['basico', 'relay', 'vlans', 'servidores']) {
    await labs.selectOption(lab);
    await page.waitForTimeout(200);
    assert.deepEqual(await overlaps(page), [], `${lab}: interface names clear of the captions`);
  }

  // Cloud: «Equipo» first, the name applies on change, the host name is derived and read-only.
  const titles = await labs.locator('option').allTextContents();
  await labs.selectOption({ label: titles.find((o) => o.startsWith('Internet')) });
  await page.waitForSelector('g.device-cloud');
  assert.deepEqual(await overlaps(page), [], 'internet lab');
  await page.dblclick('g.device-cloud >> nth=0');
  assert.equal(await page.locator('.window:visible .win-tab').first().innerText(), 'Equipo');
  const win = page.locator('.window:visible');
  assert.equal(await win.locator('input[name="hostname"]').getAttribute('readonly'), '');
  await win.locator('input[name="label"]').fill('Operador Norte');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.window input[name="hostname"]')?.value === 'operador-norte');
  const caption = await page.locator('g.device-cloud', { hasText: 'Operador Norte' }).locator('text').allTextContents();
  assert.ok(caption.some((x) => /^\d+\.\d+\.0\.0\/16$/.test(x)), `the public block under the name: ${caption.join(' | ')}`);
  if (shots) await page.screenshot({ path: `${shots}/cloud.png` });
  await page.click('.win-close');

  // A PC: the terminal cannot change the host name.
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Terminal Linux")');
  const term = page.locator('.terminal:visible');
  await term.locator('input.term-input').fill('sudo hostname otro');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.match(await term.locator('.term-screen').innerText(), /nombre del equipo/);
  if (shots) await page.screenshot({ path: `${shots}/labels.png` });
  assert.deepEqual(errors, []);
  console.log('e2e v0.16 OK');
} finally {
  await browser.close();
  server.kill();
}
