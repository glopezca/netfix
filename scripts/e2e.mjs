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
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  // Favicon: the N isotype, declared in the HTML and served next to it.
  assert.equal((await page.request.get(`http://localhost:${port}/favicon.png`)).status(), 200);
  assert.match(await page.getAttribute('link[rel="icon"]', 'href') ?? '', /^data:image\/png|favicon\.png$/);

  // 1. CLI: configure a manual binding for PC0 through the console.
  await page.dblclick('g.device-router');
  assert.equal(await page.locator('.win-tab').first().innerText(), 'Equipo', 'Equipo is the first tab of an IOS router');
  // Interfaces tab: describe and shut down Gi0/2 from the form; the CLI shows it.
  await page.click('.win-tab:has-text("Interfaces")');
  const gi2 = page.locator('.nic-row:has-text("GigabitEthernet0/2")');
  await gi2.locator('input').first().fill('Enlace de pruebas');
  await gi2.locator('button:has-text("Aplicar")').click();
  await page.waitForSelector('.form-msg[data-kind="ok"]');
  assert.match(await page.locator('.window .form-msg[data-kind="ok"]').innerText(), /GigabitEthernet0\/2/);
  await page.click('.win-tab:has-text("CLI")');
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
  await page.click('.win-tab:has-text("Terminal Windows")');
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

  // 4. Server lab: services panel, web browser, mail and SSH from a PC.
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.dblclick('g.device-server');
  await page.click('.win-tab:has-text("Servicios")');
  assert.equal(await page.locator('.subnav-item:has-text("Parámetros"), .subnav-item:has-text("Firewall")').count(), 0, 'a Server has no kernel panels');
  await page.click('.subnav-item:has-text("DNS")');
  assert.match(await page.locator(".subnav-content").innerText(), /Autoritativo[\s\S]*aula\.lab/);
  await page.click('.win-close');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Navegador")');
  await page.click('.browser-bar button:has-text("Ir")');
  assert.match(await page.locator('.browser-view').innerText(), /Servidor web de Netfix/);
  await page.click('.win-tab:has-text("Correo")');
  await page.getByLabel('Para').fill('ana@aula.lab');
  await page.getByLabel('Asunto').fill('Prueba e2e');
  await page.click('button:has-text("Enviar")');
  await page.click('button:has-text("Recibir")');
  assert.match(await page.locator('.grid-table').last().innerText(), /Prueba e2e/);
  await page.click('.win-tab:has-text("Terminal Linux")');
  await type('ssh admin@srv.aula.lab');
  assert.match(await page.locator('.terminal:visible').innerText(), /ED25519 key fingerprint is SHA256:/);
  await type('yes');
  await type('netfix');
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
  assert.match(await page.locator('.doc-page').innerText(), /DNS: nombres y comodines[\s\S]*srv\.aula\.lab\.aula\.lab\./);
  await page.fill('.doc-search', '');
  // v0.20: groups fold; the bash group opens first.
  await page.click('.doc-group-box[data-group="bash"] > summary');
  await page.click('.doc-link:has-text("bash: expansiones")');
  assert.match(await page.locator('.doc-page').innerText(), /\$\{v%%pat\}|\$\{v%pat\}/);
  if (shots) await page.screenshot({ path: `${shots}/docs.png` });
  await page.click('button.seg:has-text("Red")');
  await page.waitForSelector('.workspace:visible');

  // 7. v0.4: Internet lab — browse a site published through two ISP clouds, router web GUI tab, About.
  const labs = page.locator('select.select').first();
  const titles = await labs.locator('option').allTextContents();
  await labs.selectOption({ label: titles.find((o) => o.startsWith('Internet')) });
  await page.waitForSelector('g.device-cloud');
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Navegador")');
  await page.fill('.url-bar', 'http://www.sede2.es');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.match(await page.locator('.browser-status').innerText(), /200 OK · 81\.33\.3\.2/);
  if (shots) await page.screenshot({ path: `${shots}/internet.png` });
  await page.click('.win-close');
  await page.dblclick('g.device-router');
  await page.click('.win-tab:has-text("Gestión web")');
  assert.match(await page.locator('.window').innerText(), /ip http server/);
  await page.click('.win-close');
  await page.click('button.seg:has-text("Acerca de")');
  const { version } = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(root, 'package.json'), 'utf8')));
  assert.ok((await page.locator('#app').innerText()).includes(version), `About shows ${version}`);
  await page.click('button.seg:has-text("Red")');

  // 9. Donations: suggested amounts build the PayPal.Me link; other amounts are validated.
  await page.click('button.seg:has-text("Donaciones")');
  assert.equal(await page.locator('.donate-go').getAttribute('href'), 'https://paypal.me/infogerman/10EUR');
  await page.click('.donate-amount[data-amount="20"]');
  assert.equal(await page.locator('.donate-go').getAttribute('href'), 'https://paypal.me/infogerman/20EUR');
  await page.click('.donate-amount[data-amount="other"]');
  await page.fill('.donate-other-input', '7,5');
  assert.equal(await page.locator('.donate-go').getAttribute('href'), 'https://paypal.me/infogerman/7.50EUR');
  await page.fill('.donate-other-input', '0');
  assert.equal(await page.locator('.donate-go').getAttribute('href'), null);
  await page.click('button.seg:has-text("Red")');

  // 10. Language: English (UK) rebuilds the interface, keeps the topology and is remembered.
  const devicesBefore = await page.locator('g.device').count();
  await page.selectOption('.select-lang', 'en-GB');
  await page.waitForSelector('button.seg:has-text("Network")');
  assert.equal(await page.getAttribute('html', 'lang'), 'en-GB');
  assert.equal(await page.locator('g.device').count(), devicesBefore);
  await page.reload();
  await page.waitForSelector('button.seg:has-text("Documentation")');
  await page.selectOption('.select-lang', 'es-ES');
  await page.waitForSelector('button.seg:has-text("Red")');
  assert.deepEqual(errors, []);
  await page.close();

  // 11. Phone (touch, 390×844): no horizontal overflow, menu, zoom, tap-to-place, double-tap to open, key bar.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-ES' });
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(`http://localhost:${port}/`);
  await phone.evaluate(() => localStorage.clear());
  await phone.reload();
  await phone.waitForSelector('g.device-router');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll');
  await phone.tap('.menu-toggle');
  assert.ok(await phone.locator('.topbar-menu').isVisible());
  await phone.tap('.menu-toggle');
  await phone.tap('.zoom-btn[aria-label="Ajustar a la red"]');
  const zoom = Number(await phone.getAttribute('.workspace', 'data-zoom'));
  assert.ok(zoom > 0 && zoom < 100, `fit zooms out on a phone (${zoom})`);
  const before = await phone.locator('g.device').count();
  await phone.tap('.pal-item:has-text("PC")');
  const box = await phone.locator('.workspace').boundingBox();
  await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await phone.locator('g.device').count(), before + 1);
  const pcBox = await phone.locator('g.device-pc').last().boundingBox();
  const cx = pcBox.x + pcBox.width / 2;
  const cy = pcBox.y + pcBox.height / 2;
  await phone.touchscreen.tap(cx, cy);
  assert.equal(await phone.locator('.window').count(), 0, 'one tap only selects');
  await phone.touchscreen.tap(cx, cy);
  await phone.waitForSelector('.window');
  const win = await phone.locator('.window').boundingBox();
  assert.ok(win.width >= 389 && win.x <= 1, 'windows are full-screen sheets on phones');
  await phone.tap('.win-tab:has-text("Terminal")');
  assert.ok(await phone.locator('.terminal:visible .term-keys').isVisible(), 'touch key bar');
  if (shots) await phone.screenshot({ path: `${shots}/phone.png` });
  await ctx.close();

  assert.deepEqual(errors, []);
  console.log('e2e: ok');
} finally {
  await browser.close();
  server.kill();
}
