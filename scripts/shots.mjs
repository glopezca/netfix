// Captures the help screenshots (local panel and WebGUI of each service) as WebP into assets/docs/<id>.<es|en>.webp.
// Usage: node scripts/shots.mjs   (then npm run build embeds them through scripts/gen-shots.mjs)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/docs');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? `${process.env.HOME}/.npm-global/lib/node_modules`, 'playwright')); }

const MAX_WIDTH = 900;
const LOCALES = { es: { locale: 'es-ES', services: 'Servicios', browser: 'Navegador', admin: 'Gestión web del servidor', apply: 'Aplicar' },
  en: { locale: 'en-GB', services: 'Services', browser: 'Browser', admin: 'Server web management', apply: 'Apply' } };
/** Local panel: the Servicios sub-tab, scrolled to `focus`. WebGUI: the page of the server's web management, opened from PC0. */
const SHOTS = [
  { id: 'dns-panel', subnav: 'DNS', focus: '.dns-mode' }, { id: 'dns-webgui', web: 'dns', focus: '.web-adm-modes' },
  { id: 'dhcp-panel', subnav: 'DHCP' }, { id: 'dhcp-webgui', web: 'dhcp' },
  { id: 'firewall-panel', subnav: 'Firewall' }, { id: 'firewall-webgui', web: 'firewall' },
];

/** PNG → WebP in the page's own canvas (no image dependency), at most MAX_WIDTH wide. */
async function webp(page, png) {
  const url = await page.evaluate(async ([b64, max]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const k = Math.min(1, max / img.width);
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.8);
  }, [png.toString('base64'), MAX_WIDTH]);
  if (!url.startsWith('data:image/webp')) throw new Error('this Chromium cannot encode WebP');
  return Buffer.from(url.split(',')[1], 'base64');
}

const port = 8099;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
mkdirSync(out, { recursive: true });
try {
  for (const [lang, L] of Object.entries(LOCALES)) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, locale: L.locale });
    await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
    await page.goto(`http://localhost:${port}/`);
    await page.evaluate((loc) => { localStorage.clear(); localStorage.setItem('netfix:locale', loc); }, L.locale);
    await page.reload();
    await page.waitForSelector('g.device');
    await page.locator('select.select').first().selectOption('servidores');
    await page.waitForTimeout(300);
    const win = page.locator('.window:visible');
    const save = async (id, shot) => { writeFileSync(join(out, `${id}.${lang}.webp`), await webp(page, shot)); console.log(`${id}.${lang}.webp`); };

    const panel = async (s) => {
      await win.locator(`.subnav-item:has-text("${s.subnav}")`).first().click();
      await page.waitForTimeout(200);
      if (s.focus) await win.locator(s.focus).first().evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await save(s.id, await win.screenshot());
    };

    // The server's firewall on (its Configuración tab), its local panels, and the web management on for the WebGUI shots.
    await page.dblclick('g.device-server');
    await win.locator('.win-tab').last().click();
    for (const name of ['dev-pkg-nftables', 'dev-firewall']) await win.locator(`input[name="${name}"]`).check();
    await win.locator(`.win-tab:has-text("${L.services}")`).click();
    for (const s of SHOTS.filter((x) => x.subnav)) await panel(s);
    await win.locator('.subnav-item:has-text("HTTP")').click();
    const admin = win.locator('.subsection', { has: page.locator('h3', { hasText: L.admin }) });
    await admin.locator('input[type="checkbox"]').check();
    await admin.locator(`button:has-text("${L.apply}")`).click();
    await win.locator('.win-close').click();

    await page.dblclick('g.device:has-text("PC0")');
    await page.locator(`.window:visible .win-tab:has-text("${L.browser}")`).click();
    const go = async (url) => { await page.fill('.window:visible .url-bar', url); await page.press('.window:visible .url-bar', 'Enter'); await page.waitForTimeout(250); };
    await go('http://192.168.10.2:10000/');
    await page.fill('.window:visible .browser-auth input >> nth=0', 'admin');
    await page.fill('.window:visible .browser-auth input >> nth=1', 'netfix');
    await page.click('.window:visible .browser-auth button');
    await page.waitForSelector('.browser-view .web-adm-nav-files');
    for (const s of SHOTS.filter((x) => x.web)) {
      await go(`http://192.168.10.2:10000/?page=${s.web}`);
      if (s.focus) await page.locator(`.browser-view ${s.focus}`).evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await save(s.id, await page.locator('.window:visible').screenshot());
    }

    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
