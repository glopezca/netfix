/**
 * systemctl and journalctl colours (systemd 257, Ubuntu): only when stdout and stderr are the terminal, unless
 * SYSTEMD_COLORS says otherwise; NO_COLOR and TERM=dumb turn them off. The sequences are systemd's own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { parseIp } from '../../src/core/ip.ts';

const RED = '\x1b[0;1;31m';
const GREEN = '\x1b[0;1;32m';
const YELLOW = '\x1b[0;1;38;5;185m';
const BOLD = '\x1b[0;1;39m';
const UNDERLINE = '\x1b[0;4m';
const OFF = '\x1b[0m';

function lab(): { t: Topology; root: ShellSession } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  t.clock.set(Date.UTC(2026, 10, 6, 10, 0, 0));
  return { t, root: createShell(srv, 'linux', 'root') };
}

function failApache(root: ShellSession): void {
  root.run('echo "DocumentRot /var/www/x" >> /etc/apache2/sites-available/000-default.conf');
  root.run('systemctl restart apache2');
}

function esc(s: string): string {
  return s.replace(/[[\]\\^$.*+?()|{}]/g, '\\$&');
}

test('an active unit: green ●, green enabled and preset, green bold "active (running)"', () => {
  const { root } = lab();
  const out = root.run('systemctl status apache2');
  assert.equal(out[0], `${GREEN}●${OFF} apache2.service - The Apache HTTP Server`);
  assert.equal(out[1], `     Loaded: loaded (/usr/lib/systemd/system/apache2.service; ${GREEN}enabled${OFF}; preset: ${GREEN}enabled${OFF})`);
  assert.equal(out[2], `     Active: ${GREEN}active (running)${OFF}`);
});

test('an inactive, disabled unit: ○ without colour, yellow disabled', () => {
  const { root } = lab();
  root.run('systemctl disable --now apache2');
  const out = root.run('systemctl status apache2');
  assert.equal(out[0], '○ apache2.service - The Apache HTTP Server');
  assert.equal(out[1], `     Loaded: loaded (/usr/lib/systemd/system/apache2.service; ${YELLOW}disabled${OFF}; preset: ${GREEN}enabled${OFF})`);
  assert.equal(out[2], '     Active: inactive (dead)');
});

test('a failed unit: red ×, red "failed", the failed exit in red, journal lines by priority', () => {
  const { t, root } = lab();
  failApache(root);
  t.net.runFor(5000);
  const out = root.run('systemctl status apache2; echo $?');
  assert.equal(out[0], `${RED}×${OFF} apache2.service - The Apache HTTP Server`);
  assert.equal(out[2], `     Active: ${RED}failed${OFF} (Result: exit-code) since Fri 2026-11-06 10:00:00 UTC; 5s ago`);
  assert.equal(out[3], `    Process: 1123 ExecStart=/usr/sbin/apachectl start ${RED}(code=exited, status=1/FAILURE)${OFF}`);
  const log = out.slice(5, -1);
  assert.match(log.at(-3) ?? '', new RegExp(` systemd\\[1\\]: ${esc(BOLD)}apache2\\.service: Control process exited, code=exited, status=1/FAILURE${esc(OFF)}$`));
  assert.match(log.at(-2) ?? '', new RegExp(` systemd\\[1\\]: ${esc(YELLOW)}apache2\\.service: Failed with result 'exit-code'\\.${esc(OFF)}$`));
  assert.match(log.at(-1) ?? '', new RegExp(` systemd\\[1\\]: ${esc(RED)}Failed to start apache2\\.service - The Apache HTTP Server\\.${esc(OFF)}$`));
  assert.doesNotMatch(log[0] ?? '', /\x1b/, 'info lines have no colour');
  assert.equal(out.at(-1), '3', 'the exit status does not change with colours');
});

test('a oneshot unit that failed: the main PID line is not coloured', () => {
  const { root } = lab();
  root.run("echo 'table inet broken { chain c { tcp dprt 1 accept } }' >> /etc/nftables.conf; systemctl start nftables");
  const out = root.run('systemctl status nftables');
  assert.equal(out[3], `    Process: 655 ExecStart=/usr/sbin/nft -f /etc/nftables.conf ${RED}(code=exited, status=1/FAILURE)${OFF}`);
  assert.equal(out[4], '   Main PID: 655 (code=exited, status=1/FAILURE)');
});

test('journalctl colours the message by priority, not the prefix', () => {
  const { root } = lab();
  failApache(root);
  const log = root.run('journalctl -u apache2 --no-pager');
  assert.match(log.at(-1) ?? '', new RegExp(`^Nov 06 10:00:00 server0 systemd\\[1\\]: ${esc(RED)}Failed to start`));
  assert.ok(log.some((l) => l.endsWith(': Starting apache2.service - The Apache HTTP Server...')), 'info: plain');
});

test('list-units underlines the header and paints the failed rows red; --failed too', () => {
  const { root } = lab();
  failApache(root);
  const units = root.run('systemctl list-units');
  assert.equal(units[0], `${UNDERLINE}  UNIT                       LOAD   ACTIVE   SUB     DESCRIPTION${OFF}`);
  const row = units.find((l) => l.includes('apache2.service')) ?? '';
  assert.equal(row, `${RED}●${OFF} ${RED}apache2.service           ${OFF} loaded ${RED}failed  ${OFF} ${RED}failed ${OFF} ${RED}The Apache HTTP Server${OFF}`);
  assert.doesNotMatch(units.find((l) => l.includes('ssh.service')) ?? '', /\x1b/, 'a healthy row has no colour');
  const failed = root.run('systemctl --failed');
  assert.equal(failed[0], `${UNDERLINE}  UNIT            LOAD   ACTIVE SUB    DESCRIPTION${OFF}`);
  assert.equal(failed[1], `${RED}●${OFF} ${RED}apache2.service${OFF} loaded ${RED}failed${OFF} ${RED}failed${OFF} ${RED}The Apache HTTP Server${OFF}`);
});

test('no colours through a pipe, a redirection, SYSTEMD_COLORS=0, NO_COLOR or TERM=dumb', () => {
  const { root } = lab();
  failApache(root);
  for (const cmd of ['systemctl status apache2 | cat', 'systemctl status apache2 2>/dev/null', 'SYSTEMD_COLORS=0 systemctl status apache2',
    'NO_COLOR=1 systemctl status apache2', 'TERM=dumb systemctl status apache2', 'journalctl -u apache2 | cat', 'SYSTEMD_COLORS=no journalctl -u apache2']) {
    assert.doesNotMatch(root.run(cmd).join('\n'), /\x1b/, cmd);
  }
});

test('SYSTEMD_COLORS=1 colours a pipe too; SYSTEMD_COLORS=16 uses the 16-colour yellow', () => {
  const { root } = lab();
  failApache(root);
  assert.equal(root.run('SYSTEMD_COLORS=1 systemctl status apache2 | head -1')[0], `${RED}×${OFF} apache2.service - The Apache HTTP Server`);
  root.run('systemctl disable apache2');
  assert.match(root.run('SYSTEMD_COLORS=16 systemctl status apache2')[1] ?? '', /; \x1b\[0;1;33mdisabled\x1b\[0m;/);
});
