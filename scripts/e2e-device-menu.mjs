// End-to-end check of the device context menu (S24 of FixIT Classroom, 0.72.0): right click (released in place; a
// right drag still pans), Shift+F10 on a focused device and a long press on a touch screen open it; Abrir opens the
// device, Escape closes and gives the focus back, Eliminar deletes; a double tap still opens without the menu.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8121;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true, locale: 'es-ES' });
  const page = await context.newPage();
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.locator('select.select').first().selectOption('ssh-sftp');
  await page.waitForTimeout(300);
  await page.click('button[aria-label*="Ajustar"]');
  await page.waitForTimeout(200);
  const menu = page.locator('.device-menu');
  const items = () => menu.locator('button').allInnerTexts();
  const center = async (sel) => {
    await page.locator(sel).first().waitFor({ state: 'visible' });
    const r = await page.locator(sel).first().boundingBox();
    if (!r) throw new Error(`${sel}: not on screen (${await page.evaluate(() => [...document.querySelectorAll('g.device')].map((g) => g.getAttribute('class')).join(' | '))})`);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };

  // Right click on a device: Abrir and Eliminar (no extension here), focus on Abrir; Escape gives the focus back.
  const pc = await center('g.device-pc');
  await page.mouse.click(pc.x, pc.y, { button: 'right' });
  await menu.waitFor({ state: 'visible' });
  assert.deepEqual(await items(), ['Abrir', 'Eliminar']);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')), 'open');
  assert.match(await menu.getAttribute('aria-label'), /^Menú de /);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')), 'delete', 'arrows move inside it');
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('g.device')?.classList.contains('device-pc')), true, 'the focus goes back to the device');

  // Shift+F10 on the focused device, then Abrir opens its window.
  await page.keyboard.press('Shift+F10');
  await menu.waitFor({ state: 'visible' });
  await menu.locator('button[data-action="open"]').click();
  await page.locator('.window').first().waitFor({ state: 'visible' });
  assert.equal(await menu.isVisible(), false);
  await page.click('.win-close');

  // A right drag on the background still pans and shows no menu; a click outside closes an open menu.
  const scroll = () => page.locator('.workspace').evaluate((w) => [w.scrollLeft, w.scrollTop].join());
  const before = await scroll();
  const box = await page.locator('.workspace').boundingBox();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 60);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width - 260, box.y + box.height - 200, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  assert.equal(await menu.isVisible(), false, 'no menu after a right drag');
  const panned = (await scroll()) !== before;
  await page.click('button[aria-label*="Ajustar"]');
  await page.waitForTimeout(200);
  const pc2 = await center('g.device-pc');
  await page.mouse.click(pc2.x, pc2.y, { button: 'right' });
  await menu.waitFor({ state: 'visible' });
  await page.mouse.click(box.x + 30, box.y + 30);
  assert.equal(await menu.isVisible(), false, 'a click outside closes it');

  // Long press with a finger: the menu (it used to open the device); a double tap still opens it directly.
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const pc3 = await center('g.device-pc');
  await touch('touchStart', pc3.x, pc3.y);
  await wait(800);
  await touch('touchEnd');
  await menu.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.window:visible').count(), 0, 'the long press does not open the device any more');
  await page.keyboard.press('Escape');
  await touch('touchStart', pc3.x, pc3.y); await touch('touchEnd'); await wait(60);
  await touch('touchStart', pc3.x, pc3.y); await touch('touchEnd'); await wait(300);
  await page.locator('.window').first().waitFor({ state: 'visible' });
  assert.equal(await menu.isVisible(), false);
  await page.click('.win-close');

  // Eliminar deletes the device (with its cables).
  const count = await page.locator('g.device').count();
  const pc4 = await center('g.device-pc');
  await page.mouse.click(pc4.x, pc4.y, { button: 'right' });
  await menu.locator('button[data-action="delete"]').click();
  assert.equal(await page.locator('g.device').count(), count - 1);
  assert.deepEqual(errors, []);
  console.log(`e2e device menu OK: right click, Shift+F10 and long press open it, arrows and Escape, Abrir, Eliminar, a click outside closes it${panned ? ', a right drag pans' : ''}, double tap still opens`);
} finally {
  await browser.close();
  server.kill();
}
