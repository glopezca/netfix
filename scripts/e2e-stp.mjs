// End-to-end: spanning tree in the interface — amber light on the blocked port, Listening/Learning after a change,
// and the STP filter (off at first) in the simulation panel.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8106;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const shots = process.env.SHOTS_DIR;
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.locator('select[aria-label]').filter({ hasText: 'Laboratorios' }).first().selectOption('stp');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.light-blocked').count(), 1, 'one amber light: the blocked port, converged at load');

  // A PC port that comes back up listens and learns: amber until the clock passes 30 s.
  await page.locator('g.device-switch', { hasText: 'SW-A' }).dblclick();
  await page.click('.win-tab:has-text("CLI")');
  const type = async (line) => { await page.keyboard.type(line); await page.keyboard.press('Enter'); };
  for (const line of ['', 'enable', 'conf t', 'interface FastEthernet0/1', 'shutdown', 'no shutdown', 'end']) await type(line);
  await page.waitForTimeout(300);
  await page.click('.win-close');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.light-blocked').count(), 2, 'the PC port is amber while it listens');
  if (shots) await page.screenshot({ path: `${shots}/stp-listening.png` });
  await page.locator('select[aria-label]').filter({ hasText: 'Avanzar' }).first().selectOption({ index: 1 });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.light-blocked').count(), 1, 'forwarding after a minute');

  // Simulation: the STP chip is there and unticked; ticked, BPDUs show up.
  await page.click('button.seg:has-text("Simulación")');
  const chip = page.locator('.simpanel label.chip-stp input');
  assert.equal(await chip.isChecked(), false, 'STP hidden at first');
  await chip.check();
  await page.locator('.simpanel button:has-text("Paso")').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.simpanel .events td')].some((td) => td.textContent?.startsWith('STP BPDU')), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
  console.log('e2e STP OK: amber blocked port, Listening/Learning after no shutdown, STP filter off at first and BPDUs once ticked');
} finally {
  await browser.close();
  server.kill();
}
