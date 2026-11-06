/**
 * /etc/kea/kea-dhcp4.conf edited from the console (Ubuntu, isc-kea's kea-dhcp4-server.service, Type=simple): saving
 * applies nothing; start/restart check it as kea-dhcp4 does. A good file goes into the DHCP model, a bad one leaves
 * the unit failed with Kea's error in the journal (systemctl itself says nothing and returns 0). Kea has no
 * ExecReload: reload is not applicable, force-reload restarts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { savedFiles } from '../../src/shells/host-system.ts';
import { checkKeaConf } from '../../src/services/kea-check.ts';
import { parseIp } from '../../src/core/ip.ts';

const P = '/etc/kea/kea-dhcp4.conf';
const ip = (s: string): number => parseIp(s) ?? 0;
const KEA = 'kea-dhcp4[812]: ERROR [kea-dhcp4.dhcp4/812.140245170644864]';

function lab(): { t: Topology; srv: Server; root: ShellSession; user: ShellSession } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  srv.setStatic({ ip: parseIp('192.168.10.2')!, prefix: 24 });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'LAN', start: ip('192.168.10.100'), prefix: 24, maxUsers: 50, leaseMinutes: 1440, reservations: [] }] } });
  const [root, user] = [createShell(srv, 'linux', 'root'), createShell(srv, 'linux')];
  for (const sh of [root, user]) sh.run('export SYSTEMD_COLORS=0');
  return { t, srv, root, user };
}

const GOOD = `{ "Dhcp4": { "interfaces-config": { "interfaces": [ "eth0" ] },
  "subnet4": [ { "id": 1, "subnet": "192.168.10.0/24", "pools": [ { "pool": "192.168.10.20 - 192.168.10.29" } ],
    "option-data": [ { "name": "routers", "data": "192.168.10.1" } ] },
  { "id": 2, "subnet": "10.5.0.0/24", "pools": [ { "pool": "10.5.0.10 - 10.5.0.19" } ] } ] } }`;
const SYNTAX = '{ "Dhcp4": { "subnet4": [ ] }';
const OUTSIDE = '{ "Dhcp4": { "subnet4": [ { "id": 1, "subnet": "192.168.10.0/24", "pools": [ { "pool": "10.0.0.1 - 10.0.0.9" } ] } ] } }';

function write(root: ShellSession, text: string): void {
  root.run(`cat > ${P} <<'EOF'\n${text}\nEOF`);
}

const journal = (root: ShellSession): string => root.run('journalctl -u kea-dhcp4-server').join('\n');

test('root edits the file (it stays root 644); other users cannot; saving applies nothing', () => {
  const { srv, root, user } = lab();
  assert.match(user.run(`echo x > ${P}; echo $?`).join('\n'), /Permission denied\n1$/);
  write(root, GOOD);
  assert.match(root.run(`ls -l ${P}`)[0] ?? '', /^-rw-r--r-- 1 root root /);
  assert.match(root.run(`cat ${P}`).join('\n'), /10\.5\.0\.10 - 10\.5\.0\.19/);
  assert.deepEqual(srv.services.dhcp.pools.map((p) => p.name), ['LAN'], 'not until the unit restarts');
  assert.ok(savedFiles(srv)?.some((f) => f.path === P && f.kind === 'file'), 'saved with the lab');
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, enabled: !srv.services.dns.enabled } });
  assert.match(root.run(`cat ${P}`).join('\n'), /10\.5\.0\.10/, 'a later refresh does not mount the generated view over it');
});

test('a good file and a restart: the DHCP model follows it', () => {
  const { srv, root } = lab();
  write(root, GOOD);
  assert.deepEqual(root.run('systemctl restart kea-dhcp4-server; echo $?'), ['0']);
  const pools = srv.services.dhcp.pools;
  assert.deepEqual(pools.map((p) => [p.name, p.start, p.maxUsers, p.gateway]), [['LAN', ip('192.168.10.20'), 10, ip('192.168.10.1')], ['subnet2', ip('10.5.0.10'), 10, undefined]]);
  assert.deepEqual(srv.services.dhcp.interfaces, ['eth0']);
  assert.deepEqual(root.run('systemctl is-active kea-dhcp4-server'), ['active']);
  assert.match(journal(root), /systemd\[1\]: Started kea-dhcp4-server\.service - Kea DHCPv4 Service\.$/);
  assert.doesNotMatch(journal(root), /Starting kea-dhcp4-server/, 'Type=simple: systemd only says Started');
});

test('a syntax error: systemctl says nothing, the unit is failed and Kea writes why', () => {
  const { srv, root } = lab();
  write(root, SYNTAX);
  assert.deepEqual(root.run('systemctl restart kea-dhcp4-server; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl is-active kea-dhcp4-server; echo $?'), ['failed', '3']);
  assert.equal(srv.services.dhcp.enabled, false, 'DHCP stops answering');
  const reason = (checkKeaConf(P, `${SYNTAX}\n`).error ?? '').replace(/^Syntax check failed with: /, '');
  const tail = root.run('journalctl -u kea-dhcp4-server -n 5').map((l) => l.replace(/^\w{3} \d\d \d\d:\d\d:\d\d server0 /, ''));
  assert.deepEqual(tail, [
    'systemd[1]: Started kea-dhcp4-server.service - Kea DHCPv4 Service.',
    `${KEA} DHCP4_CONFIG_LOAD_FAIL configuration error using file: ${P}, reason: ${reason}`,
    `${KEA} DHCP4_INIT_FAIL failed to initialize Kea server: configuration error using file '${P}': ${reason}`,
    'systemd[1]: kea-dhcp4-server.service: Main process exited, code=exited, status=1/FAILURE',
    "systemd[1]: kea-dhcp4-server.service: Failed with result 'exit-code'.",
  ]);
  assert.match(root.run('systemctl status kea-dhcp4-server').join('\n'), /^× kea-dhcp4-server\.service - Kea DHCPv4 Service\n.*\n {5}Active: failed \(Result: exit-code\) since .*\n {4}Process: 812 ExecStart=\/usr\/sbin\/kea-dhcp4 -c \/etc\/kea\/kea-dhcp4\.conf \(code=exited, status=1\/FAILURE\)\n {3}Main PID: 812 \(code=exited, status=1\/FAILURE\)/);
});

test('what a file makes Kea write cannot fake a journal line nor colour the terminal', () => {
  const { srv, root } = lab();
  write(root, '{ "Dhcp4": { "subnet4": [ { "id": 1, "subnet": "192.168.10.0/24", "pools": [ { "pool": "x\\nsystemd[1]: Started evil.\\u001b[31m" } ] } ] } }');
  root.run('systemctl restart kea-dhcp4-server');
  const shown = journal(root);
  // journald: each line of the message is an entry of its own, still written by Kea.
  assert.doesNotMatch(shown, /server0 systemd\[1\]: Started evil/);
  assert.match(shown, /server0 kea-dhcp4\[812\]: systemd\[1\]: Started evil\.\\x1b\[31m\./);
  assert.ok(!shown.includes('\u001b'), 'the escape is shown as \\x1b');
  srv.log('dhcp', 'y'.repeat(5000));
  assert.equal(srv.journal('dhcp').at(-1)?.line.length, 2049, 'a line is cut at 2048 characters');
});

test('a configuration error: the parser line first, the reason without the -t prefix', () => {
  const { root } = lab();
  write(root, OUTSIDE);
  root.run('systemctl restart kea-dhcp4-server');
  const reason = (checkKeaConf(P, `${OUTSIDE}\n`).error ?? '').replace(/^Error encountered: /, '');
  const log = journal(root);
  assert.match(log, new RegExp(`${KEA.replace(/[[\].]/g, '\\$&')} DHCP4_PARSER_FAIL failed to create or run parser for configuration element subnet4: `));
  assert.ok(log.includes(`DHCP4_CONFIG_LOAD_FAIL configuration error using file: ${P}, reason: ${reason}\n`));
});

test('fixing the file and starting again brings the unit back', () => {
  const { srv, root } = lab();
  write(root, SYNTAX);
  root.run('systemctl restart kea-dhcp4-server');
  write(root, GOOD);
  assert.deepEqual(root.run('systemctl start kea-dhcp4-server; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl is-active kea-dhcp4-server'), ['active']);
  assert.equal(srv.services.dhcp.pools.length, 2);
  root.run(`rm ${P}`);
  root.run('systemctl restart kea-dhcp4-server');
  assert.match(journal(root), /DHCP4_CONFIG_LOAD_FAIL configuration error using file: \/etc\/kea\/kea-dhcp4\.conf, reason: Unable to open file \/etc\/kea\/kea-dhcp4\.conf\n/);
});

test('reload is not applicable (no ExecReload); force-reload and reload-or-restart restart with the check', () => {
  const { srv, root, user } = lab();
  write(root, GOOD);
  assert.deepEqual(root.run('systemctl reload kea-dhcp4-server; echo $?'), ['Failed to reload kea-dhcp4-server.service: Job type reload is not applicable for unit kea-dhcp4-server.service.', '1']);
  assert.equal(srv.services.dhcp.pools.length, 1, 'reload does not read the file');
  assert.deepEqual(root.run('systemctl force-reload kea-dhcp4-server; echo $?'), ['0']);
  assert.equal(srv.services.dhcp.pools.length, 2);
  write(root, SYNTAX);
  assert.deepEqual(root.run('systemctl reload-or-restart kea-dhcp4-server; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl is-active kea-dhcp4-server'), ['failed']);
  assert.match(user.run('systemctl try-restart kea-dhcp4-server').join('\n'), /^Failed to try-restart kea-dhcp4-server\.service: Interactive authentication required\./);
});

test('try-restart and try-reload-or-restart leave a stopped unit stopped', () => {
  const { srv, root } = lab();
  root.run('systemctl stop kea-dhcp4-server');
  write(root, GOOD);
  assert.deepEqual(root.run('systemctl try-restart kea-dhcp4-server; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl try-reload-or-restart kea-dhcp4-server; echo $?'), ['0']);
  assert.equal(srv.services.dhcp.enabled, false);
  root.run('systemctl start kea-dhcp4-server');
  assert.deepEqual(root.run('systemctl try-restart kea-dhcp4-server; echo $?'), ['0']);
  assert.equal(srv.services.dhcp.enabled, true);
});

test('the Services switch takes the same path as systemctl', () => {
  const { srv, root } = lab();
  write(root, SYNTAX);
  srv.setUnit('dhcp', false);
  srv.setUnit('dhcp', true);
  assert.equal(srv.services.dhcp.enabled, false);
  assert.ok(srv.failed.dhcp, 'failed, with the error in the journal');
  assert.match(journal(root), /DHCP4_INIT_FAIL/);
});

test('an untouched (generated) file starts without a check and keeps the model', () => {
  const { srv, root } = lab();
  assert.deepEqual(root.run('systemctl restart kea-dhcp4-server; echo $?'), ['0']);
  assert.deepEqual(srv.services.dhcp.pools.map((p) => p.name), ['LAN']);
  assert.match(root.run(`cat ${P}`).join('\n'), /192\.168\.10\.100 - 192\.168\.10\.149/);
});

type Saved = { devices: { id: string; pc?: { files?: { path: string; kind: string; mode: number; uid: number; content?: string; target?: string }[] } }[] };
const saved = (t: Topology): Saved => JSON.parse(JSON.stringify(t.toJSON())) as Saved;

test('the edited file is saved with the lab and comes back after loading it', () => {
  const { t, srv, root } = lab();
  write(root, GOOD);
  const again = Topology.fromJSON(saved(t)).get(srv.id)?.device as Server;
  const sh = createShell(again, 'linux', 'root');
  assert.match(sh.run(`cat ${P}`).join('\n'), /10\.5\.0\.0\/24/);
  assert.deepEqual(sh.run(`stat -c '%U %a' ${P}`), ['root 644']);
});

test('a saved lab cannot hand the file to another user nor put a link above it', () => {
  const { t, srv, root } = lab();
  write(root, GOOD);
  const json = saved(t);
  const files = json.devices.find((d) => d.id === srv.id)?.pc?.files ?? [];
  for (const f of files) if (f.path === P) Object.assign(f, { uid: 1000, mode: 0o666 });
  files.unshift({ path: '/tmp/k', kind: 'dir', mode: 0o777, uid: 1000 }, { path: '/etc/kea', kind: 'link', target: '/tmp/k', mode: 0o777, uid: 1000 });
  const again = Topology.fromJSON(json).get(srv.id)?.device as Server;
  const sh = createShell(again, 'linux', 'root');
  assert.deepEqual(sh.run(`stat -c '%U %a %F' /etc/kea ${P}`), ['root 755 directory', 'root 644 regular file']);
  assert.match(sh.run(`cat ${P}`).join('\n'), /10\.5\.0\.0\/24/);
});
