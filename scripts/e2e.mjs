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

  // 4. Server-PT lab: services panel, web browser, mail and SSH from a PC.
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.dblclick('g.device-server');
  await page.click('.subnav-item:has-text("DNS")');
  assert.match(await page.locator('.subnav-content').innerText(), /www\.aula\.lab/);
  await page.click('.win-close');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Navegador")');
  await page.click('.browser-bar button');
  assert.match(await page.locator('.browser-view').innerText(), /Servidor web de netsim/);
  await page.click('.win-tab:has-text("Correo")');
  await page.getByLabel('Para').fill('ana@aula.lab');
  await page.getByLabel('Asunto').fill('Prueba e2e');
  await page.click('button:has-text("Enviar")');
  await page.click('button:has-text("Recibir")');
  assert.match(await page.locator('.grid-table').last().innerText(), /Prueba e2e/);
  await page.click('.win-tab:has-text("Terminal Linux")');
  await type('ssh admin@srv.aula.lab');
  await type('cisco');
  await type('systemctl is-active apache2');
  assert.match(await page.locator('.terminal:visible').innerText(), /admin@srv:~\$ systemctl is-active apache2\nactive/);
  if (shots) await page.screenshot({ path: `${shots}/ssh.png` });

  // 5. bash 5.3 + editors: nano through SSH, vim locally, colours and completion.
  await type('nano prueba.txt');
  await page.waitForSelector('.term-editor:visible');
  assert.match(await page.locator('.term-editor:visible').innerText(), /GNU nano 8\.4[\s\S]*\^X Exit/);
  await page.keyboard.type('hola desde nano');
  await page.keyboard.press('Control+o');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.term-editor:visible').innerText(), /\[ Wrote 1 line \]/);
  if (shots) await page.screenshot({ path: `${shots}/nano.png` });
  await page.keyboard.press('Control+x');
  await page.waitForSelector('.term-input:visible');
  await type('cat prueba.txt; exit');
  assert.match(await page.locator('.terminal:visible').innerText(), /hola desde nano\nlogout\nConnection to srv\.aula\.lab closed\./);
  await type('vim notas.txt');
  await page.waitForSelector('.term-editor:visible');
  await page.keyboard.type('iecho $BASH_VERSION');
  await page.keyboard.press('Escape');
  if (shots) await page.screenshot({ path: `${shots}/vim.png` });
  await page.keyboard.type(':wq');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.term-input:visible');
  await type('bash notas.txt && ls --color=auto /usr');
  const term = page.locator('.terminal:visible');
  assert.match(await term.innerText(), /5\.3\.20\(1\)-release\nbin\s+lib\s+local/);
  assert.equal(await term.locator('.term-row .ansi-fg4.ansi-bold', { hasText: 'local' }).count(), 1, 'directories are coloured');
  await page.keyboard.type('ech');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.term-input:visible').inputValue(), 'echo ');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  if (shots) await page.screenshot({ path: `${shots}/bash.png` });

  // 6. Documentación tab: table of contents, search and back to the network.
  await page.click('button.seg:has-text("Documentación")');
  await page.waitForSelector('.docs:visible');
  assert.match(await page.locator('.doc-page').innerText(), /Primeros pasos/);
  await page.fill('.doc-search', 'nombres relativos');
  await page.click('.doc-link >> nth=0');
  assert.match(await page.locator('.doc-page').innerText(), /DNS de Server-PT[\s\S]*srv\.aula\.lab\.aula\.lab\./);
  await page.fill('.doc-search', '');
  await page.click('.doc-link:has-text("bash: expansiones")');
  assert.match(await page.locator('.doc-page').innerText(), /\$\{v%%pat\}|\$\{v%pat\}/);
  if (shots) await page.screenshot({ path: `${shots}/docs.png` });
  await page.click('button.seg:has-text("Red")');
  await page.waitForSelector('.workspace:visible');

  assert.deepEqual(errors, []);
  console.log('e2e: ok');
} finally {
  await browser.close();
  server.kill();
}
