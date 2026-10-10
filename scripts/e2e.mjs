// End-to-end check of the built app with Playwright (uses a global install if no local one).
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
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const shots = process.env.SHOTS_DIR;
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');

  // 1. CLI: configure a manual binding for PC0 through the console.
  await page.dblclick('g.device-router');
  const type = async (line) => { await page.keyboard.type(line); await page.keyboard.press('Enter'); };
  await type('no');
  await type('');
  await type('enable');
  await type('show ip dhcp binding');
  await page.waitForTimeout(100);
  const text = await page.locator('.terminal').first().innerText();
  assert.match(text, /192\.168\.10\.21/, 'binding table lists PC addresses');
  await type('conf t');
  await type('ip dhcp pool LAN');
  await page.keyboard.type('address 192.168.10.5 ?');
  await page.waitForTimeout(100);
  assert.match(await page.locator('.terminal').first().innerText(), /client-id\s+Client identifier/);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  if (shots) await page.screenshot({ path: `${shots}/cli.png` });
  await page.click('.win-close');

  // 2. PC desktop: renew via DHCP in simulation mode and replay the DORA.
  await page.click('button.seg:has-text("Simulación")');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Símbolo del sistema")');
  await type('ipconfig /release');
  await type('ipconfig /renew');
  await page.waitForTimeout(200);
  assert.match(await page.locator('.terminal').last().innerText(), /IPv4 Address\.+: 192\.168\.10\.\d+/);
  const rows = await page.locator('.events tbody tr').count();
  assert.ok(rows >= 4, `expected DHCP events, got ${rows}`);
  await page.click('.win-tab:has-text("Configuración IP")');
  if (shots) await page.screenshot({ path: `${shots}/pc.png` });
  await page.click('.win-close');
  await page.click('.sim-controls button:has-text("Paso")');
  await page.click('.sim-controls button:has-text("Paso")');
  await page.waitForTimeout(400);
  assert.match(await page.locator('.pdu').innerText(), /Ethernet II/);
  assert.match(await page.locator('.events').innerText(), /DHCP DISCOVER[\s\S]*DHCP OFFER[\s\S]*DHCP REQUEST[\s\S]*DHCP ACK/);
  if (shots) await page.screenshot({ path: `${shots}/sim.png` });

  // 3. Build a link with the cable tool.
  await page.click('button.seg:has-text("Tiempo real")');
  await page.click('.pal-item:has-text("PC")');
  await page.mouse.click(1100, 600);
  if (shots) await page.screenshot({ path: `${shots}/placed.png` });
  await page.click('.pal-cable');
  await page.click('g.device-pc >> nth=3');
  await page.click('.port-item:has-text("FastEthernet0")');
  await page.click('g.device-switch');
  await page.click('.port-item:has-text("FastEthernet0/10")');
  assert.equal(await page.locator('g.link').count(), 5);
  assert.deepEqual(errors, []);
  console.log('e2e: ok');
} finally {
  await browser.close();
  server.kill();
}
