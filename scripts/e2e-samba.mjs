// End-to-end check (v0.33) of the Servicios tab of a GNU/Linux PC and of the Samba panel: PC1 has the kernel parameters
// and its files; apt install nftables samba adds Firewall, Samba and Registros at once, apt remove takes them away; on
// SRV the Samba panel adds a share that testparm then shows.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8113;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

const run = async (page, cmd) => {
  const term = page.locator('.terminal:visible');
  await term.locator('input.term-input').fill(cmd);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
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
  await page.locator('select.select').first().selectOption('samba');
  await page.waitForTimeout(300);
  const win = page.locator('.window:visible');
  const subnav = async () => { await win.locator('.win-tab:has-text("Servicios")').click(); return win.locator('.subnav-item').allInnerTexts(); };

  // PC1 (GNU/Linux): the kernel parameters and its files, and no web GUI; apt brings the rest and takes it away.
  await page.dblclick('g.device:has-text("PC1")');
  assert.deepEqual(await subnav(), ['Parámetros', 'Configuración']);
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'sudo apt install -y nftables samba'), /Setting up samba/);
  await page.waitForTimeout(300);
  assert.deepEqual(await subnav(), ['Parámetros', 'Firewall', 'Samba', 'Configuración', 'Registros']);
  await win.locator('.subnav-item:has-text("Registros")').click();
  assert.deepEqual(await win.locator('.subnav-content select option').allInnerTexts(), ['smbd (activo)', 'nmbd (activo)', 'nftables (parado)']);
  if (shots) await page.screenshot({ path: `${shots}/pc-services.png` });
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  await run(page, 'sudo apt remove -y nftables samba');
  await page.waitForTimeout(300);
  assert.deepEqual(await subnav(), ['Parámetros', 'Configuración'], 'apt remove takes the panels away');
  await win.locator('.win-close').click();

  // SRV: the Samba panel lists publico and profes; a share added here is in smb.conf.
  await page.dblclick('g.device:has-text("SRV")');
  assert.ok((await subnav()).includes('Samba'));
  await win.locator('.subnav-item:has-text("Samba")').click();
  const pane = win.locator('.subnav-content');
  assert.match(await pane.innerText(), /publico[\s\S]*profes/);
  await pane.locator('input[aria-label="Recurso"]').fill('docs');
  await pane.locator('input[aria-label="Carpeta"]').fill('/srv/samba/docs');
  await pane.locator('button:text-is("Añadir")').click();
  await page.waitForTimeout(200);
  assert.match(await pane.locator('table').first().innerText(), /docs\s+\/srv\/samba\/docs/);
  await pane.locator('input[aria-label="Recurso"]').fill('docs');
  await pane.locator('input[aria-label="Carpeta"]').fill('/srv/x');
  await pane.locator('button:text-is("Añadir")').click();
  assert.match(await pane.locator('.form-msg').innerText(), /Ya hay un recurso con ese nombre/);
  if (shots) await page.screenshot({ path: `${shots}/samba-panel.png` });
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'testparm -s 2>/dev/null | grep -A4 "\\[docs\\]"'), /\[docs\][\s\S]*path = \/srv\/samba\/docs/);
  await win.locator('.win-close').click();

  // The lab: «Servicio Samba» for PCs, servers and GNU/Linux routers, on by default. Off for PCs, PC1's Configuración has no Samba box.
  await page.click('button.seg[data-view="settings"]');
  for (const kind of ['pc', 'server', 'linuxrouter']) assert.equal(await page.locator(`input[data-feature="${kind}:samba"]`).isChecked(), true, kind);
  await page.locator('input[data-feature="pc:samba"]').uncheck();
  await page.click('button.seg[data-view="net"]');
  await page.dblclick('g.device:has-text("PC1")');
  await win.locator('.win-tab:has-text("Configuración")').first().click();
  assert.equal(await win.locator('input[name="dev-samba"]').count(), 0, 'no Samba box on a PC');
  await win.locator('.win-close').click();
  await page.dblclick('g.device:has-text("SRV")');
  await win.locator('.win-tab:has-text("Configuración")').first().click();
  assert.equal(await win.locator('input[name="dev-samba"]').isChecked(), true, 'the server keeps its Samba, ticked');

  // Service packages in the catalogue (v0.38): the bind9 box and the DNS box are one; the terminal's apt agrees.
  const cfg = async () => { await win.locator('.win-tab:has-text("Configuración")').first().click(); await page.waitForTimeout(200); };
  assert.equal(await win.locator('input[name="dev-pkg-samba"]').isChecked(), true, 'samba in the service packages, ticked');
  assert.equal(await win.locator('input[name="dev-pkg-bind9"]').isChecked(), false);
  await win.locator('input[name="dev-pkg-bind9"]').check();
  await page.waitForTimeout(300);
  await cfg();
  assert.equal(await win.locator('input[name="dev-dns"]').isChecked(), true, 'installing bind9 ticks the DNS box');
  assert.ok((await subnav()).includes('DNS'), 'and brings the DNS panel');
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'apt list --installed 2>/dev/null | grep ^bind9/'), /bind9\/resolute,now/);
  await run(page, 'sudo apt remove -y bind9');
  await page.waitForTimeout(300);
  await cfg();
  assert.equal(await win.locator('input[name="dev-dns"]').isChecked(), false, 'apt remove unticks the DNS box');
  assert.equal(await win.locator('input[name="dev-pkg-bind9"]').isChecked(), false, 'and the package box');
  await win.locator('.win-close').click();
  // The lab takes bind9 away: no package box and no DNS box on a server without DNS.
  await page.click('button.seg[data-view="settings"]');
  await page.locator('fieldset[data-kind="packages"] input[data-pkg="bind9"]').uncheck();
  await page.click('button.seg[data-view="net"]');
  await page.dblclick('g.device:has-text("SRV")');
  await cfg();
  assert.equal(await win.locator('input[name="dev-pkg-bind9"]').count(), 0);
  assert.equal(await win.locator('input[name="dev-dns"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('e2e samba OK: PC Servicios follows apt install/remove (no web GUI), Samba panel adds a share on SRV, Samba per kind in the lab settings, service packages in the catalogue');
} finally {
  await browser.close();
  server.kill();
}
