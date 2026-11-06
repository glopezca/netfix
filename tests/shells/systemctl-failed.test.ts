/**
 * The failed state of systemd units (systemd 257/258, Ubuntu): a start that fails leaves the unit failed until a
 * successful start or `systemctl reset-failed`; status, is-active, is-failed, --failed and the journal show it as
 * Ubuntu does. BIND's unit is named.service, with the alias bind9.service.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { parseIp } from '../../src/core/ip.ts';

const T0 = Date.UTC(2026, 10, 6, 10, 0, 0);

function lab(): { t: Topology; srv: Server; root: ShellSession; user: ShellSession } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  t.clock.set(T0);
  // The format without colours (systemd-colors.test.ts checks them).
  const [root, user] = [createShell(srv, 'linux', 'root'), createShell(srv, 'linux')];
  for (const sh of [root, user]) sh.run('export SYSTEMD_COLORS=0');
  return { t, srv, root, user };
}

const all = (lines: readonly string[]): string => lines.join('\n');

/** Breaks Apache's configuration and restarts it: the start fails. */
function failApache(root: ShellSession): void {
  root.run('echo "DocumentRot /var/www/x" >> /etc/apache2/sites-available/000-default.conf');
  root.run('systemctl restart apache2');
}

test('a failed start: × in status, Result: exit-code since the failure, the process that failed', () => {
  const { t, root } = lab();
  failApache(root);
  t.net.runFor(5000);
  assert.deepEqual(root.run('systemctl status apache2; echo $?'), [
    '× apache2.service - The Apache HTTP Server',
    '     Loaded: loaded (/usr/lib/systemd/system/apache2.service; enabled; preset: enabled)',
    '     Active: failed (Result: exit-code) since Fri 2026-11-06 10:00:00 UTC; 5s ago',
    '    Process: 1123 ExecStart=/usr/sbin/apachectl start (code=exited, status=1/FAILURE)',
    '',
    ...root.run('journalctl -u apache2 -n 5'),
    '3',
  ]);
});

test('is-active says failed (status 3), is-failed says it with status 0; a healthy unit is not failed', () => {
  const { root } = lab();
  assert.deepEqual(root.run('systemctl is-failed apache2; echo $?'), ['active', '1']);
  failApache(root);
  assert.deepEqual(root.run('systemctl is-active apache2; echo $?'), ['failed', '3']);
  assert.deepEqual(root.run('systemctl is-failed apache2; echo $?'), ['failed', '0']);
  root.run('systemctl stop apache2');
  assert.deepEqual(root.run('systemctl is-failed apache2'), ['failed'], 'stopping a failed unit leaves it failed');
});

test('the journal: systemd[1] writes its own lines, the failing program writes its own', () => {
  const { root } = lab();
  failApache(root);
  const log = all(root.run('journalctl -u apache2'));
  assert.match(log, /server0 systemd\[1\]: Starting apache2\.service - The Apache HTTP Server\.\.\.\n/);
  assert.match(log, / apachectl\[1123\]: AH00526: Syntax error on line 16/);
  assert.match(log, / systemd\[1\]: apache2\.service: Control process exited, code=exited, status=1\/FAILURE\n.* systemd\[1\]: apache2\.service: Failed with result 'exit-code'\.\n.* systemd\[1\]: Failed to start apache2\.service - The Apache HTTP Server\.$/);
  assert.doesNotMatch(log, /apache2\[903\]: apachectl/, 'no process name twice');
});

test('a successful start, and a stop, as systemd 257 logs them', () => {
  const { root } = lab();
  root.run('systemctl stop apache2');
  root.run('systemctl start apache2');
  const log = all(root.run('journalctl -u apache2 -n 5'));
  assert.match(log, /systemd\[1\]: Stopping apache2\.service - The Apache HTTP Server\.\.\.\n.*systemd\[1\]: apache2\.service: Deactivated successfully\.\n.*systemd\[1\]: Stopped apache2\.service - The Apache HTTP Server\.\n.*systemd\[1\]: Starting apache2\.service - The Apache HTTP Server\.\.\.\n.*systemd\[1\]: Started apache2\.service - The Apache HTTP Server\.$/);
});

test('--failed and list-units --failed list the failed units; reset-failed clears them', () => {
  const { root, user } = lab();
  const none = ['  UNIT LOAD ACTIVE SUB DESCRIPTION', '', '0 loaded units listed.'];
  assert.deepEqual(root.run('systemctl --failed'), none);
  failApache(root);
  const listed = [
    '  UNIT            LOAD   ACTIVE SUB    DESCRIPTION',
    '● apache2.service loaded failed failed The Apache HTTP Server',
    '',
    'Legend: LOAD   → Reflects whether the unit definition was properly loaded.',
    '        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.',
    '        SUB    → The low-level unit activation state, values depend on unit type.',
    '',
    '1 loaded units listed.',
  ];
  assert.deepEqual(root.run('systemctl --failed'), listed);
  assert.deepEqual(root.run('systemctl list-units --failed'), listed);
  assert.deepEqual(root.run('systemctl list-units --state=failed'), listed);
  assert.match(all(root.run('systemctl list-units')), /● apache2\.service +loaded failed   failed  The Apache HTTP Server/);
  assert.deepEqual(user.run('systemctl reset-failed apache2; echo $?'), ['Failed to reset failed state of unit apache2.service: Interactive authentication required.', '1']);
  assert.deepEqual(root.run('systemctl reset-failed apache2; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl is-active apache2'), ['inactive']);
  assert.deepEqual(root.run('systemctl --failed'), none);
});

test('reset-failed without a unit clears every one; a good start clears the unit too', () => {
  const { root } = lab();
  failApache(root);
  root.run('systemctl reset-failed');
  assert.deepEqual(root.run('systemctl is-failed apache2'), ['inactive']);
  failApache(root);
  root.run("sed -i '/DocumentRot/d' /etc/apache2/sites-available/000-default.conf");
  assert.deepEqual(root.run('systemctl start apache2; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl is-active apache2'), ['active']);
  assert.deepEqual(root.run('systemctl reset-failed nada; echo $?'), ['Failed to reset failed state of unit nada.service: Unit nada.service not loaded.', '1']);
});

test('sshd -t refuses a bad sshd_config: ExecStartPre fails with 255/EXCEPTION', () => {
  const { root } = lab();
  root.run('echo "PermitRootLogn no" >> /etc/ssh/sshd_config; systemctl restart ssh');
  const status = all(root.run('systemctl status ssh'));
  assert.match(status, /^× ssh\.service - OpenBSD Secure Shell server\n.*\n {5}Active: failed \(Result: exit-code\) since .*\n {4}Process: 701 ExecStartPre=\/usr\/sbin\/sshd -t \(code=exited, status=255\/EXCEPTION\)\n/);
  assert.match(all(root.run('journalctl -u ssh')), /systemd\[1\]: ssh\.service: Control process exited, code=exited, status=255\/EXCEPTION/);
});

test('nftables (oneshot): the main process is the one that failed', () => {
  const { root } = lab();
  root.run("echo 'table inet broken { chain c { tcp dprt 1 accept } }' >> /etc/nftables.conf; systemctl start nftables");
  assert.match(all(root.run('systemctl status nftables')), /\n {4}Process: 655 ExecStart=\/usr\/sbin\/nft -f \/etc\/nftables\.conf \(code=exited, status=1\/FAILURE\)\n {3}Main PID: 655 \(code=exited, status=1\/FAILURE\)/);
});

test('BIND is named.service; bind9 is its alias (status shows the real name, enable refuses the alias)', () => {
  const { root } = lab();
  root.run('systemctl start bind9');
  assert.match(all(root.run('systemctl status bind9')), /^● named\.service - BIND Domain Name Server\n {5}Loaded: loaded \(\/usr\/lib\/systemd\/system\/named\.service; enabled; preset: enabled\)/);
  assert.deepEqual(root.run('systemctl is-active named.service'), ['active']);
  assert.deepEqual(root.run('systemctl enable bind9; echo $?'), ['Failed to enable unit: Refusing to operate on alias name or linked unit file: bind9.service', '1']);
  assert.match(all(root.run('systemctl enable named')), /Created symlink/);
});

test('the time since the failure, as systemd writes it', () => {
  const { t, root } = lab();
  failApache(root);
  const since = (): string => /; (.*)$/.exec(root.run('systemctl status apache2')[2] ?? '')?.[1] ?? '';
  t.net.runFor(90_000);
  assert.equal(since(), '1min 30s ago');
  t.net.runFor(10 * 60_000);
  assert.equal(since(), '11min ago', 'past 5 minutes the seconds go');
  t.net.runFor(2 * 3600_000);
  assert.equal(since(), '2h 11min ago');
});

test('reload of a unit that is not running: systemd refuses it (status 1); reload-or-restart starts it', () => {
  const { root } = lab();
  failApache(root);
  assert.deepEqual(root.run('systemctl reload apache2; echo $?'), ['Failed to reload apache2.service: Unit apache2.service is not active.', '1']);
  assert.equal(root.run('systemctl is-active apache2')[0], 'failed');
  root.run('systemctl stop named');
  assert.deepEqual(root.run('systemctl reload named; echo $?'), ['Failed to reload named.service: Unit named.service is not active.', '1']);
  assert.equal(root.run('systemctl is-active named')[0], 'inactive');
  assert.deepEqual(root.run('systemctl reload-or-restart named; echo $?'), ['0']);
  assert.equal(root.run('systemctl is-active named')[0], 'active');
});

test('journalctl -xeu UNIT, as systemctl suggests: the unit only, to the end; -n5, --unit= and --lines= too', () => {
  const { root } = lab();
  failApache(root);
  const xeu = root.run('journalctl -xeu apache2.service');
  assert.ok(xeu.length > 3 && xeu.every((l) => / (systemd\[1\]|apachectl\[1123\]): /.test(l)), xeu.join('\n'));
  assert.match(xeu.at(-1) ?? '', /Failed to start apache2\.service/);
  assert.deepEqual(root.run('journalctl -u apache2 -n5'), root.run('journalctl --unit=apache2 --lines=5'));
  assert.equal(root.run('journalctl -n2 -u apache2').length, 2);
});
