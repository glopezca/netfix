// End-to-end check (v0.36) of the lab «Nombres en GNU/Linux: systemd-resolved, NSS y WINS»: on LNX-A, LLMNR=yes in
// resolved.conf with nano and a restart of systemd-resolved, resolvectl status and query, and getent without
// libnss-resolve; on LNX-B, nmblookup -U -R and getent through the NSS source wins; on WIN-B, the WINS server of the
// TCP/IP tab, ipconfig /all, and the NBNS registration rows and PDU in Simulación.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8114;
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
  const names = await page.locator('optgroup[label="Resolución de nombres"] option').allInnerTexts();
  assert.equal(names.length, 4);
  assert.ok(names.includes('Nombres en GNU/Linux: systemd-resolved, NSS y WINS'), names.join(' | '));
  await page.locator('select.select').first().selectOption('nombres-resolved');
  await page.waitForTimeout(300);
  const win = page.locator('.window:visible');

  // 1. LNX-A: LLMNR is off; nano turns it on in resolved.conf, and only the restart applies it.
  await page.dblclick('g.device:has-text("LNX-A")');
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'resolvectl status'), /Global\n +Protocols: -LLMNR -mDNS/);
  assert.match(await run(page, 'resolvectl query win-a'), /resolve call failed/);
  await page.locator('.terminal:visible input.term-input').fill('sudo nano /etc/systemd/resolved.conf');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.term-editor:visible');
  assert.match(await page.locator('.term-editor:visible').innerText(), /GNU nano[\s\S]*\[Resolve\]/);
  await page.keyboard.press('Control+w');
  await page.keyboard.type('#LLMNR=no');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('yes');
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.term-editor:visible').innerText(), /\[ Wrote \d+ lines \]/);
  await page.keyboard.press('Control+x');
  await page.waitForSelector('.term-input:visible');
  assert.match(await run(page, 'grep ^LLMNR /etc/systemd/resolved.conf'), /^LLMNR=yes$/m);
  assert.match(await run(page, 'resolvectl status'), /-LLMNR/, 'not until the restart');
  await run(page, 'sudo systemctl restart systemd-resolved');
  const status = await run(page, 'resolvectl status');
  assert.match(status, /Global\n +Protocols: \+LLMNR -mDNS/);
  assert.match(status, /Current Scopes: DNS LLMNR\/IPv4/);
  assert.match(await run(page, 'resolvectl query win-a'), /win-a: 192\.168\.10\.11 +-- link: eth0[\s\S]*acquired via protocol LLMNR\/IPv4/);
  assert.match(await run(page, 'getent hosts win-a; echo "status $?"'), /^status 2$/m, 'files dns: glibc does not ask resolved');
  if (shots) await page.screenshot({ path: `${shots}/resolvectl-llmnr.png` });
  await win.locator('.win-close').click();

  // 2. LNX-B: samba asks the WINS server past the router; getent too, with wins in «hosts:».
  await page.dblclick('g.device:has-text("LNX-B")');
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'sudo apt install -y samba winbind libnss-winbind'), /Setting up libnss-winbind/);
  await run(page, "sudo sed -i 's/^   workgroup = WORKGROUP$/&\\n   wins server = 192.168.10.2/' /etc/samba/smb.conf");
  await run(page, 'sudo systemctl restart nmbd');
  assert.match(await run(page, 'nmblookup -U 192.168.10.2 -R win-a'), /querying win-a on 192\.168\.10\.2\n192\.168\.10\.11 win-a<00>/);
  await run(page, "sudo sed -i 's/^hosts:.*/& wins/' /etc/nsswitch.conf");
  assert.match(await run(page, 'getent hosts win-a'), /^192\.168\.10\.11 +win-a$/m);
  await win.locator('.win-close').click();

  // 3. WIN-B in Simulación: the WINS server of the TCP/IP tab registers its names; ipconfig /all shows it.
  await page.click('button.seg:has-text("Simulación")');
  await page.dblclick('g.device:has-text("WIN-B")');
  await win.locator('.win-tab:has-text("TCP/IP")').click();
  const wins = win.getByLabel('Servidor WINS (vacío: el de DHCP)');
  await wins.fill('192.168.10.2');
  await wins.press('Tab');
  await page.waitForTimeout(300);
  await win.locator('.win-tab:has-text("Terminal Windows")').click();
  assert.match(await run(page, 'ipconfig /all'), /Primary WINS Server[ .]+: 192\.168\.10\.2/);
  await win.locator('.win-close').click();
  const events = await page.locator('.events tbody').innerText();
  assert.match(events, /NBNS Registration WIN-B<00>/);
  assert.match(events, /NBNS Registration Response WIN-B<00>/);
  await page.locator('.events tbody tr', { hasText: 'NBNS Registration Response WIN-B<00>' }).first().click();
  const pdu = await page.locator('.pdu').innerText();
  assert.match(pdu, /UDP 137 → 137 · NetBIOS Name Service/);
  assert.match(pdu, /Opcode\s+Registro \(5\)/);
  assert.match(pdu, /TTL\s+300000 s/);
  assert.match(pdu, /Rcode\s+Sin error \(0\)/);
  if (shots) await page.screenshot({ path: `${shots}/sim-wins.png` });
  assert.deepEqual(errors, []);
  console.log('e2e names OK: resolved.conf with nano and restart, resolvectl, getent, nmblookup -U -R, the WINS of WIN-B and its NBNS rows');
} finally {
  await browser.close();
  server.kill();
}
