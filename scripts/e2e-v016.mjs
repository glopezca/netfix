// End-to-end check of phase 24: interface names on their cables (never over a device's name or addresses), the
// cloud's «Equipo» tab, the read-only host name and resolvectl (v0.17).
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
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

/** Cable-end labels (interface name and addresses) that overlap another one, a device's texts or an area's name. */
const overlaps = (page) => page.evaluate(() => {
  const box = (e) => e.getBoundingClientRect();
  const hit = (a, b) => a.left + 1 < b.right && b.left + 1 < a.right && a.top + 1 < b.bottom && b.top + 1 < a.bottom;
  const ends = [...document.querySelectorAll('.port-end')];
  const name = (e) => [...e.querySelectorAll('text')].map((x) => x.textContent).join(' ');
  const others = [...document.querySelectorAll('g.device .device-label, g.device .device-host, g.device .device-model, .drawing-label, .drawing-text')];
  const found = [];
  ends.forEach((e, i) => {
    for (const f of ends.slice(i + 1)) if (hit(box(e), box(f))) found.push(`${name(e)} × ${name(f)}`);
    for (const o of others) if (hit(box(e), box(o))) found.push(`${name(e)} × ${o.textContent}`);
  });
  return found;
});

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  const labs = page.locator('select.select').first();
  // Every lab (v0.18: the address under its interface name, longer cables where needed).
  const ids = (await labs.locator('option').evaluateAll((os) => os.map((o) => o.value))).filter((v) => v);
  for (const lab of ids) {
    await labs.selectOption(lab);
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('.zoom-fit, button[aria-label*="Ajustar"]')?.click());
    assert.deepEqual(await overlaps(page), [], `${lab}: cable-end labels clear of each other, the devices and the areas`);
  }

  // Cloud: «Equipo» first, the name applies on change, the host name is derived and read-only.
  const titles = await labs.locator('option').allTextContents();
  await labs.selectOption({ label: titles.find((o) => o.startsWith('Internet')) });
  await page.waitForSelector('g.device-cloud');
  await page.dblclick('g.device-cloud >> nth=0');
  assert.equal(await page.locator('.window:visible .win-tab').first().innerText(), 'Equipo');
  const win = page.locator('.window:visible');
  assert.equal(await win.locator('input[name="hostname"]').getAttribute('readonly'), '');
  await win.locator('input[name="label"]').fill('Operador Norte');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.window input[name="hostname"]')?.value === 'operador-norte');
  const caption = await page.locator('g.device-cloud', { hasText: 'Operador Norte' }).locator('text').allTextContents();
  assert.ok(caption.some((x) => /^\d+\.\d+\.0\.0\/16$/.test(x)), `the public block under the name: ${caption.join(' | ')}`);
  if (shots) await page.screenshot({ path: `${shots}/cloud.png` });
  await page.click('.win-close');

  // A PC: the terminal cannot change the host name.
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Terminal Linux")');
  const term = page.locator('.terminal:visible');
  await term.locator('input.term-input').fill('sudo hostname otro');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.match(await term.locator('.term-screen').innerText(), /nombre del equipo/);
  // v0.17: resolvectl through the same resolver.
  await term.locator('input.term-input').fill('resolvectl query www.aula.lab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.match(await term.locator('.term-screen').innerText(), /www\.aula\.lab: 192\.168\.10\.2 +-- link: eth0/);
  if (shots) await page.screenshot({ path: `${shots}/labels.png` });
  assert.deepEqual(errors, []);
  console.log('e2e v0.16 OK');
} finally {
  await browser.close();
  server.kill();
}
