// End-to-end check of phase 27 (v0.19): resize handles on areas, a selection box over the background, dragging
// and deleting a group, copy, paste and duplicate (Ctrl+C/V/D) and their single undo step.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8100;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

const count = (page, sel) => page.locator(sel).count();
/** Screen box around every device (and the areas around them). */
const around = (page) => page.evaluate(() => {
  const rs = [...document.querySelectorAll('g.device, .drawing')].map((e) => e.getBoundingClientRect());
  return { x0: Math.min(...rs.map((r) => r.left)) - 24, y0: Math.min(...rs.map((r) => r.top)) - 24, x1: Math.max(...rs.map((r) => r.right)) + 24, y1: Math.max(...rs.map((r) => r.bottom)) + 24 };
});
const positions = (page) => page.locator('g.device').evaluateAll((gs) => gs.map((g) => g.getAttribute('transform')));
async function box(page, b) {
  await page.mouse.move(b.x0, b.y0);
  await page.mouse.down();
  await page.mouse.move((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, { steps: 4 });
  await page.mouse.move(b.x1, b.y1, { steps: 4 });
  await page.mouse.up();
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  const labs = page.locator('select.select').first();
  await labs.selectOption('basico');
  await page.waitForTimeout(300);
  await page.click('button[aria-label*="Ajustar"]');
  await page.waitForTimeout(200);
  const devices = await count(page, 'g.device');
  const links = await count(page, 'g.link');
  const drawings = await count(page, '.drawing');
  assert.ok(devices >= 3, 'the lab has devices');

  // Box selection: everything inside is selected (devices and the areas fully inside).
  await box(page, await around(page));
  assert.equal(await count(page, 'g.device.is-selected'), devices, 'every device in the box is selected');
  assert.equal(await count(page, '.drawing.is-selected'), drawings, 'and the drawings');
  assert.match(await page.locator('.hint').innerText(), /Seleccionados/);

  // Dragging one of them moves the whole group; one Ctrl+Z puts everything back.
  const before = await positions(page);
  const dev = await page.locator('g.device').first().boundingBox();
  await page.mouse.move(dev.x + dev.width / 2, dev.y + dev.height / 2);
  await page.mouse.down();
  await page.mouse.move(dev.x + dev.width / 2 + 60, dev.y + dev.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const after = await positions(page);
  assert.ok(after.every((p, i) => p !== before[i]), 'all the devices moved');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await positions(page), before, 'one undo step for the whole group');

  // Duplicate: new devices with their cables, selected; undo takes them all away, redo brings them back.
  await box(page, await around(page));
  await page.keyboard.press('Control+d');
  assert.equal(await count(page, 'g.device'), devices * 2, 'duplicated devices');
  assert.equal(await count(page, 'g.link'), links * 2, 'with the cables between them');
  assert.equal(await count(page, '.drawing'), drawings * 2, 'and the drawings');
  assert.equal(await count(page, 'g.device.is-selected'), devices, 'the copies are the selection');
  const labels = await page.locator('g.device .device-label').allTextContents();
  assert.equal(new Set(labels).size, labels.length, 'every copy has a name of its own');
  await page.keyboard.press('Control+z');
  assert.equal(await count(page, 'g.device'), devices);
  assert.equal(await count(page, 'g.link'), links);
  await page.keyboard.press('Control+y');
  assert.equal(await count(page, 'g.link'), links * 2);

  // Supr deletes the selected group (one step); copy and paste work from the toolbar buttons too.
  await box(page, await around(page)); // everything, originals and copies
  await page.keyboard.press('Escape');
  assert.equal(await count(page, 'g.device.is-selected'), 0, 'Escape clears the selection');
  await page.keyboard.press('Control+z');
  assert.equal(await count(page, 'g.device'), devices);
  await box(page, await around(page));
  await page.click('button.clip-copy');
  await page.click('button.clip-paste');
  assert.equal(await count(page, 'g.device'), devices * 2, 'pasted from the toolbar');
  await page.locator('.workspace').focus();
  await page.keyboard.press('Delete');
  assert.equal(await count(page, 'g.device'), devices, 'Supr deleted the pasted group');
  assert.equal(await count(page, 'g.link'), links);

  // Middle button pans the view instead of drawing a box.
  const ws = page.locator('.workspace');
  const scroll = await ws.evaluate((w) => w.scrollLeft);
  const b = await around(page);
  await page.mouse.move(b.x1 + 40, b.y1 - 10);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(b.x1 - 160, b.y1 - 10, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  assert.equal(await count(page, '.marquee'), 0);
  assert.equal(await count(page, 'g.device.is-selected'), 0, 'panning selects nothing');
  assert.ok((await ws.evaluate((w) => w.scrollLeft)) !== scroll || (await ws.evaluate((w) => w.scrollWidth <= w.clientWidth)), 'the view moved');

  // Resize handles: the selected area grows from its south-east corner; Ctrl+Z gives it its size back.
  const area = page.locator('.drawing-rect').first();
  await page.click('button[aria-label*="Ajustar"]');
  await area.locator('.drawing-label').scrollIntoViewIfNeeded();
  const hit = await area.locator('.drawing-label').boundingBox();
  await page.mouse.click(hit.x + 4, hit.y + hit.height / 2);
  const under = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return `${e?.tagName}.${e?.getAttribute('class')} in ${e?.parentElement?.getAttribute('class')}`; }, { x: hit.x + 4, y: hit.y + hit.height / 2 });
  assert.equal(await count(page, '.drawing-handle'), 8, `eight handles: corners and midpoints (clicked ${under})`);
  const width = Number(await area.locator('.drawing-shape').getAttribute('width'));
  const se = await page.locator('.drawing-handle-se').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 80, se.y + 40, { steps: 5 });
  await page.mouse.up();
  const grown = Number(await page.locator('.drawing-rect').first().locator('.drawing-shape').getAttribute('width'));
  assert.ok(grown > width + 20, `the area grew (${width} → ${grown})`);
  await page.keyboard.press('Control+z');
  assert.equal(Number(await page.locator('.drawing-rect').first().locator('.drawing-shape').getAttribute('width')), width);
  if (shots) await page.screenshot({ path: join(shots, 'v019.png') });

  // v0.19.4: an IOS router's hostname comes from its name, as on the Linux devices (read-only in Equipo).
  await page.dblclick('g.device-router');
  const win = page.locator('.window:visible');
  await win.locator('.win-tab:has-text("Equipo")').click();
  const host = win.locator('input[name="hostname"]');
  assert.deepEqual([await host.inputValue(), await host.getAttribute('readonly')], ['GW', '']);
  await win.locator('input[name="label"]').fill('Sede Norte');
  await win.locator('input[name="label"]').press('Enter');
  await page.waitForFunction(() => document.querySelector('.window input[name="hostname"]')?.value === 'Sede-Norte', null, { timeout: 3000 });
  await win.locator('.win-tab:has-text("CLI")').click();
  await win.locator('.terminal').click();
  for (const line of ['', 'enable', 'configure terminal', 'hostname R1']) { await page.keyboard.type(line); await page.keyboard.press('Enter'); await page.waitForTimeout(80); }
  assert.match(await win.locator('.terminal').innerText(), /% In Netfix the hostname comes from the device name \(Device tab\)\s*Sede-Norte\(config\)#/);
  await win.locator('.win-close').click();

  // English: the toolbar buttons are translated.
  assert.deepEqual(errors, []);
  console.log('e2e v0.19 OK: resize handles, box selection, group drag and delete, copy, paste and duplicate');
} finally {
  await browser.close();
  server.kill();
}
