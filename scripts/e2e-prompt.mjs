// End-to-end check of phase 21: «Prompt con marca de fecha y hora» at the foot of the Linux and Windows terminals.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8095;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
const LINUX = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2} \S+@\S+:~[#$] $/;
const WINDOWS = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \S+@\S+ C:\\.*[#$] $/;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
  // A lab over unsaved changes asks first (scripts/e2e-unsaved.mjs checks it); these flows always go ahead.
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  const prompt = () => page.locator('.terminal:visible .term-prompt').innerText();
  const box = () => page.locator('.terminal:visible .term-foot-box');

  // PC: tick it in the GNU/Linux terminal; the Windows terminal of the same device follows; untick restores both.
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.dblclick('g.device-pc >> nth=0');
  // PC0 runs Windows: its Configuración tab adds the GNU/Linux terminal (the window reopens on that tab).
  await page.click('.win-tab:text-is("Configuración")');
  await page.locator('.window input[name="dev-linux"]').check();
  await page.click('.win-tab:has-text("Terminal GNU/Linux")');
  const plain = await prompt();
  assert.equal(await box().isChecked(), false);
  assert.match(await page.locator('.terminal:visible .term-foot').innerText(), /Prompt con marca de fecha y hora/);
  await box().check();
  assert.match(await prompt(), LINUX);
  assert.equal(await page.locator('.terminal:visible .term-prompt span').first().evaluate((s) => getComputedStyle(s).color) !== '', true);
  await page.click('.win-tab:has-text("Terminal Windows")');
  assert.equal(await box().isChecked(), true, 'one setting per device');
  assert.match(await prompt(), WINDOWS);
  await box().uncheck();
  assert.doesNotMatch(await prompt(), WINDOWS);
  await page.click('.win-tab:has-text("Terminal GNU/Linux")');
  assert.equal(await prompt(), plain, 'the previous PS1 is back');
  await page.click('.win-close');

  // Server and GNU/Linux router have the box too.
  await page.dblclick('g.device-server');
  await page.click('.win-tab:has-text("Terminal GNU/Linux")');
  await box().check();
  assert.match(await prompt(), LINUX);
  await page.click('.win-close');
  await page.selectOption('select.select >> nth=0', 'linux-dmz');
  await page.dblclick('g.device:has-text("FW")');
  await page.click('.win-tab:has-text("Terminal GNU/Linux")');
  await box().check();
  assert.match(await prompt(), LINUX);
  assert.deepEqual(errors, []);
  console.log('e2e prompt: ok');
} finally {
  await browser.close();
  server.kill();
}
