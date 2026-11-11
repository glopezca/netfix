// Captures the help screenshots (local panel and WebGUI of each service) as WebP into assets/docs/<id>.<es|en>.webp.
// Usage: node scripts/shots.mjs   (then npm run build embeds them through scripts/gen-shots.mjs)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/docs');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? `${process.env.HOME}/.npm-global/lib/node_modules`, 'playwright')); }

const MAX_WIDTH = 900;
const LOCALES = { es: { locale: 'es-ES', services: 'Servicios', browser: 'Navegador', admin: 'Gestión web del servidor', apply: 'Aplicar', on: 'Activado', save: 'Guardar cambios' },
  en: { locale: 'en-GB', services: 'Services', browser: 'Browser', admin: 'Server web management', apply: 'Apply', on: 'Enabled', save: 'Save settings' } };
/** Local panel: a Servicios sub-tab (`subnav`) or a main tab (`tab`), scrolled to `focus`. WebGUI: the page (`web`) of the web management, opened from a PC. */
const SHOTS = [
  { id: 'dns-panel', subnav: 'DNS', focus: '.dns-mode' }, { id: 'dns-webgui', web: 'dns', focus: '.web-adm-modes' },
  { id: 'dhcp-panel', subnav: 'DHCP' }, { id: 'dhcp-webgui', web: 'dhcp' },
  { id: 'firewall-panel', subnav: 'Firewall' }, { id: 'firewall-webgui', web: 'firewall', enableFirewall: true },
  { id: 'ssh-panel', subnav: 'SSH' }, { id: 'ssh-webgui', web: 'ssh' },
  { id: 'web-panel', subnav: 'HTTP' }, { id: 'web-webgui', web: 'web' },
  { id: 'samba-panel', subnav: 'Samba' }, { id: 'samba-webgui', web: 'samba' },
  { id: 'mail-panel', subnav: { es: 'Correo', en: 'Email' } }, { id: 'mail-webgui', web: 'mail' },
  { id: 'netplan-panel', tab: 'TCP/IP' }, { id: 'netplan-webgui', web: 'setup' },
  { id: 'vpn-panel', lab: 'vpn-wireguard', subnav: 'VPN' }, { id: 'vpn-webgui', lab: 'vpn-wireguard', web: 'vpn' },
];
/** The two scenarios: the device (`dev`) is configured, then a PC (`pc`) opens its web management at `ip`. */
const LABS = {
  servidores: { dev: 'g.device-server', pc: 'g.device:has-text("PC0")', ip: '192.168.10.2', pkgs: ['nftables', 'samba'] },
  'vpn-wireguard': { dev: 'g.device:has-text("CENTRAL")', pc: 'g.device-pc >> nth=0', ip: '10.1.0.1', pkgs: [], adminLabel: 'CENTRAL',
    // The lab's firewall only lets SSH in: the web management (10000) is added to /etc/nftables.conf before the lab is saved...
    pre: ["sed -i 's/tcp dport 22 accept/tcp dport { 22, 10000 } accept/' /etc/nftables.conf"],
    // ...and the units are restarted once it is opened again (a reopened lab has no live firewall nor tunnel).
    post: ['systemctl restart nftables', 'dhclient eth0', 'systemctl restart wg-quick@wg0'] },
};

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

/** The GNU/Linux router has no «HTTP» panel: its web management is switched on by saving the lab, editing the JSON and opening it again. */
async function enableAdmin(page, label) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button:has-text("Guardar"), button:has-text("Save")').first().click()]);
  const file = join(tmpdir(), 'netfix-shots-lab.json');
  await dl.saveAs(file);
  const lab = JSON.parse(readFileSync(file, 'utf8'));
  const dev = lab.devices.find((d) => d.label === label);
  dev.server.services.webapps.admin.enabled = true;
  writeFileSync(file, JSON.stringify(lab));
  await page.locator('input[type=file]').setInputFiles(file);
  await page.waitForSelector('g.device');
  await page.waitForTimeout(500);
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
    await page.addInitScript(() => { delete window.showSaveFilePicker; });
    await page.goto(`http://localhost:${port}/`);
    await page.evaluate((loc) => { localStorage.clear(); localStorage.setItem('netfix:locale', loc); }, L.locale);
    await page.reload();
    await page.waitForSelector('g.device');
    const win = page.locator('.window:visible');
    const save = async (id, shot) => { writeFileSync(join(out, `${id}.${lang}.webp`), await webp(page, shot)); console.log(`${id}.${lang}.webp`); };
    const text = (v) => (typeof v === 'string' ? v : v[lang]);

    const panel = async (s) => {
      if (s.tab) await win.locator(`.win-tab:has-text("${s.tab}")`).first().click();
      else await win.locator(`.subnav-item:has-text("${text(s.subnav)}")`).first().click();
      await page.waitForTimeout(200);
      if (s.focus) await win.locator(s.focus).first().evaluate((n) => n.scrollIntoView({ block: 'start' }));
      else await win.locator('*').evaluateAll((ns) => ns.forEach((n) => { n.scrollTop = 0; }));
      await save(s.id, await win.screenshot());
    };

    for (const [labId, lab] of Object.entries(LABS)) {
      const mine = (x) => (x.lab ?? 'servidores') === labId;
      await page.locator('select.select').first().selectOption(labId);
      await page.waitForTimeout(300);
      const runTerm = async (cmds) => {
        await page.dblclick(lab.dev);
        await win.locator('.win-tab:has-text("GNU/Linux")').click();
        for (const cmd of ['sudo -i', 'netfix', ...cmds]) {
          await page.locator('.terminal:visible input.term-input').fill(cmd);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
        }
        await win.locator('.win-close').click();
      };
      if (lab.adminLabel) {
        await runTerm(lab.pre);
        await enableAdmin(page, lab.adminLabel);
        await runTerm(lab.post);
      }
      // The device's packages on (its Configuración tab), its local panels, and the web management on for the WebGUI shots.
      await page.dblclick(lab.dev);
      if (lab.pkgs.length) {
        await win.locator('.win-tab').last().click();
        for (const name of lab.pkgs) await win.locator(`input[name="dev-pkg-${name}"]`).check();
        // The firewall switch is on while the package is: its rules are saved, nothing is left «sin guardar».
        if (lab.pkgs.includes('nftables')) await win.locator('input[name="dev-firewall"]').check();
      }
      await win.locator(`.win-tab:has-text("${L.services}")`).click();
      for (const s of SHOTS.filter((x) => mine(x) && (x.subnav || x.tab))) await panel(s);
      if (labId === 'servidores') {
        await win.locator(`.win-tab:has-text("${L.services}")`).click();
        await win.locator('.subnav-item:has-text("HTTP")').click();
        const admin = win.locator('.subsection', { has: page.locator('h3', { hasText: L.admin }) });
        await admin.locator('input[type="checkbox"]').check();
        await admin.locator(`button:has-text("${L.apply}")`).click();
      }
      await win.locator('.win-close').click();

      await page.dblclick(lab.pc);
      await page.locator(`.window:visible .win-tab:has-text("${L.browser}")`).click();
      const go = async (url) => { await page.fill('.window:visible .url-bar', url); await page.press('.window:visible .url-bar', 'Enter'); await page.waitForTimeout(250); };
      await go(`http://${lab.ip}:10000/`);
      await page.fill('.window:visible .browser-auth input >> nth=0', 'admin');
      await page.fill('.window:visible .browser-auth input >> nth=1', 'netfix');
      await page.click('.window:visible .browser-auth button');
      await page.waitForSelector('.browser-view .web-adm-nav-files');
      for (const s of SHOTS.filter((x) => mine(x) && x.web)) {
        await go(`http://${lab.ip}:10000/?page=${s.web}`);
        if (s.enableFirewall) {
          // Switch the unit on and save: the live rules and /etc/nftables.conf match, so no «sin guardar» banner is left.
          await page.locator('.browser-view .web-adm-check', { hasText: L.on }).first().click();
          await page.locator('.browser-view form:has(input[name=enabled]) button', { hasText: L.save }).first().click();
          await go(`http://${lab.ip}:10000/?page=${s.web}`);
        }
        if (s.focus) await page.locator(`.browser-view ${s.focus}`).evaluate((n) => n.scrollIntoView({ block: 'start' }));
        await save(s.id, await page.locator('.window:visible').screenshot());
      }
      await win.locator('.win-close').click();
    }

    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
