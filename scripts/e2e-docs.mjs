// End-to-end check of the Help tab (Ayuda) (v0.20): groups per device in palette order with their icons, sections
// in the order of each device's window, the page's group open, and the visual blocks of a guided page (diagrams,
// steps, terminals with prompts and vim colours, boxes and an exercise with its folded solution).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8105;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'es-ES' });
  // A lab over unsaved changes asks first (scripts/e2e-unsaved.mjs checks it); these flows always go ahead.
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('g.device');
  await page.click('button:has-text("Ayuda")');
  await page.waitForSelector('.doc-group-box');
  const groups = await page.locator('.doc-group-title').allInnerTexts();
  assert.deepEqual(groups.slice(0, 7), ['Netfix', 'PC', 'Servidor', 'Switch IOS', 'Router IOS', 'Router GNU/Linux', 'Nube ISP']);
  assert.equal(await page.locator('.doc-group-box[data-group="servidor"] svg.doc-group-icon').count(), 1, 'the palette icon of the group');
  // Open Servidor → DHCP: its group unfolds and the crumb shows group › section.
  await page.locator('.doc-group-box[data-group="servidor"] > summary').click();
  const sections = await page.locator('.doc-group-box[data-group="servidor"] .doc-section').allInnerTexts();
  assert.deepEqual(sections.map((s) => s.toLowerCase()), ['general', 'ssh', 'dhcp', 'dns', 'http', 'correo', 'configuración y registros']);
  await page.locator('button[data-page="srv-dhcp"]').click();
  assert.equal(await page.locator('.doc-crumb').innerText(), 'Servidor › DHCP');
  const article = page.locator('article.doc-page');
  assert.equal(await article.locator('figure.doc-figure').count(), 2, 'a topology and the DORA sequence');
  assert.equal(await article.locator('figure.doc-figure').first().locator('svg svg').count(), 4, 'the four devices drawn with the palette icons');
  assert.equal(await article.locator('.doc-steps > li').count(), 5);
  assert.equal(await article.locator('.doc-term-prompt').first().innerText(), 'alumno@pc0:~$ ');
  assert.ok(await article.locator('pre[data-filetype="messages"] .syn-type').count() > 0, 'the log in vim colours');
  assert.ok(await article.locator('strong').count() > 3, 'inline Markdown: bold');
  const solution = article.locator('.doc-callout-exercise details');
  assert.equal(await solution.getAttribute('open'), null, 'the solution starts folded');
  if (shots) {
    await page.screenshot({ path: join(shots, 'docs-dhcp.png') });
    await article.evaluate((a) => { a.scrollTop = a.scrollHeight; });
    await page.screenshot({ path: join(shots, 'docs-dhcp-end.png') });
  }
  assert.deepEqual(errors, []);
  console.log('e2e docs OK: devices in palette order with icons, sections, crumb, diagrams, steps, terminals and exercises');
} finally {
  await browser.close();
  server.kill();
}
