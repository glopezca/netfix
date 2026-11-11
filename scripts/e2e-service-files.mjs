// End-to-end check (v0.40) of the service files edited by hand (Fase 59) in the lab «Servidores»: kea-dhcp4.conf with a
// bad value (kea-dhcp4 -t, the unit failed, a red × in systemctl status, systemctl --failed), then a good edit that the
// DHCP panel shows after the restart; named.conf.local broken (a reload that fails and keeps named running, the error in
// journalctl -xeu), then a zone made in Servicios → DNS that writes the generated files again; main.cf and dovecot.conf
// broken (postfix check, postfix failed, doveconf -n, a dovecot reload that keeps it running) and the domain applied.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(process.env.PLAYWRIGHT_PATH ?? '/home/claude/.npm-global/lib/node_modules', 'playwright')); }

const port = 8116;
const shots = process.env.SHOTS;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await playwright.chromium.launch();
const KEA = '/etc/kea/kea-dhcp4.conf';

/** Runs a line in the visible terminal and returns what that line printed. */
const run = async (page, cmd) => {
  const screen = page.locator('.terminal:visible .term-screen');
  const before = (await screen.innerText()).length;
  await page.locator('.terminal:visible input.term-input').fill(cmd);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  return (await screen.innerText()).slice(before);
};

/** The coloured runs of the terminal's last rows, as "class:text". */
const lastSpans = (page, rows) => page.locator('.terminal:visible .term-screen .term-row').evaluateAll((els, n) =>
  els.slice(-n).flatMap((r) => [...r.querySelectorAll('span')].map((s) => `${s.className}:${s.textContent}`)), rows);

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-ES' });
  await page.addLocatorHandler(page.locator('dialog.confirm-dialog[open]'), (d) => d.locator('button.danger').click());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('g.device');
  await page.selectOption('select.select >> nth=0', 'servidores');
  await page.waitForTimeout(300);
  const win = page.locator('.window:visible');
  await page.dblclick('g.device-server');
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  await run(page, 'sudo -v');
  assert.doesNotMatch(await run(page, 'netfix'), /Sorry/);

  // 1. Kea: a string where an integer goes. The check says where; the restart leaves the unit failed, in red.
  await run(page, `sudo sed -i 's/"interfaces-config"/"valid-lifetime": "mucho",\\n    "interfaces-config"/' ${KEA}`);
  assert.match(await run(page, `kea-dhcp4 -t ${KEA}; echo "status $?"`), /Syntax check failed with: \/etc\/kea\/kea-dhcp4\.conf:3\.23-29: syntax error, unexpected constant string, expecting integer\nstatus 1/);
  assert.match(await run(page, 'sudo systemctl restart kea-dhcp4-server; echo "status $?"'), /^status 0$/m, 'Type=simple: restart does not wait for Kea');
  assert.match(await run(page, 'systemctl is-active kea-dhcp4-server'), /^failed$/m);
  assert.match(await run(page, 'systemctl status kea-dhcp4-server'), /× kea-dhcp4-server\.service - Kea DHCPv4 Service[\s\S]*Active: failed \(Result: exit-code\)/);
  const status = await lastSpans(page, 30);
  assert.ok(status.some((s) => /ansi-fg1/.test(s) && s.endsWith(':×')), `a red ×: ${status.join(' | ')}`);
  assert.ok(status.some((s) => /ansi-fg1/.test(s) && s.endsWith(':failed')), 'failed in red');
  assert.match(await run(page, 'journalctl -xeu kea-dhcp4-server'), /DHCP4_CONFIG_LOAD_FAIL configuration error using file: \/etc\/kea\/kea-dhcp4\.conf, reason: .*expecting integer/);
  assert.match(await run(page, 'systemctl --failed'), /● kea-dhcp4-server\.service loaded failed failed Kea DHCPv4 Service[\s\S]*1 loaded units listed\./);
  if (shots) await page.screenshot({ path: `${shots}/kea-failed.png` });
  assert.match(await run(page, 'systemctl status kea-dhcp4-server | head -1'), /^× kea-dhcp4-server/m);
  const piped = await lastSpans(page, 1);
  assert.deepEqual(piped, [], 'no colours through a pipe');

  // 2. A good edit: the restart applies it and the DHCP panel shows it.
  await run(page, `sudo sed -i 's/"mucho"/7200/; s/"domain-name-servers", "data": "[0-9.]*"/"domain-name-servers", "data": "192.168.10.53"/' ${KEA}`);
  assert.match(await run(page, `kea-dhcp4 -t ${KEA}; echo "status $?"`), /^status 0$/m);
  await run(page, 'sudo systemctl restart kea-dhcp4-server');
  assert.match(await run(page, 'systemctl is-active kea-dhcp4-server'), /^active$/m);
  const ok = await lastSpans(page, 1);
  assert.ok(!ok.some((s) => /ansi-fg1/.test(s)), 'no longer failed');
  await win.locator('.win-tab:has-text("Servicios")').click();
  await page.click('.subnav-item:has-text("DHCP")');
  assert.match(await win.innerText(), /192\.168\.10\.53/, 'the panel shows the applied file');

  // 3. BIND: named.conf.local without a ';'. The reload fails, named keeps running, the journal says why.
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  await run(page, "sudo sed -i 's/type master;/type master/' /etc/bind/named.conf.local");
  assert.match(await run(page, 'named-checkconf; echo "status $?"'), /\/etc\/bind\/named\.conf\.local:\d+: missing ';' before 'file'\nstatus 1/);
  assert.match(await run(page, 'sudo systemctl reload named; echo "status $?"'), /Job for named\.service failed because the control process exited with error code\.\nSee "systemctl status named\.service" and "journalctl -xeu named\.service" for details\.\nstatus 1/);
  assert.match(await run(page, 'systemctl is-active named'), /^active$/m, 'named keeps the configuration it had');
  assert.match(await run(page, 'journalctl -xeu named'), /reloading configuration failed: failure[\s\S]*rndc: 'reload' failed: failure[\s\S]*Reload failed for named\.service - BIND Domain Name Server\./);
  const journal = await lastSpans(page, 3);
  assert.ok(journal.some((s) => /ansi-fg1/.test(s) && s.includes('Reload failed for named.service')), `the err line in red: ${journal.join(' | ')}`);

  // 4. As in Webmin, a zone made in Servicios → DNS writes named.conf.local again from the panel: the broken edit goes.
  await win.locator('.win-tab:has-text("Servicios")').click();
  await page.click('.subnav-item:has-text("DNS")');
  await page.click('button:has-text("Nueva zona…")');
  await page.getByLabel('Nombre de la zona').fill('otra.lab');
  await page.click('.dns-wizard button:has-text("Siguiente")');
  await page.click('.dns-wizard button:has-text("Siguiente")');
  await page.click('.dns-wizard button:has-text("Crear zona")');
  assert.match(await page.locator('.window .form-msg[data-kind="ok"]').innerText(), /Zona otra\.lab creada/);
  await win.locator('.win-tab:has-text("Terminal GNU/Linux")').click();
  assert.match(await run(page, 'named-checkconf; echo "status $?"'), /^status 0$/m);
  assert.match(await run(page, 'grep -c "type master;" /etc/bind/named.conf.local'), /^[2-9]$/m);
  assert.match(await run(page, 'grep -c \'zone "otra.lab"\' /etc/bind/named.conf.local'), /^1$/m);
  // The wizard's zone has its NS inside it and no A record yet: BIND does not load it, as the DNS panel warns.
  assert.match(await run(page, 'named-checkzone otra.lab /etc/bind/db.otra.lab'), /zone otra\.lab\/IN: NS 'ns\.otra\.lab' has no address records \(A or AAAA\)\nzone otra\.lab\/IN: not loaded due to errors\./);
  if (shots) await page.screenshot({ path: `${shots}/bind-regenerated.png` });

  // 5. Mail: main.cf with a bad mydomain. postfix check says why, the restart leaves postfix failed; fixed, the Mail
  // panel shows the new domain. dovecot.conf: a reload with an unknown setting keeps dovecot running.
  const CF = '/etc/postfix/main.cf';
  await run(page, `sudo sed -i 's/^mydomain = .*/mydomain = aula_lab/' ${CF}`);
  assert.match(await run(page, 'sudo postfix check; echo "status $?"'), /postfix: fatal: file \/etc\/postfix\/main\.cf: parameter mydomain: bad parameter value: aula_lab\nstatus 1/);
  assert.match(await run(page, 'sudo systemctl restart postfix; echo "status $?"'), /Job for postfix\.service failed[\s\S]*status 1/);
  assert.match(await run(page, 'systemctl is-active postfix'), /^failed$/m);
  assert.match(await run(page, 'journalctl -u postfix -n 5'), /postfix\/postfix-script\[1021\]: fatal: file \/etc\/postfix\/main\.cf: parameter mydomain: bad parameter value: aula_lab/);
  await run(page, `sudo sed -i 's/^mydomain = .*/mydomain = empresa.es/' ${CF}`);
  assert.match(await run(page, 'postconf mydomain'), /^mydomain = empresa\.es$/m);
  await run(page, 'sudo systemctl restart postfix');
  assert.match(await run(page, 'systemctl is-active postfix'), /^active$/m);
  await run(page, "sudo sed -i 's/^mail_driver/mail_location = x\\nmail_driver/' /etc/dovecot/dovecot.conf");
  assert.match(await run(page, 'doveconf -n; echo "status $?"'), /doveconf: Fatal: Error in configuration file \/etc\/dovecot\/dovecot\.conf line \d+: Unknown setting: mail_location\nstatus 89/);
  assert.match(await run(page, 'sudo systemctl reload dovecot; echo "status $?"'), /Job for dovecot\.service failed[\s\S]*status 1/);
  assert.match(await run(page, 'systemctl is-active dovecot'), /^active$/m, 'a bad reload keeps dovecot running');
  if (shots) await page.screenshot({ path: `${shots}/mail-failed.png` });
  await win.locator('.win-tab:has-text("Servicios")').click();
  await page.click('.subnav-item:has-text("Correo")');
  assert.match(await win.innerText(), /ana@empresa\.es/, 'the Mail panel shows the applied main.cf');
  assert.deepEqual(errors, []);
  console.log('e2e service files OK: kea-dhcp4 -t, Kea failed in red, the applied edit in the panel, a BIND reload that fails, named.conf.local written again from the panel, main.cf and dovecot.conf checked, failed and applied');
} finally {
  await browser.close();
  server.kill();
}
