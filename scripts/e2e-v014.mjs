// End-to-end check of phase 22: listen interfaces, «Configuración» (v0.19.2: before Registros, highlighted as vim does), SSH first and fields that apply on change.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8096;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device-router');
  await page.selectOption('select.select >> nth=0', 'servidores');

  // PC: the name applies on Tab, the host name follows it, the focus goes on to the next field; no buttons.
  await page.dblclick('g.device-pc >> nth=0');
  await page.click('.win-tab:has-text("Equipo")');
  const win = page.locator('.window:visible');
  assert.equal(await win.locator('button:has-text("Guardar"), button:has-text("Usar el nombre visible")').count(), 0);
  await win.locator('input[name="label"]').fill('Aula Pública 2º');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('.window input[name="hostname"]')?.value === 'aula-publica-2o');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'pretty', 'focus moved on to the next field after the redraw');
  assert.equal(await page.locator('g.device-pc .device-label', { hasText: 'Aula Pública 2º' }).count(), 1);
  await page.click('.win-tab:has-text("Terminal Linux")');
  assert.match(await page.locator('.terminal:visible .term-prompt').innerText(), /@aula-publica-2o:/);
  await page.click('.win-close');
  // The diagram: name and IP/CIDR, the host name is not repeated.
  // The diagram: the name under the device, the host name not repeated; its address at its cable end (v0.18).
  const caption = await page.locator('g.device-pc', { hasText: 'Aula Pública 2º' }).locator('text').allTextContents();
  assert.ok(!caption.includes('aula-publica-2o'), caption.join(' | '));
  const ends = await page.locator('.port-end').allTextContents();
  assert.ok(ends.some((x) => /^Fa0\d+\.\d+\.\d+\.\d+\/\d+$/.test(x)), ends.join(' | '));

  // Server: SSH first, the listen block of DNS and DHCP, «Configuración» with named.conf.options as it is.
  await page.dblclick('g.device-server');
  await page.click('.win-tab:has-text("Servicios")');
  const items = await page.locator('.window:visible .subnav-item').allInnerTexts();
  assert.deepEqual(items, ['SSH', 'DHCP', 'DNS', 'HTTP', 'Correo', 'Configuración', 'Registros']);
  await page.click('.subnav-item:has-text("DNS")');
  const block = page.locator('.listen-block');
  assert.match(await block.innerText(), /Interfaces de escucha[\s\S]*Todas[\s\S]*eth0[\s\S]*lo/);
  await block.locator('label:has-text("Todas") input').uncheck();
  await block.locator('label:has-text("lo") input').check();
  await block.locator('button:has-text("Aplicar (systemctl restart bind9)")').click();
  await page.waitForSelector('.window:visible .form-msg[data-kind="ok"]');
  if (shots) await page.screenshot({ path: `${shots}/dns-listen.png` });
  await page.click('.subnav-item:has-text("Configuración")');
  await page.locator('.window:visible select').first().selectOption('dns');
  await page.waitForSelector('.conf-file h4:has-text("/etc/bind/named.conf.options")');
  assert.match(await page.locator('.conf-file', { has: page.locator('h4', { hasText: /named\.conf\.options$/ }) }).innerText(), /listen-on \{ 127\.0\.0\.1; \};/);
  const conf = page.locator('.conf-file', { has: page.locator('h4', { hasText: /named\.conf\.options$/ }) });
  assert.equal(await conf.locator('pre').getAttribute('data-filetype'), 'named');
  assert.deepEqual(await conf.locator('.syn-statement').evaluateAll((ns) => ns.slice(0, 2).map((n) => [n.textContent, getComputedStyle(n).color])),
    [['options', 'rgb(255, 255, 96)'], ['directory', 'rgb(255, 255, 96)']], 'statements in vim yellow');
  assert.ok(await conf.locator('.syn-comment').count() > 0, 'comments highlighted');
  if (shots) await page.screenshot({ path: `${shots}/files.png` });
  await page.click('.win-close');

  // Linux router: the NIC address applies on change (no «Aplicar»), its panels first and then SSH.
  await page.selectOption('select.select >> nth=0', 'linux-dmz');
  await page.dblclick('g.device:has-text("FW")');
  await page.click('.win-tab:has-text("Servicios")');
  const routerItems = await page.locator('.window:visible .subnav-item').allInnerTexts();
  assert.equal(routerItems[3], 'SSH', routerItems.join(' | '));
  await page.click('.win-tab:has-text("Interfaces")');
  const eth2 = page.locator('.window:visible .nic-row:has-text("GigabitEthernet0/2")');
  assert.equal(await eth2.locator('button:has-text("Aplicar")').count(), 0);
  await eth2.locator('input[aria-label^="Dirección IPv4"]').fill('10.9.9.1');
  await eth2.locator('input[aria-label^="Máscara"]').fill('255.255.255.0');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => [...document.querySelectorAll('.port-end text')].some((x) => x.textContent === '10.9.9.1/24'));
  await page.click('.win-close');

  // Cloud: a line applies on change.
  const labs = page.locator('select.select').first();
  const titles = await labs.locator('option').allTextContents();
  await labs.selectOption({ label: titles.find((o) => o.startsWith('Internet')) });
  await page.dblclick('g.device-cloud >> nth=0');
  await page.click('.win-tab:has-text("ISP")');
  assert.equal(await page.locator('.window:visible button:has-text("Guardar")').count(), 0);
  const isp = page.locator('.window:visible .field:has-text("Nombre del ISP") input');
  await isp.fill('Fibra Aula');
  await page.keyboard.press('Enter');
  // Applied without a button: the field keeps it after leaving the tab (v0.16: the diagram shows the block, not the ISP).
  await page.waitForTimeout(50);
  await page.click('.win-tab:has-text("Líneas")');
  await page.click('.win-tab:has-text("ISP")');
  assert.equal(await page.locator('.window:visible .field:has-text("Nombre del ISP") input').inputValue(), 'Fibra Aula');
  await page.click('.win-tab:has-text("Líneas")');
  const down = page.locator('.window:visible .field:has-text("Bajada") input').first();
  await down.fill('321');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(50);
  await page.click('.win-tab:has-text("ISP")');
  await page.click('.win-tab:has-text("Líneas")');
  assert.equal(await page.locator('.window:visible .field:has-text("Bajada") input').first().inputValue(), '321');
  assert.deepEqual(errors, []);
  console.log('e2e v0.14 OK');
} finally {
  await browser.close();
  server.kill();
}
