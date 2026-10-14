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
  await desk.close();

  // 5. Tablet (touch, 820×1180, English): the sticky Ctrl key shows its state and releases after use.
  const tab = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const tablet = await fresh(tab);
  assert.ok(await tablet.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll on a tablet');
  const pc = await tablet.locator('g.device-pc').first().boundingBox();
  await tablet.touchscreen.tap(pc.x + pc.width / 2, pc.y + pc.height / 2);
  await tablet.touchscreen.tap(pc.x + pc.width / 2, pc.y + pc.height / 2);
  await tablet.waitForSelector('.window');
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
