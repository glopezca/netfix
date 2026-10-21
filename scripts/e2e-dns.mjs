// End-to-end check of phase 20: DNS blocks by mode with the zone wizard, and the read-only «Activar router» box.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8097;
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

  // 1. Services → DNS: one block per mode, in order; zones with the automatic reverse one; the wizard in steps.
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.dblclick('g.device-server');
  await page.click('.win-tab:has-text("Servicios")');
  await page.click('.subnav-item:has-text("DNS")');
  const modes = await page.locator('.dns-mode').evaluateAll((els) => els.map((e) => e.getAttribute('data-mode')));
  assert.deepEqual(modes, ['cache', 'forwarder', 'authoritative', 'recursive', 'iterative'], 'iterative after recursive: it depends on it');
  assert.equal(await page.locator('.dns-mode[data-mode="iterative"] input[role="switch"]').isDisabled(), true, 'iterative follows recursion');
  const zones = page.locator('.dns-mode[data-mode="authoritative"] .grid-table');
  assert.match(await zones.innerText(), /aula\.lab[\s\S]*10\.168\.192\.in-addr\.arpa\s+Inversa[\s\S]*Automática/);
  await zones.locator('tr:has-text("aula.lab") >> nth=0').click();
  assert.match(await page.locator('.dns-zone-editor').innerText(), /Paso 4 · Registros[\s\S]*www[\s\S]*CNAME/);
  // The delete button of each zone and record row is centred on its row (it used to sit a few pixels lower).
  const offsets = await page.locator('.dns-mode[data-mode="authoritative"] tbody tr').evaluateAll((rows) => rows.map((tr) => {
    const b = tr.querySelector('button');
    if (!b) return 0;
    const r = tr.getBoundingClientRect(), x = b.getBoundingClientRect();
    return Math.abs((x.top + x.bottom) / 2 - (r.top + r.bottom) / 2);
  }));
  assert.ok(offsets.length >= 5 && offsets.every((d) => d <= 1), `button offsets ${offsets}`);
  await page.click('button:has-text("Nueva zona…")');
  assert.match(await page.locator('.dns-steps li.is-current').innerText(), /Paso 1 · Registro SOA/);
  await page.getByLabel('Nombre de la zona').fill('otra.lab');
  await page.click('.dns-wizard button:has-text("Siguiente")');
  assert.match(await page.locator('.dns-steps li.is-current').innerText(), /Paso 2/);
  assert.equal(await page.locator('.dns-wizard input').first().inputValue(), 'ns.otra.lab', 'the primary server is the first NS');
  await page.click('.dns-wizard button:has-text("Siguiente")');
  await page.click('.dns-wizard button:has-text("Crear zona")');
  assert.match(await page.locator('.window .form-msg[data-kind="ok"]').innerText(), /Zona otra\.lab creada/);
  assert.match(await page.locator('.dns-zone-editor').innerText(), /Esta zona admite: A, CNAME, MX, NS, TXT/);
  await page.click('.win-close');

  // 2. Linux router → Services → Parameters: the box mirrors ip_forward and cannot be clicked.
  await page.selectOption('select.select >> nth=0', 'linux-dmz');
  await page.dblclick('g.device:has-text("FW")');
  await page.click('.win-tab:has-text("Servicios")');
  await page.click('.subnav-item:has-text("Parámetros")');
  const box = page.locator('.router-flag input');
  assert.equal(await box.isChecked(), true);
  assert.equal(await box.isDisabled(), true);
  assert.match(await page.locator('.router-flag').innerText(), /Activar router[\s\S]*net\.ipv4\.ip_forward/);
  const row = page.locator('tr:has-text("net.ipv4.ip_forward")').first();
  await row.locator('select').selectOption('0');
  await row.locator('button').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.router-flag input').isChecked(), false, 'the box follows the parameter');
  assert.deepEqual(errors, []);
  console.log('e2e DNS y router: OK');
} finally {
  await browser.close();
  server.kill();
}
