// End-to-end check (v0.28) of Windows name resolution in Simulation mode: `ping pc2.local` (mDNS, multicast) and
// `ping pc2` (NetBIOS, broadcast) are captured with their own filters, rows and PDU detail; nbtstat in the terminal.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8112;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-ES' });
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device');
  await page.locator('select.select').first().selectOption('basico');
  await page.waitForTimeout(300);

  // The filters list the new protocols, ticked.
  await page.click('button.seg:has-text("Simulación")');
  for (const p of ['MDNS', 'NBNS', 'SMB']) assert.equal(await page.locator(`.filters label:has-text("${p}") input`).isChecked(), true, p);

  const type = async (line) => { await page.locator('.terminal:visible input.term-input').fill(line); await page.keyboard.press('Enter'); await page.waitForTimeout(250); };
  await page.dblclick('g.device:has-text("PC0")');
  await page.click('.win-tab:has-text("Terminal Windows")');
  await type('ping -n 1 pc2.local');
  await type('ping -n 1 pc2');
  assert.match(await page.locator('.terminal:visible').innerText(), /Pinging pc2\.local \[[\d.]+\][\s\S]*Reply from[\s\S]*Pinging pc2 \[[\d.]+\][\s\S]*Reply from/);
  await type('nbtstat -n');
  assert.match(await page.locator('.terminal:visible').innerText(), /NetBIOS Local Name Table[\s\S]*WORKGROUP +<00>  GROUP/);
  await page.click('.win-close');

  const events = await page.locator('.events tbody').innerText();
  assert.match(events, /MDNS A\? pc2\.local/, 'the mDNS question');
  assert.match(events, /MDNS NOERROR pc2\.local/, 'the mDNS answer');
  assert.match(events, /NBNS Query PC2<00>/);
  assert.match(events, /NBNS Response PC2<00>/);
  await page.locator('.events tbody tr', { hasText: 'NBNS Response PC2<00>' }).first().click();
  const pdu = await page.locator('.pdu').innerText();
  assert.match(pdu, /UDP 137 → 137 · NetBIOS Name Service/);
  assert.match(pdu, /PC2<00> NB/);
  await page.locator('.events tbody tr', { hasText: 'MDNS A? pc2.local' }).first().click();
  assert.match(await page.locator('.pdu').innerText(), /UDP 5353 → 5353 · mDNS[\s\S]*pc2\.local IN A/);
  assert.match(await page.locator('.pdu').innerText(), /01:00:5e:00:00:fb|0100\.5e00\.00fb/i, 'to the mDNS group MAC');
  if (shots) await page.screenshot({ path: `${shots}/sim-netbios.png` });

  // A filter off stops capturing that protocol.
  await page.locator('.filters label:has-text("NBNS") input').uncheck();
  assert.deepEqual(errors, []);
  console.log('e2e netbios OK: MDNS and NBNS captured with rows and PDU detail, nbtstat in the Windows terminal');
} finally {
  await browser.close();
  server.kill();
}
