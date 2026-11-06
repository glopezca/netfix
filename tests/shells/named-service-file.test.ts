/**
 * The BIND files edited from the console (Ubuntu's bind9: named.service, Type=notify, Restart=on-failure,
 * ExecReload=rndc reload): saving applies nothing; start/restart load them as named does. A bad named.conf leaves the
 * unit failed after systemd's restarts; a bad zone leaves only that zone unloaded (SERVFAIL). A reload with a bad file
 * keeps what named was serving.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { savedFiles } from '../../src/shells/host-system.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const DB = '/etc/bind/db.aula.lab';
const LOCAL = '/etc/bind/named.conf.local';
const NAMED = 'named[845]';
const JOB_FAILED = ['Job for named.service failed because the control process exited with error code.', 'See "systemctl status named.service" and "journalctl -xeu named.service" for details.'];

interface Lab { t: Topology; srv: Server; root: ShellSession; user: ShellSession; pc: (c: string) => string }

function lab(): Lab {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('192.168.10.2'), prefix: 24 });
  pc.setStatic({ ip: ip('192.168.10.10'), prefix: 24, gateway: ip('192.168.10.1'), dns: ip('192.168.10.2') });
  const zone = { ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [{ name: 'ns', type: 'A' as const, value: '192.168.10.2', ttl: 3600 }, { name: 'www', type: 'A' as const, value: '192.168.10.80', ttl: 3600 }] };
  srv.setServices({ ...srv.services, dns: { enabled: true, zones: [zone] } });
  t.settle();
  const [root, user] = [createShell(srv, 'linux', 'root'), createShell(srv, 'linux')];
  for (const sh of [root, user]) sh.run('export SYSTEMD_COLORS=0');
  const p = createShell(pc, 'linux');
  return { t, srv, root, user, pc: (c) => p.run(c).join('\n') };
}

const zoneText = (www: string, extra = ''): string => `$TTL 3600
@     IN SOA ns.aula.lab. jefe.aula.lab. ( 2026110601 7200 900 1209600 300 )
      IN NS  ns
ns    IN A   192.168.10.2
www   IN A   ${www}
nuevo IN A   192.168.10.99
${extra}`;

function write(root: ShellSession, path: string, text: string): void {
  root.run(`cat > ${path} <<'EOF'\n${text}\nEOF`);
}

/** The journal of named without the date and host. */
const journal = (root: ShellSession, n = 200): string[] => root.run(`journalctl -u named -n ${n}`).map((l) => l.replace(/^\w{3} \d\d \d\d:\d\d:\d\d server0 /, ''));

test('root edits a zone file (it stays root 644); other users cannot; saving applies nothing', () => {
  const { srv, root, user, pc } = lab();
  assert.match(user.run(`echo x > ${DB}; echo $?`).join('\n'), /Permission denied\n1$/);
  write(root, DB, zoneText('192.168.10.81'));
  assert.match(root.run(`ls -l ${DB}`)[0] ?? '', /^-rw-r--r-- 1 root root /);
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.80', 'not until named loads it');
  assert.ok(savedFiles(srv)?.some((f) => f.path === DB && f.kind === 'file'), 'saved with the lab');
});

test('a good zone file and a restart: the zone of the model follows it and named says it loaded', () => {
  const { srv, root, pc } = lab();
  write(root, DB, zoneText('192.168.10.81'));
  assert.deepEqual(root.run('systemctl restart named; echo $?'), ['0']);
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.81');
  assert.equal(pc('dig +short nuevo.aula.lab').trim(), '192.168.10.99');
  assert.equal(srv.services.dns.zones[0]?.soa.rname, 'jefe.aula.lab');
  assert.ok(journal(root).includes(`${NAMED}: zone aula.lab/IN: loaded serial 2026110601`));
  assert.deepEqual(root.run('systemctl is-active named'), ['active']);
});

test('a new zone declared in named.conf.local with its own file', () => {
  const { srv, root, pc } = lab();
  const local = root.run(`cat ${LOCAL}`).join('\n');
  write(root, LOCAL, `${local}\nzone "otra.lab" {\n\ttype master;\n\tfile "/etc/bind/db.otra.lab";\n};`);
  write(root, '/etc/bind/db.otra.lab', '$TTL 60\n@ IN SOA ns.otra.lab. admin.otra.lab. 7 1 1 1 1\n@ IN NS ns.otra.lab.\nns IN A 192.168.10.2\nweb IN A 10.9.9.9');
  root.run('systemctl restart named');
  assert.deepEqual(srv.services.dns.zones.map((z) => z.name), ['aula.lab', 'otra.lab']);
  assert.equal(pc('dig +short web.otra.lab').trim(), '10.9.9.9');
});

test('a bad named.conf: systemctl says the job failed, named writes why, systemd restarts it five times', () => {
  const { srv, root, pc } = lab();
  const local = root.run(`cat ${LOCAL}`).join('\n');
  write(root, LOCAL, `${local}\nzone "rota.lab" {\n\ttype master\n};`);
  const errors = root.run('named-checkconf');
  assert.ok(errors.length > 0);
  assert.deepEqual(root.run('systemctl restart named; echo $?'), [...JOB_FAILED, '1']);
  assert.deepEqual(root.run('systemctl is-active named; echo $?'), ['failed', '3']);
  assert.equal(srv.services.dns.enabled, false);
  const named = [`${NAMED}: loading configuration from '/etc/bind/named.conf'`, ...errors.map((e) => `${NAMED}: ${e}`), `${NAMED}: loading configuration: failure`, `${NAMED}: exiting (due to fatal error)`];
  const failed = ['systemd[1]: named.service: Main process exited, code=exited, status=1/FAILURE', "systemd[1]: named.service: Failed with result 'exit-code'.", 'systemd[1]: Failed to start named.service - BIND Domain Name Server.'];
  const log = journal(root);
  const first = log.lastIndexOf('systemd[1]: Starting named.service - BIND Domain Name Server...', log.indexOf('systemd[1]: named.service: Scheduled restart job, restart counter is at 1.'));
  const retry = (n: number): string[] => [`systemd[1]: named.service: Scheduled restart job, restart counter is at ${n}.`, 'systemd[1]: Starting named.service - BIND Domain Name Server...', ...named, ...failed];
  assert.deepEqual(log.slice(first), [
    'systemd[1]: Starting named.service - BIND Domain Name Server...', ...named, ...failed,
    ...retry(1), ...retry(2), ...retry(3), ...retry(4),
    'systemd[1]: named.service: Scheduled restart job, restart counter is at 5.',
    'systemd[1]: named.service: Start request repeated too quickly.',
    "systemd[1]: named.service: Failed with result 'exit-code'.",
    'systemd[1]: Failed to start named.service - BIND Domain Name Server.',
  ]);
  assert.match(pc('dig www.aula.lab'), /connection timed out|no servers could be reached/);
  write(root, LOCAL, local);
  assert.deepEqual(root.run('systemctl start named; echo $?'), ['0']);
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.80');
});

test('a bad zone: named starts and only that zone is not loaded (SERVFAIL)', () => {
  const { root, pc } = lab();
  write(root, DB, zoneText('192.168.10.81', 'malo IN BOGUS 1'));
  assert.deepEqual(root.run('systemctl restart named; echo $?'), ['0']);
  assert.deepEqual(root.run('systemctl is-active named'), ['active']);
  const log = journal(root).join('\n');
  assert.match(log, /named\[845\]: zone aula\.lab\/IN: loading from master file \/etc\/bind\/db\.aula\.lab failed: /);
  assert.match(log, /named\[845\]: zone aula\.lab\/IN: not loaded due to errors\.$/m);
  assert.match(pc('dig www.aula.lab'), /status: SERVFAIL/);
  write(root, DB, zoneText('192.168.10.81'));
  root.run('systemctl restart named');
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.81');
});

test('reload with a bad named.conf: named keeps running with what it had; rndc reload says it failed', () => {
  const { srv, root, pc } = lab();
  const local = root.run(`cat ${LOCAL}`).join('\n');
  write(root, DB, zoneText('192.168.10.81'));
  write(root, LOCAL, `${local}\nzone "rota.lab" {\n\ttype master\n};`);
  assert.deepEqual(root.run('systemctl reload named; echo $?'), [...JOB_FAILED, '1']);
  assert.deepEqual(root.run('systemctl is-active named'), ['active']);
  const log = journal(root, 8);
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.80', 'the configuration it had');
  assert.deepEqual(log.slice(-4), [`${NAMED}: reloading configuration failed: failure`, "rndc[1311]: rndc: 'reload' failed: failure", 'systemd[1]: named.service: Control process exited, code=exited, status=1/FAILURE', 'systemd[1]: Reload failed for named.service - BIND Domain Name Server.']);
  assert.deepEqual(root.run('rndc reload; echo $?'), ["rndc: 'reload' failed: failure", '1']);
  assert.equal(srv.services.dns.enabled, true);
  write(root, LOCAL, local);
  assert.deepEqual(root.run('rndc reload; echo $?'), ['server reload successful', '0']);
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.81');
});

test('reload with a bad zone keeps the version named was serving', () => {
  const { root, pc } = lab();
  write(root, DB, zoneText('192.168.10.81', 'malo IN BOGUS 1'));
  assert.deepEqual(root.run('systemctl reload named; echo $?'), ['0']);
  assert.equal(pc('dig +short www.aula.lab').trim(), '192.168.10.80');
  assert.match(journal(root).join('\n'), /zone aula\.lab\/IN: not loaded due to errors\./);
});

test('named.conf.options applies when named starts, not when it is saved', () => {
  const { srv, root } = lab();
  const opts = root.run('cat /etc/bind/named.conf.options').join('\n');
  write(root, '/etc/bind/named.conf.options', opts.replace(/recursion \w+;/, 'recursion yes;').replace(/forwarders \{[^}]*\};|options \{/, (m) => (m.startsWith('options') ? 'options {\n\tforwarders { 9.9.9.9; };' : 'forwarders { 9.9.9.9; };')));
  assert.deepEqual(srv.services.dns.forwarders ?? [], []);
  root.run('systemctl restart named');
  assert.deepEqual(srv.services.dns.forwarders, [ip('9.9.9.9')]);
});

test('named reads only /etc/bind and /var/cache/bind: another file is permission denied, and its text is not logged', () => {
  const { root } = lab();
  root.run('echo "secreto IN A 1.2.3.4" > /root/zona; ln -s /root/zona /etc/bind/db.enlace');
  const local = root.run(`cat ${LOCAL}`).join('\n');
  write(root, LOCAL, `${local}\nzone "fuera.lab" { type master; file "/root/zona"; };\nzone "enlace.lab" { type master; file "/etc/bind/db.enlace"; };`);
  root.run('systemctl restart named');
  const log = journal(root).join('\n');
  assert.match(log, /zone fuera\.lab\/IN: loading from master file \/root\/zona failed: permission denied/);
  assert.match(log, /zone enlace\.lab\/IN: loading from master file \/etc\/bind\/db\.enlace failed: permission denied/);
  assert.doesNotMatch(log, /secreto/);
});

test('an untouched /etc/bind starts without reading it and keeps the model', () => {
  const { srv, root } = lab();
  const before = srv.services.dns;
  assert.deepEqual(root.run('systemctl restart named; echo $?'), ['0']);
  assert.deepEqual(srv.services.dns.zones, before.zones);
  assert.doesNotMatch(journal(root).join('\n'), /named\[845\]/);
});

type Saved = { devices: { id: string; pc?: { files?: { path: string; kind: string; mode: number; uid: number; content?: string }[] } }[] };

test('an edited zone file is saved with the lab and comes back root 644', () => {
  const { t, srv, root } = lab();
  write(root, DB, zoneText('192.168.10.81'));
  const json = JSON.parse(JSON.stringify(t.toJSON())) as Saved;
  for (const f of json.devices.find((d) => d.id === srv.id)?.pc?.files ?? []) if (f.path === DB) Object.assign(f, { uid: 1000, mode: 0o666 });
  const again = Topology.fromJSON(json).get(srv.id)?.device as Server;
  const sh = createShell(again, 'linux', 'root');
  assert.deepEqual(sh.run(`stat -c '%U %a' ${DB}`), ['root 644']);
  assert.match(sh.run(`cat ${DB}`).join('\n'), /192\.168\.10\.81/);
});
