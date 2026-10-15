// End-to-end checks of v0.7 (English locale, layout at 1400 px, VPN lab, SSH client, touch key bar).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8098;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const shots = process.env.SHOTS_DIR;
const browser = await playwright.chromium.launch();
const errors = [];

async function fresh(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  return page;
}

try {
  // 1. An English browser gets the English interface; windows open below the (wrapped) top bar.
  const desk = await browser.newContext({ viewport: { width: 1400, height: 860 }, locale: 'en-GB' });
  const page = await fresh(desk);
  assert.equal(await page.getAttribute('html', 'lang'), 'en-GB');
  await page.dblclick('g.device-pc >> nth=0');
  await page.waitForSelector('.window');
  const bar = await page.locator('.topbar').boundingBox();
  const win = await page.locator('.window').first().boundingBox();
  assert.ok(win.y >= bar.y + bar.height, `window (${win.y}) below the top bar (${bar.y + bar.height})`);
  assert.ok(win.y + win.height <= 860, 'window fits the viewport');
  if (shots) await page.screenshot({ path: `${shots}/desk-en.png` });
  await page.click('.win-close');

  // 1b. Del (Supr) or Backspace removes the selected device (with its cables) or the selected cable, even after the
  // periodic redraws of the workspace have replaced the selected element.
  const census = () => page.evaluate(() => [document.querySelectorAll('g.device').length, document.querySelectorAll('g.link').length]);
  const [devs, links] = await census();
  await page.click('g.device-pc >> nth=1');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Delete');
  assert.deepEqual(await census(), [devs - 1, links - 1], 'Del removes the selected device and its cable');
  // Middle of the first cable on screen (a vertical cable has no width, so no bounding box to click).
  const mid = await page.locator('g.link .cable-hit').first().evaluate((l) => {
    const m = l.getScreenCTM();
    const p = (x, y) => new DOMPoint(x, y).matrixTransform(m);
    const a = p(l.x1.baseVal.value, l.y1.baseVal.value);
    const b = p(l.x2.baseVal.value, l.y2.baseVal.value);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Backspace');
  assert.deepEqual(await census(), [devs - 1, links - 2], 'Backspace removes the selected cable');
  // With a device selected and its window open, Backspace after clicking the window (focus on body) deletes nothing.
  await page.click('g.device-pc >> nth=0');
  await page.dblclick('g.device-pc >> nth=0');
  await page.waitForSelector('.window');
  await page.click('.window .win-title');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Backspace');
  assert.deepEqual(await census(), [devs - 1, links - 2], 'Backspace on a window does not delete the selected device');
  await page.click('.win-close');
  // Ctrl+Z brings back the cable, then the device with its cable; Ctrl+Y and the redo button delete them again.
  await page.locator('.workspace').focus();
  await page.keyboard.press('Control+z');
  assert.deepEqual(await census(), [devs - 1, links - 1], 'Ctrl+Z restores the cable');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await census(), [devs, links], 'Ctrl+Z restores the device and its cable');
  await page.keyboard.press('Control+y');
  assert.deepEqual(await census(), [devs - 1, links - 1], 'Ctrl+Y deletes the device again');
  await page.click('.redo-btn');
  assert.deepEqual(await census(), [devs - 1, links - 2], 'the redo button');
  await page.click('.undo-btn');
  await page.click('.undo-btn');
  assert.deepEqual(await census(), [devs, links]);
  assert.equal(await page.locator('.undo-btn').isDisabled(), true, 'nothing left to undo');

  // 2. Changing language while reading the docs keeps the docs open, now in the other language.
  await page.click('button.seg:has-text("Documentation")');
  await page.waitForSelector('.doc-group:has-text("Linux Terminal")');
  await page.selectOption('.select-lang', 'es-ES');
  await page.waitForSelector('.doc-group:has-text("Terminal Linux")');
  assert.equal(await page.getAttribute('body', 'data-view'), 'docs');
  assert.equal(await page.locator('button.seg[aria-pressed="true"]:has-text("Documentación")').count(), 1);
  await page.selectOption('.select-lang', 'en-GB');
  await page.waitForSelector('.doc-group:has-text("Security and VPN")');
  await page.fill('.doc-search', 'wireguard');
  await page.waitForSelector('.doc-link');
  await page.click('button.seg:has-text("Network")');

  // 3. WireGuard lab: the VPN panel of the hub lists the branch, the branch pings the hub's LAN.
  const labs = page.locator('select.select >> nth=0');
  await labs.selectOption({ label: 'WireGuard VPN: hub and branch behind NAT' });
  await page.waitForSelector('text=CENTRAL');
  await page.dblclick('g.device:has-text("SUCURSAL")');
  await page.click('.win-tab:has-text("Linux terminal")');
  const type = async (line) => { await page.keyboard.type(line); await page.keyboard.press('Enter'); };
  await type('ping -c 2 10.1.0.10');
  await page.waitForTimeout(300);
  assert.match(await page.locator('.terminal:visible').innerText(), /2 received/);
  await page.click('.win-tab:has-text("Services")');
  assert.deepEqual((await page.locator('.subnav-item').allInnerTexts()).slice(0, 3), ['Parameters', 'Firewall', 'VPN'], 'router panels first');
  await page.click('.subnav-item:has-text("VPN")');
  await page.waitForSelector('.window :text("AllowedIPs")');
  await page.click('.win-close');

  // 3b. The lab comes with areas; draw a named area, a label and a freehand stroke, move the area, and they survive a reload.
  assert.ok(await page.locator('g.drawing-rect').count() >= 3, 'lab areas');
  await page.click('.pal-draw');
  await page.click('.draw-swatch[data-color="#f57c00"]');
  await page.click('.draw-tool[aria-label="Rectangle (area)"]');
  const wsb = await page.locator('.workspace').boundingBox();
  await page.mouse.move(wsb.x + 1050, wsb.y + 300); await page.mouse.down();
  await page.mouse.move(wsb.x + 1250, wsb.y + 450, { steps: 5 }); await page.mouse.up();
  await page.waitForSelector('.draw-text-input');
  await page.keyboard.type('Lab notes'); await page.keyboard.press('Enter');
  await page.click('.draw-tool[aria-label="Text label"]');
  await page.mouse.click(wsb.x + 1060, wsb.y + 500);
  await page.waitForSelector('.draw-text-input');
  await page.keyboard.type('10.99.0.0/24'); await page.keyboard.press('Enter');
  await page.click('.draw-tool[aria-label="Freehand"]');
  await page.mouse.move(wsb.x + 1060, wsb.y + 540); await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(wsb.x + 1060 + i * 10, wsb.y + 540 + (i % 2) * 12);
  await page.mouse.up();
  const texts = async () => page.locator('.drawing-label, .drawing-text').evaluateAll((ns) => ns.map((n) => n.textContent));
  assert.ok((await texts()).includes('Lab notes') && (await texts()).includes('10.99.0.0/24'), 'named area and label');
  // Drag the new area by its border with the Select tool; the periodic redraw must not cancel the move.
  await page.click('.pal-item:has-text("Select")');
  const area = page.locator('g.drawing-rect').last();
  const before = await area.boundingBox();
  await page.mouse.move(before.x + 2, before.y + before.height / 2); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(before.x + 2 + i * 8, before.y + before.height / 2 + i * 4); await page.waitForTimeout(60); }
  await page.mouse.up();
  const after = await area.boundingBox();
  assert.ok(Math.abs(after.x - before.x - 64) < 6 && Math.abs(after.y - before.y - 32) < 6, `area moved (${after.x - before.x}, ${after.y - before.y})`);
  await page.click('.pal-draw');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForSelector('g.drawing-free');
  assert.ok((await texts()).includes('Lab notes'), 'drawings are saved with the topology');

  // 3c. Deleting drawings: the bar button removes the selected one, the Delete tool removes an area tapped inside,
  // and «Delete all» (confirmed) removes the rest, lab areas included; the devices stay.
  const drawings = () => page.locator('g.drawing').count();
  const devices = await page.locator('g.device').count();
  await page.click('.pal-draw');
  assert.equal(await page.locator('.draw-delete').isDisabled(), true, 'nothing selected yet');
  await page.click('.pal-item:has-text("Select")');
  await page.getByText('10.99.0.0/24', { exact: true }).click();
  let n = await drawings();
  await page.click('.draw-delete');
  assert.equal(await drawings(), n - 1, 'Delete drawing');
  assert.ok(!(await texts()).includes('10.99.0.0/24'));
  await page.click('.pal-item:has-text("Delete")');
  const notes = await page.locator('g.drawing-rect').last().boundingBox();
  n = await drawings();
  await page.mouse.click(notes.x + notes.width / 2, notes.y + notes.height - 12);
  assert.equal(await drawings(), n - 1, 'Delete tool inside an area');
  assert.ok(!(await texts()).includes('Lab notes'));
  await page.click('.pal-item:has-text("Select")');
  page.once('dialog', (d) => d.accept());
  await page.click('.draw-delete-all');
  await page.waitForFunction(() => document.querySelectorAll('g.drawing').length === 0);
  assert.equal(await page.locator('g.device').count(), devices, 'devices are kept');
  await page.click('.pal-draw');

  // 4. SSH client app of a PC: generate a key, then the open session survives a visit to the Keys tab.
  await page.click('button.seg:has-text("Network")');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("SSH client")');
  await page.click('.subnav-item:has-text("Keys")');
  await page.click('.window button >> text="Generate key"');
  await page.waitForSelector('.window td:has-text("id_ed25519")');
  await page.click('.subnav-item:has-text("Session")');
  await page.fill('input[aria-label="Server (IP or name)"]', '10.1.0.1');
  await page.click('.window button.btn >> text="Open"');
  await page.waitForSelector('.ssh-term .terminal');
  await page.click('.subnav-item:has-text("Keys")');
  await page.click('.subnav-item:has-text("Session")');
  assert.equal(await page.locator('.ssh-term .terminal').count(), 1, 'the session pane is kept');
  if (shots) await page.screenshot({ path: `${shots}/ssh-en.png` });
  await page.click('.win-close');

  // 4b. The Windows terminal works on the Linux files of the PC: echo >, edit (Microsoft Edit), type, then cat in Linux.
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Windows terminal")');
  const typeLine = async (line) => { await page.keyboard.type(line); await page.keyboard.press('Enter'); };
  await typeLine('echo first line> notes.txt');
  await typeLine('edit notes.txt');
  await page.waitForSelector('.term-editor:visible');
  assert.match(await page.locator('.term-editor:visible').innerText(), /File {2}Edit {2}View {2}Help[\s\S]*notes\.txt - Microsoft Edit[\s\S]*first line/);
  await page.keyboard.press('Control+End');
  await page.keyboard.type('from edit');
  await page.keyboard.press('Control+s');
  assert.match(await page.locator('.term-editor:visible').innerText(), /Saved notes\.txt/);
  if (shots) await page.screenshot({ path: `${shots}/msedit-en.png` });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.term-input:visible');
  await typeLine('type notes.txt');
  assert.match(await page.locator('.terminal:visible').innerText(), /C:\\home\\alumno>type notes\.txt\nfirst line\nfrom edit/);
  await page.click('.win-tab:has-text("Linux terminal")');
  await typeLine('cat ~/notes.txt');
  assert.match(await page.locator('.terminal:visible').innerText(), /first line\nfrom edit/);
  await desk.close();

  // 5. Tablet (touch, 820×1180, English): the sticky Ctrl key shows its state and releases after use.
  const tab = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const tablet = await fresh(tab);
  assert.ok(await tablet.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll on a tablet');
  const pc = await tablet.locator('g.device-pc').first().boundingBox();
  await tablet.touchscreen.tap(pc.x + pc.width / 2, pc.y + pc.height / 2);
  await tablet.touchscreen.tap(pc.x + pc.width / 2, pc.y + pc.height / 2);
  await tablet.waitForSelector('.window');
  await tablet.tap('.win-tab:has-text("Interfaces")');
  assert.match(await tablet.locator('.window').innerText(), /FastEthernet0 · eth0[\s\S]*Switch0/, 'PC interfaces with the far end');
  const tw = await tablet.locator('.window').boundingBox();
  assert.ok(tw.x >= 0 && tw.x + tw.width <= 820, 'the window fits the tablet width');
  await tablet.tap('.win-tab:has-text("Windows terminal"), .win-tab:has-text("Linux terminal")');
  const ctrl = tablet.locator('.terminal:visible .term-keys [data-key="Ctrl"]');
  await ctrl.dispatchEvent('pointerdown');
  assert.equal(await ctrl.getAttribute('aria-pressed'), 'true');
  await tablet.keyboard.type('c');
  assert.equal(await ctrl.getAttribute('aria-pressed'), 'false', 'Ctrl released once used');
  if (shots) await tablet.screenshot({ path: `${shots}/tablet-en.png` });
  await tab.close();

  assert.deepEqual(errors, []);
  console.log('e2e v0.7: ok');
} finally {
  await browser.close();
  server.kill();
}
