// End-to-end check of phase 23: broadcast ping from the terminal and the «Nombres públicos» list of the DNS server.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8097;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
const run = async (page, cmd) => {
  const term = page.locator('.terminal:visible');
  const before = await term.locator('.term-screen').innerText();
  await term.locator('input.term-input').fill(cmd);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  return (await term.locator('.term-screen').innerText()).slice(before.length);
};
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
  // A lab over unsaved changes asks first (scripts/e2e-unsaved.mjs checks it); these flows always go ahead.
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.selectOption('select.select >> nth=0', 'servidores');

  // Server → Servicios → DNS: the «Nombres públicos» block, on and applied.
  await page.dblclick('g.device-server');
  await page.click('.win-tab:has-text("Servicios")');
  await page.click('.subnav-item:has-text("DNS")');
  // The policy applies to recursive queries (as in BIND): the lab's server is authoritative only.
  await page.locator('section.dns-mode[data-mode="recursive"] input[type="checkbox"]').first().check();
  await page.waitForSelector('section.dns-mode[data-mode="recursive"][data-on="yes"]');
  const block = page.locator('.rpz-block');
  assert.match(await block.locator('textarea').inputValue(), /^google\.es\s+A 142\.250\.200\.67$/m);
  await block.locator('label.check input').check();
  await block.locator('button:has-text("Aplicar (systemctl restart bind9)")').click();
  await page.waitForSelector('.window:visible .form-msg[data-kind="ok"]');
  if (shots) await page.screenshot({ path: `${shots}/rpz.png` });
  await page.click('.win-close');

  // A PC of the lab (no Internet) resolves google.es through the server; a broadcast ping needs -b.
  await page.dblclick('g.device-pc >> nth=1'); // PC1 runs Linux
  await page.click('.win-tab:has-text("Terminal GNU/Linux")');
  const dig = await run(page, 'dig +short google.es');
  assert.match(dig, /142\.250\.200\.67/, dig);
  assert.match(await run(page, 'ping -c 1 192.168.10.255'), /Do you want to ping broadcast\? Then -b/);
  assert.match(await run(page, 'ping -b -c 1 192.168.10.255'), /WARNING: pinging broadcast address/);
  if (shots) await page.screenshot({ path: `${shots}/broadcast.png` });
  assert.deepEqual(errors, []);
  console.log('e2e v0.15 OK');
} finally {
  await browser.close();
  server.kill();
}
