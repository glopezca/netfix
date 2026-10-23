// End-to-end check of the selection box on touch screens (v0.19.1): a long press on the background starts the box
// (a quick drag still pans), a tap on the background clears it, the group is dragged and deleted with a finger,
// and a double tap opens a device of the group. Real touch events through the Chrome DevTools protocol.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8101;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, hasTouch: true, locale: 'es-ES' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  /** One finger: down at a, (optionally held), moved to b in steps, lifted. */
  async function finger(a, b, holdMs = 0) {
    await touch('touchStart', a.x, a.y);
    if (holdMs) await wait(holdMs);
    for (let i = 1; i <= 6; i++) await touch('touchMove', a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
    await touch('touchEnd');
    await wait(80);
  }
  async function tap(p) { await touch('touchStart', p.x, p.y); await touch('touchEnd'); await wait(60); }

  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.locator('select.select').first().selectOption('ssh-sftp');
  await page.waitForTimeout(300);
  await page.click('button[aria-label*="Ajustar"]');
  await page.waitForTimeout(200);
  /** The first device's box, read in one step (the canvas redraws its nodes, so a handle may go stale). */
  const firstBox = () => page.evaluate(() => { const r = document.querySelector('g.device')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const devices = await page.locator('g.device').count();
  const around = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('g.device, .drawing')].map((e) => e.getBoundingClientRect());
    return { a: { x: Math.min(...rs.map((r) => r.left)) - 20, y: Math.min(...rs.map((r) => r.top)) - 20 }, b: { x: Math.max(...rs.map((r) => r.right)) + 20, y: Math.max(...rs.map((r) => r.bottom)) + 20 } };
  });
  const selected = () => page.locator('g.device.is-selected').count();
  const scroll = () => page.locator('.workspace').evaluate((w) => [w.scrollLeft, w.scrollTop].join());

  // A quick drag pans and selects nothing.
  const before = await scroll();
  await finger(around.b, { x: around.b.x - 150, y: around.b.y - 100 });
  assert.equal(await selected(), 0, 'a quick drag does not select');
  assert.equal(await page.locator('.marquee').count(), 0);
  const panned = (await scroll()) !== before;
  await page.click('button[aria-label*="Ajustar"]');
  await page.waitForTimeout(200);

  // Long press on the background, then drag: the selection box.
  const box = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('g.device, .drawing')].map((e) => e.getBoundingClientRect());
    return { a: { x: Math.min(...rs.map((r) => r.left)) - 20, y: Math.min(...rs.map((r) => r.top)) - 20 }, b: { x: Math.max(...rs.map((r) => r.right)) + 20, y: Math.max(...rs.map((r) => r.bottom)) + 20 } };
  });
  await finger(box.a, box.b, 650);
  assert.equal(await selected(), devices, 'long press + drag selects everything inside');

  // Dragging a member with a finger moves the whole group (one undo step).
  const pos = () => page.locator('g.device').evaluateAll((gs) => gs.map((g) => g.getAttribute('transform')));
  const p0 = await pos();
  const d = await firstBox();
  await finger({ x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 + 50, y: d.y + d.height / 2 + 30 });
  assert.ok((await pos()).every((p, i) => p !== p0[i]), 'every device moved');
  await page.click('button.undo-btn');
  assert.deepEqual(await pos(), p0);

  // A double tap on a member opens it.
  const d2 = await firstBox();
  await finger(box.a, box.b, 650);
  const c = { x: d2.x + d2.width / 2, y: d2.y + d2.height / 2 };
  await tap(c);
  await tap(c);
  await page.waitForSelector('.window:visible', { timeout: 2000 });
  await page.click('.window:visible .win-close');

  // A tap on the background clears the selection; the toolbar deletes a group (no keyboard).
  await finger(box.a, box.b, 650);
  assert.equal(await selected(), devices, 'the group is still there after opening one of its devices');
  // Two fingers (a pinch that does not move) keep the selection.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.a.x, y: box.a.y, id: 1 }, { x: box.a.x + 60, y: box.a.y + 10, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(80);
  assert.equal(await selected(), devices, 'a two-finger tap does not clear the selection');
  await tap(box.a);
  assert.equal(await selected(), 0, 'a tap on the background clears the selection');
  // A device tapped on its own joins the box drawn after a long press.
  const one = (await page.locator('g.device').evaluateAll((gs) => gs.map((g) => { const r = g.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }))).sort((p, q) => p.x - q.x)[0];
  await tap({ x: one.x + one.width / 2, y: one.y + one.height / 2 });
  await finger({ x: one.x + one.width + 10, y: box.a.y }, box.b, 650);
  assert.equal(await selected(), devices, 'the single selection is kept by the long-press box');
  await tap(box.a);
  await finger(box.a, box.b, 650);
  await page.click('button.clip-delete');
  assert.equal(await page.locator('g.device').count(), 0, 'the delete button removes the group');
  await page.click('button.undo-btn');
  assert.equal(await page.locator('g.device').count(), devices);
  assert.deepEqual(errors, []);
  console.log(`e2e touch OK: long press draws the box${panned ? ', a quick drag pans' : ''}, group drag, double tap, tap clears, delete button`);
} finally {
  await browser.close();
  server.kill();
}
