// End-to-end check (v0.37): on WIN-A of «Nombres en GNU/Linux», the box «Compartir archivos e impresoras para redes
// Microsoft» of its Configuración tab, a share added in Servicios → SMB and seen by net share; on LNX-A, smbclient
// installed with its box in Configuración → Paquetes, a file uploaded to the share, and the box unticked again; the
// lab's package catalogue and sharing box in Configuración → Laboratorio actual; and in «Servidores», the pool's
// WINS server (option 44) in Servicios → DHCP, written to kea-dhcp4.conf and received by PC0.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8115;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

/** Runs a line in the visible terminal and returns what that line printed. */
const run = async (page, cmd) => {
  const screen = page.locator('.terminal:visible .term-screen');
  const before = (await screen.innerText()).length;
  await page.locator('.terminal:visible input.term-input').fill(cmd);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  return (await screen.innerText()).slice(before);
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
  await page.locator('select.select').first().selectOption('nombres-resolved');
  await page.waitForTimeout(300);
  const win = page.locator('.window:visible');
  const tabs = () => win.locator('.win-tab').allInnerTexts();
  const tab = (name) => win.locator(`.win-tab:text-is("${name}")`).click();
  // A box redraws the window after the current event (device-windows.ts).
  const tick = async (box, on) => { await box.setChecked(on); await page.waitForTimeout(300); };

  // 1. WIN-A: no Servicios until the box is ticked; then Servicios → SMB shares a folder, and net share lists it.
  await page.dblclick('g.device:has-text("WIN-A")');
  assert.ok(!(await tabs()).includes('Servicios'));
  await tab('Configuración');
  await tick(win.locator('input[name="dev-winshare"]'), true);
  assert.ok((await tabs()).includes('Servicios'), 'the box brings Servicios → SMB');
  await tab('Terminal Windows');
  await run(page, 'md C:\\home\\alumno\\docs');
  await tab('Servicios');
  assert.deepEqual(await win.locator('.subnav-item').allInnerTexts(), ['SMB']);
  await win.getByLabel('Recurso', { exact: true }).fill('docs');
  await win.getByLabel('Carpeta', { exact: true }).fill('C:\\home\\alumno\\nada');
  await win.getByRole('combobox', { name: /^Permiso/ }).selectOption('full');
  await win.locator('button:text-is("Añadir")').click();
  assert.equal(await win.locator('.form-msg[data-kind="error"]').count(), 1, 'a missing folder is refused');
  await win.getByLabel('Carpeta', { exact: true }).fill('C:\\home\\alumno\\docs');
  await win.getByLabel('Comentario', { exact: true }).fill('Mis documentos');
  await win.locator('button:text-is("Añadir")').click();
  const shares = await win.locator('table').first().innerText();
  assert.match(shares, /docs\s+C:\\home\\alumno\\docs\s+Mis documentos\s+Todos: Control total/);
  if (shots) await page.screenshot({ path: `${shots}/win-smb.png` });
  await tab('Terminal Windows');
  assert.match(await run(page, 'net share'), /\ndocs {9}C:\\home\\alumno\\docs {13}Mis documentos\n/);
  await win.locator('.win-close').click();

  // 2. LNX-A: smbclient comes with its box in Configuración → Paquetes, writes into the share, and goes with it.
  await page.dblclick('g.device:has-text("LNX-A")');
  await tab('Terminal GNU/Linux');
  assert.match(await run(page, 'smbclient -L win-a -N'), /Command 'smbclient' not found, but can be installed with:\nsudo apt install smbclient/);
  await tab('Configuración');
  const pkg = win.locator('input[name="dev-pkg-smbclient"]');
  await tick(pkg, true);
  await tab('Terminal GNU/Linux');
  assert.match(await run(page, 'smbclient -L win-a -N'), /docs +Disk +Mis documentos/);
  assert.match(await run(page, "smbclient //win-a/docs -N -c 'put /etc/hostname linux.txt'"), /putting file \/etc\/hostname as \\linux\.txt/);
  await tab('Configuración');
  await tick(pkg, false);
  await tab('Terminal GNU/Linux');
  assert.match(await run(page, 'smbclient -L win-a -N'), /Command 'smbclient' not found, but can be installed with:\nsudo apt install smbclient/, 'the unticked box is apt remove');
  await win.locator('.win-close').click();
  await page.dblclick('g.device:has-text("WIN-A")');
  await tab('Terminal Windows');
  assert.match(await run(page, 'dir C:\\home\\alumno\\docs'), /linux\.txt/);
  await win.locator('.win-close').click();

  // 3. Configuración → Laboratorio actual: a package out of the repository, and sharing off for the PCs.
  await page.click('button.seg:has-text("Configuración")');
  const settings = page.locator('.settings');
  await settings.waitFor();
  const catalogue = settings.locator('fieldset[data-kind="packages"] input[data-pkg="smbclient"]');
  assert.ok(await catalogue.isChecked());
  await catalogue.uncheck();
  await settings.locator('input[data-feature="pc:winshare"]').uncheck();
  await page.click('button.seg:has-text("Red")');
  await page.dblclick('g.device:has-text("LNX-A")');
  await tab('Configuración');
  assert.equal(await win.locator('input[name="dev-pkg-smbclient"]').count(), 0);
  await tab('Terminal GNU/Linux');
  assert.match(await run(page, 'sudo apt install -y smbclient'), /Unable to locate package smbclient/);
  await win.locator('.win-close').click();
  await page.dblclick('g.device:has-text("WIN-A")');
  assert.ok(!(await tabs()).includes('Servicios'), 'the lab took sharing away');
  await tab('Configuración');
  assert.equal(await win.locator('input[name="dev-winshare"]').count(), 0);
  await win.locator('.win-close').click();

  // 4. «Servidores»: the WINS server of SRV's pool reaches kea-dhcp4.conf and PC0's lease.
  await page.locator('select.select').first().selectOption('servidores');
  await page.waitForTimeout(300);
  await page.locator('g.device-server').first().dblclick();
  await tab('Servicios');
  await win.locator('.subnav-item:text-is("DHCP")').click();
  await win.locator('tr', { hasText: 'serverPool' }).first().click();
  await win.getByLabel('Servidor WINS (opción 44)').fill('192.168.10.2');
  await win.locator('button:text-is("Guardar cambios")').click();
  await tab('Terminal GNU/Linux');
  assert.match(await run(page, 'grep netbios /etc/kea/kea-dhcp4.conf'), /"name": "netbios-name-servers", "data": "192\.168\.10\.2"/);
  await win.locator('.win-close').click();
  await page.locator('g.device-pc').first().dblclick();
  await tab('Terminal Windows');
  await run(page, 'ipconfig /renew');
  await page.waitForTimeout(600);
  assert.match(await run(page, 'ipconfig /all'), /Primary WINS Server[ .]+: 192\.168\.10\.2/);
  await win.locator('.win-close').click();
  assert.deepEqual(errors, []);
  console.log('e2e winshare OK: the Windows sharing box, Servicios → SMB and net share, smbclient from its package box, the lab catalogue and sharing box, and the pool\'s WINS server');
} finally {
  await browser.close();
  server.kill();
}
