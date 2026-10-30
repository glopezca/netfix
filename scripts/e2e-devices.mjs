// End-to-end check of each device's Configuración tab (v0.25): a PC of a lab shows only what it uses, the tab adds
// SFTP and removes the browser; a server without DHCP greys it in its web GUI, and the lab option hides it there.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8110;
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
  await page.locator('select.select').first().selectOption('servidores');
  await page.waitForTimeout(300);
  const win = page.locator('.window:visible');
  const tabs = () => win.locator('.win-tab').allInnerTexts();

  // PC0 (Windows, with a mail account): no SFTP, a single terminal; its Configuración tab adds SFTP and drops the browser.
  await page.dblclick('g.device:has-text("PC0")');
  assert.deepEqual(await tabs(), ['Equipo', 'Interfaces', 'TCP/IP', 'Navegador', 'Correo', 'Cliente SSH', 'Terminal Windows', 'Configuración']);
  await win.locator('.win-tab:text-is("Configuración")').click();
  await win.locator('input[name="dev-sftp"]').check();
  await win.locator('input[name="dev-browser"]').uncheck();
  // The window is redrawn after the change (deferred): wait for the new tabs.
  await page.waitForFunction(() => ![...document.querySelectorAll('.window .win-tab')].some((b) => b.textContent === 'Navegador'));
  assert.deepEqual(await tabs(), ['Equipo', 'Interfaces', 'TCP/IP', 'Correo', 'Cliente SSH', 'Archivos (SFTP)', 'Terminal Windows', 'Configuración']);
  assert.equal(await win.locator('.win-tab[aria-selected="true"]').innerText(), 'Configuración', 'the window reopens on the tab');
  if (shots) await page.screenshot({ path: `${shots}/device-config.png` });
  await win.locator('.win-close').click();

  // The server: DHCP off in its tab, the web GUI on; PC1's browser sees DHCP greyed out.
  await page.dblclick('g.device-server');
  await win.locator('.win-tab:text-is("Configuración")').click();
  await win.locator('input[name="dev-dhcp"]').uncheck();
  await win.locator('.win-tab:has-text("Servicios")').click();
  assert.equal(await win.locator('.subnav-item:has-text("DHCP")').count(), 0);
  await win.locator('.subnav-item:has-text("HTTP")').click();
  const admin = win.locator('.subsection', { has: page.locator('h3', { hasText: 'Gestión web del servidor' }) });
  await admin.locator('input[type="checkbox"]').check();
  await admin.locator('button:has-text("Aplicar")').click();
  await win.locator('.win-close').click();
  await page.dblclick('g.device:has-text("PC1")');
  await win.locator('.win-tab:has-text("Navegador")').click();
  const go = async (url) => { await page.fill('.window:visible .url-bar', url); await page.press('.window:visible .url-bar', 'Enter'); await page.waitForTimeout(150); };
  await go('http://192.168.10.2:10000/?page=status');
  await page.fill('.window:visible .browser-auth input >> nth=0', 'admin');
  await page.fill('.window:visible .browser-auth input >> nth=1', 'netfix');
  await page.click('.window:visible .browser-auth button');
  await page.waitForSelector('.browser-view .web-adm-nav-dns');
  assert.equal(await page.locator('.browser-view .web-adm-nav-dhcp.web-adm-off').count(), 1, 'greyed out');
  const opacity = await page.locator('.browser-view .web-adm-nav-dhcp').evaluate((n) => Number(getComputedStyle(n).opacity));
  assert.ok(opacity < 0.6, `drawn faded (${opacity})`);
  if (shots) await page.screenshot({ path: `${shots}/webgui-off.png` });

  // Configuración → Laboratorio actual: hide what is off; the GUI no longer lists DHCP.
  await page.click('button.seg:has-text("Configuración")');
  await page.locator('.settings input[data-feature="webHideOff"]').check();
  await page.click('button.seg:has-text("Red")'); // PC1's window is still open on its browser
  await go('http://192.168.10.2:10000/?page=status');
  await page.waitForSelector('.browser-view .web-adm-nav-dns');
  assert.equal(await page.locator('.browser-view .web-adm-nav-dhcp').count(), 0, 'not shown at all');
  assert.deepEqual(errors, []);
  console.log('e2e devices OK: per-device tabs, reopen on Configuración, web GUI greys or hides what is off');
} finally {
  await browser.close();
  server.kill();
}
