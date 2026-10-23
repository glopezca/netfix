// End-to-end check of the brand marks (v0.19.3): documentation bullets are the hollow diamond of the logo alone, and
// the footer credit of the WebGUI of servers and Linux routers is the primary N isotype.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8103;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'es-ES' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('g.device');
  await page.click('button:has-text("Documentación")');
  await page.waitForSelector('.doc-page ul > li');
  const bullet = await page.locator('.doc-page ul > li').first().evaluate((li) => {
    const s = getComputedStyle(li, '::before');
    return { image: s.backgroundImage.slice(0, 40), width: s.width, height: s.height };
  });
  assert.match(bullet.image, /^url\("data:image\/svg\+xml;base64,/, 'the diamond (SVG), not the X isotype (PNG)');
  assert.equal(bullet.width, bullet.height);
  if (shots) await page.locator('.doc-page ul').first().screenshot({ path: join(shots, 'bullets.png') });

  // The WebGUI footer as the browser view renders it (same markup as src/web/admin-layout.ts).
  const foot = await page.evaluate(() => {
    const view = document.createElement('div');
    view.className = 'browser-view';
    view.innerHTML = '<footer class="web-adm-foot web-brand-foot"><span class="web-brand-n">Netfix</span>Netfix · gestión web</footer>';
    document.body.append(view);
    const s = getComputedStyle(view.querySelector('.web-brand-n'));
    return { image: s.backgroundImage.slice(0, 30), width: s.width };
  });
  assert.match(foot.image, /^url\("data:image\/webp;base64,/, 'the N isotype (WebP), not the X (PNG)');
  assert.equal(foot.width, '20px');
  if (shots) await page.locator('.browser-view .web-brand-foot').screenshot({ path: join(shots, 'foot.png') });
  assert.deepEqual(errors, []);
  console.log('e2e brand OK: diamond bullets in the documentation, N isotype in the WebGUI footer');
} finally {
  await browser.close();
  server.kill();
}
