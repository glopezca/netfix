// End-to-end check of apt (v0.26): a server placed from the palette brings no service; in a lab with Internet,
// `sudo apt install` in its GNU/Linux terminal adds the service panel at once (same window, same tab, same session),
// the Configuración box follows, and `apt moo` draws the cow.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8111;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

const run = async (page, cmd) => {
  const term = page.locator('.terminal:visible');
  await term.locator('input.term-input').fill(cmd);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  return term.locator('.term-screen').innerText();
};

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-ES' });
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device');
  const win = page.locator('.window:visible');
  const tabs = () => win.locator('.win-tab').allInnerTexts();

  // A server placed from the palette: Servicios has only the kernel parameters (no box); no service is ticked.
  await page.locator('select.select').first().selectOption('basico');
  await page.waitForTimeout(300);
  await page.click('.pal-item:has-text("Servidor")');
  await page.mouse.click(1150, 700);
  await page.locator('g.device-server').last().dblclick();
  assert.deepEqual(await tabs(), ['Equipo', 'Interfaces', 'Servicios', 'TCP/IP', 'Terminal GNU/Linux', 'Configuración']);
  await win.locator('.win-tab:has-text("Servicios")').click();
  assert.deepEqual(await win.locator('.subnav-item').allInnerTexts(), ['Parámetros', 'Configuración', 'Registros']);
  await win.locator('.win-tab:text-is("Configuración")').click();
  assert.equal(await win.locator('input[name="dev-http"]').isChecked(), false);
  assert.equal(await win.locator('input[name="dev-sysctl"]').count(), 0);
  await win.locator('.win-close').click();

  // The Internet lab: SRV-SEDE2 has a way out and 8.8.8.8; apt install adds DHCP while the terminal stays open.
  await page.locator('select.select').first().selectOption('internet');
  await page.waitForTimeout(300);
  await page.dblclick('g.device:has-text("SRV-SEDE2")');
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'sudo apt update'), /Hit:4 http:\/\/security\.ubuntu\.com\/ubuntu resolute-security InRelease[\s\S]*All packages are up to date\./);
  const out = await run(page, 'sudo apt install -y kea-dhcp4-server');
  assert.match(out, /Setting up kea-dhcp4-server/);
  await page.waitForTimeout(300);
  assert.equal(await win.locator('.win-tab[aria-selected="true"]').innerText(), 'Terminal GNU/Linux', 'same tab after the redraw');
  assert.match(await win.locator('.term-screen').innerText(), /Setting up kea-dhcp4-server/, 'same session');
  assert.match(await run(page, 'apt moo'), /\(__\)[\s\S]*\.\.\."[^"]+"\.\.\./);
  if (shots) await page.screenshot({ path: `${shots}/apt.png` });
  await win.locator('.win-tab:has-text("Servicios")').click();
  assert.equal(await win.locator('.subnav-item:has-text("DHCP")').count(), 1, 'the DHCP panel is there');
  await win.locator('.win-tab:text-is("Configuración")').click();
  assert.equal(await win.locator('input[name="dev-dhcp"]').isChecked(), true, 'and its box');
  await win.locator('.win-close').click();

  // v0.27: nmcli and mDNS can be installed on any GNU/Linux device, a PC too.
  await page.dblclick('g.device:has-text("PC1")');
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'nmcli'), /sudo apt install network-manager/);
  assert.match(await run(page, 'sudo apt install -y network-manager avahi-daemon'), /Setting up avahi-daemon/);
  assert.match(await run(page, 'nmcli d'), /eth0 +ethernet +connected +netplan-eth0/);
  assert.deepEqual(errors, []);
  console.log('e2e apt OK: placed server without services, apt update/install over the emulated Internet, panel and box at once, moo, nmcli on a PC');
} finally {
  await browser.close();
  server.kill();
}
