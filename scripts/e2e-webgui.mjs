// End-to-end check of the server's web GUI as the simulated browser draws it (v0.19.7): «Gestión web del servidor»
// before Roundcube in Servicios → HTTP, the 🔧 icon of «Configuración», and vim's colours really painted on the
// configuration files and logs (the browser only keeps `web-*` classes, so the highlight must use them).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8104;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device');
  await page.locator('select.select').first().selectOption('servidores');
  await page.waitForTimeout(300);

  // Servicios → HTTP: the server's web management first, then Roundcube; turn the management on.
  await page.dblclick('g.device-server');
  const win = page.locator('.window:visible');
  await win.locator('.win-tab:has-text("Servicios")').click();
  await win.locator('.subnav-item:has-text("HTTP")').click();
  const apps = await win.locator('.subsection h3').allInnerTexts();
  assert.deepEqual(apps.slice(-2), ['Gestión web del servidor', 'Roundcube (correo web)']);
  const admin = win.locator('.subsection', { has: page.locator('h3', { hasText: 'Gestión web del servidor' }) });
  await admin.locator('input[type="checkbox"]').check();
  await admin.locator('button:has-text("Aplicar")').click();
  await win.locator('.win-close').click();

  // PC0's browser: sign in and open Configuración (DNS) and Registros.
  await page.dblclick('g.device:has-text("PC0")');
  await page.locator('.window:visible .win-tab:has-text("Navegador")').click();
  const go = async (url) => { await page.fill('.window:visible .url-bar', url); await page.press('.window:visible .url-bar', 'Enter'); await page.waitForTimeout(150); };
  await go('http://192.168.10.2:10000/');
  await page.fill('.window:visible .browser-auth input >> nth=0', 'admin');
  await page.fill('.window:visible .browser-auth input >> nth=1', 'netfix');
  await page.click('.window:visible .browser-auth button');
  await page.waitForSelector('.browser-view .web-adm-nav-files');
  // A monochrome wrench like the other glyphs: a mask painted in the text colour, the width of the other icons.
  const icon = (sel) => page.locator(sel).evaluate((n) => { const b = getComputedStyle(n, '::before'); return { mask: b.maskImage || b.webkitMaskImage, bg: b.backgroundColor, color: getComputedStyle(n).color, width: b.width }; });
  const wrench = await icon('.browser-view .web-adm-nav-files');
  assert.match(wrench.mask, /^url\("data:image\/svg\+xml/);
  assert.equal(wrench.bg, wrench.color, 'painted in the menu text colour');
  assert.equal(wrench.width, (await icon('.browser-view .web-adm-nav-log')).width, 'as wide as the other icons');
  if (shots) { await page.locator('.browser-view .web-adm-nav-log').scrollIntoViewIfNeeded(); await page.locator('.browser-view .web-adm-menu').screenshot({ path: join(shots, 'webgui-menu.png') }); }
  await go('http://192.168.10.2:10000/?page=files&svc=dns');
  assert.doesNotMatch(await page.locator('.browser-view').innerText(), /wa\.desc\./, 'every page has its description');
  const pre = page.locator('.browser-view pre.web-syn-view').first();
  const colour = (sel) => pre.locator(sel).first().evaluate((n) => getComputedStyle(n).color);
  assert.equal(await colour('.web-syn-statement'), 'rgb(165, 42, 42)', 'vim Statement (light background)');
  assert.equal(await colour('.web-syn-comment'), 'rgb(0, 0, 255)', 'vim Comment');
  assert.equal(await colour('.web-syn-string'), 'rgb(255, 0, 255)', 'vim Constant');
  if (shots) await page.locator('.browser-view').screenshot({ path: join(shots, 'webgui-files.png') });
  await go('http://192.168.10.2:10000/?page=log');
  const log = page.locator('.browser-view pre.web-syn-messages');
  assert.equal(await log.locator('.web-syn-type').first().evaluate((n) => getComputedStyle(n).color), 'rgb(46, 139, 87)', 'vim Type for the time');
  if (shots) await page.locator('.browser-view').screenshot({ path: join(shots, 'webgui-log.png') });
  assert.deepEqual(errors, []);
  console.log('e2e web GUI OK: management before Roundcube, monochrome wrench for Configuración, vim colours painted on files and logs');
} finally {
  await browser.close();
  server.kill();
}
