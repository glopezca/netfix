// End-to-end: Configuración — general settings (theme, unsaved question) and the device settings of the lab.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8107;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const shots = process.env.SHOTS_DIR;
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.locator('select[aria-label]').filter({ hasText: 'Laboratorios' }).first().selectOption('servidores');
  await page.waitForTimeout(300);
  const tabsOf = async (selector) => {
    await page.locator(selector).first().dblclick();
    const tabs = await page.locator('.window .win-tab').allInnerTexts();
    await page.click('.win-close');
    return tabs;
  };
  assert.ok((await tabsOf('g.device-pc')).includes('Terminal Windows'));

  await page.click('button.seg:has-text("Configuración")');
  const settings = page.locator('.settings');
  await settings.waitFor();
  assert.equal(await settings.locator('input[data-feature="server:firewall"]').isChecked(), false, 'a server has no firewall panel by default');
  assert.equal(await settings.locator('input[data-feature="linuxrouter:sysctl"]').isChecked(), true);
  if (shots) await page.screenshot({ path: `${shots}/settings.png`, fullPage: false });
  await settings.locator('input[data-feature="pc:windows"]').uncheck();
  await settings.locator('input[data-feature="server:firewall"]').check();
  await page.click('button.seg:has-text("Red")');
  assert.ok(!(await tabsOf('g.device-pc')).includes('Terminal Windows'), 'the PC lost its Windows terminal');
  await page.locator('g.device-server').first().dblclick();
  await page.click('.window .win-tab:has-text("Servicios")');
  assert.ok(await page.locator('.window .subnav-item:has-text("Firewall")').count() > 0, 'the server gained the firewall panel');
  await page.click('.win-close');

  // Theme: dark sets data-theme; the setting survives a reload, and so do the lab settings (autosave).
  await page.click('button.seg:has-text("Configuración")');
  await settings.locator('input[name="set-theme"][value="dark"]').check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForSelector('g.device-router');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.ok(!(await tabsOf('g.device-pc')).includes('Terminal Windows'), 'the lab settings came back with the workspace');

  // The timestamp prompt is global and off by default; ticked here, the terminals show it.
  await page.click('button.seg:has-text("Configuración")');
  const stamp = settings.locator('label:has-text("Prompt con marca de fecha y hora") input');
  assert.equal(await stamp.isChecked(), false);
  await stamp.check();
  await page.click('button.seg:has-text("Red")');
  await page.locator('g.device-pc').first().dblclick();
  await page.click('.window .win-tab:has-text("Terminal Linux")');
  assert.equal(await page.locator('.window .term-foot input').first().isChecked(), true, 'the terminal footer follows the global setting');
  await page.click('.win-close');
  await page.click('button.seg:has-text("Configuración")');
  await stamp.uncheck();

  // Without the unsaved question, a lab replaces the changes at once.
  await page.click('button.seg:has-text("Configuración")');
  await settings.locator('input[data-feature="pc:windows"]').check();
  await settings.locator('label:has-text("Avisar antes de reemplazar") input').uncheck();
  await page.click('button.seg:has-text("Red")');
  await page.locator('select[aria-label]').filter({ hasText: 'Laboratorios' }).first().selectOption('basico');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('dialog.confirm-dialog').count(), 0);
  // Restore the defaults (and the theme) for the next scripts that share nothing, but keep it tidy.
  await page.click('button.seg:has-text("Configuración")');
  await settings.locator('input[name="set-theme"][value="auto"]').check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  assert.deepEqual(errors, []);
  console.log('e2e settings OK: lab features change the windows (PC terminal off, server firewall on), theme and lab settings survive a reload, global timestamp prompt, unsaved question can be turned off');
} finally {
  await browser.close();
  server.kill();
}
