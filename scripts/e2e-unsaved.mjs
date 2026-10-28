// End-to-end: opening a lab over unsaved changes asks first; the blank workspace is no longer in the list.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8105;
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
  const labs = page.locator('select[aria-label]').filter({ hasText: 'Laboratorios' }).first();
  const options = await labs.locator('option').allInnerTexts();
  assert.ok(!options.some((o) => /en blanco/i.test(o)), 'no blank workspace in the list (Nuevo does that)');
  const hint = page.locator('.hint');

  // No changes: the lab opens at once.
  await labs.selectOption({ label: 'Spanning tree: tres switches en triángulo' });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('dialog.confirm-dialog').count(), 0, 'no question without changes');
  assert.match(await hint.innerText(), /SW-CORE/);

  // A change: a PC deleted from the workspace. Now there is something to lose.
  const pcs = page.locator('g.device-pc');
  const before = await pcs.count();
  const removeOnePc = async () => { await pcs.first().click(); await page.keyboard.press('Delete'); await page.waitForTimeout(150); };
  await removeOnePc();
  assert.equal(await pcs.count(), before - 1);

  // Cancel keeps the network as it was.
  await labs.selectOption({ index: 1 });
  const dialog = page.locator('dialog.confirm-dialog[open]');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Cambios sin guardar[\s\S]*se perderán/);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancelar', 'Cancel has the focus');
  if (shots) await page.screenshot({ path: `${shots}/unsaved.png` });
  await dialog.locator('button:has-text("Cancelar")').click();
  assert.equal(await page.locator('dialog.confirm-dialog').count(), 0);
  assert.equal(await pcs.count(), before - 1, 'the change is still there');
  assert.equal(await labs.inputValue(), '', 'the list goes back to its placeholder');

  // Esc cancels too; the second answer opens the lab.
  await labs.selectOption({ index: 1 });
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog.confirm-dialog').count(), 0);
  assert.equal(await pcs.count(), before - 1);
  await labs.selectOption({ index: 1 });
  await dialog.waitFor();
  await dialog.locator('button:has-text("Abrir el laboratorio")').click();
  await page.waitForTimeout(200);
  assert.match(await hint.innerText(), /.+/);
  assert.notEqual(await page.locator('g.device').count(), 0, 'the lab replaced the network');

  // A lab just opened is clean again: the next one does not ask.
  await labs.selectOption({ index: 2 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('dialog.confirm-dialog').count(), 0);

  // Nuevo over changes: Cancel keeps them, the second answer empties the workspace.
  await removeOnePc();
  const kept = await page.locator('g.device').count();
  await page.click('button:has-text("Nuevo")');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /red nueva/);
  await dialog.locator('button:has-text("Cancelar")').click();
  assert.equal(await page.locator('g.device').count(), kept, 'Nuevo cancelled keeps the network');
  await page.click('button:has-text("Nuevo")');
  await dialog.locator('button:has-text("Empezar una red nueva")').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('g.device').count(), 0, 'Nuevo empties the workspace');

  // Nuevo and Abrir without changes do not ask; Abrir over changes asks before the file chooser.
  await page.click('button:has-text("Nuevo")');
  assert.equal(await page.locator('dialog.confirm-dialog').count(), 0);
  let chooser = page.waitForEvent('filechooser', { timeout: 2000 });
  await page.click('button:has-text("Abrir")');
  await (await chooser).setFiles([]);
  await labs.selectOption({ index: 1 });
  await page.waitForTimeout(200);
  await removeOnePc();
  let opened = false;
  page.once('filechooser', () => { opened = true; });
  await page.click('button:has-text("Abrir")');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /otro archivo/);
  await dialog.locator('button:has-text("Cancelar")').click();
  await page.waitForTimeout(300);
  assert.equal(opened, false, 'Cancel does not open the file chooser');
  chooser = page.waitForEvent('filechooser', { timeout: 3000 });
  await page.click('button:has-text("Abrir")');
  await dialog.locator('button:has-text("Elegir otro archivo")').click();
  await (await chooser).setFiles([]);

  // The mark survives a reload: a change, reload, and the list still asks.
  await removeOnePc();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.locator('select[aria-label]').filter({ hasText: 'Laboratorios' }).first().selectOption({ index: 1 });
  await page.locator('dialog.confirm-dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('e2e unsaved OK: no blank workspace; labs, Nuevo and Abrir ask only over changes; Cancel/Esc keep them; kept across reloads');
} finally {
  await browser.close();
  server.kill();
}
