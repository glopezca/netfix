/**
 * /etc/postfix/main.cf and /etc/dovecot/dovecot.conf edited from the console, as kea-dhcp4.conf: root's 644 files saved
 * with the lab; start, restart and reload check and import them (the mail domain, POP3/IMAP); a bad file leaves the
 * unit failed with Postfix's or Dovecot's error in the journal, and a bad reload keeps what runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { ShellSession } from '../../src/shells/base.ts';
import { savedFiles } from '../../src/shells/host-system.ts';
import { parseIp } from '../../src/core/ip.ts';

const CF = '/etc/postfix/main.cf';
const DC = '/etc/dovecot/dovecot.conf';

function lab(): { srv: Server; root: ShellSession; user: ShellSession } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  srv.setStatic({ ip: parseIp('192.168.10.2')!, prefix: 24 });
  srv.setServices({ ...srv.services, mail: { smtp: true, pop3: true, imap: true, domain: 'aula.lab', users: [] } });
  const [root, user] = [createShell(srv, 'linux', 'root'), createShell(srv, 'linux')];
  for (const sh of [root, user]) sh.run('export SYSTEMD_COLORS=0');
  return { srv, root, user };
}

const write = (root: ShellSession, path: string, text: string): void => { root.run(`cat > ${path} <<'EOF'\n${text}\nEOF`); };
const journal = (root: ShellSession, unit: string): string => root.run(`journalctl -u ${unit}`).join('\n');

test('root edits main.cf (root 644, saved with the lab), others cannot; saving applies nothing', () => {
  const { srv, root, user } = lab();
  assert.match(user.run(`echo x > ${CF}; echo $?`).join('\n'), /Permission denied\n1$/);
  write(root, CF, 'myhostname = mail.empresa.es\nmydomain = empresa.es\n');
  assert.match(root.run(`ls -l ${CF}`)[0] ?? '', /^-rw-r--r-- 1 root root /);
  assert.equal(srv.services.mail.domain, 'aula.lab');
  assert.ok(savedFiles(srv)?.some((f) => f.path === CF && f.kind === 'file'));
  assert.deepEqual(root.run('systemctl restart postfix; echo $?'), ['0']);
  assert.equal(srv.services.mail.domain, 'empresa.es', 'the Mail panel shows the applied domain');
  assert.match(journal(root, 'postfix'), /postfix\/postfix-script\[1021\]: starting the Postfix mail system/);
});

test('a bad main.cf: the start fails with postfix-script\'s fatal line; postfix check says the same', () => {
  const { srv, root } = lab();
  write(root, CF, 'mydomain = aula_lab\n');
  assert.deepEqual(root.run('postfix check; echo $?'), ['postfix: fatal: file /etc/postfix/main.cf: parameter mydomain: bad parameter value: aula_lab', '1']);
  root.run('systemctl restart postfix');
  assert.deepEqual(root.run('systemctl is-active postfix'), ['failed']);
  assert.equal(srv.services.mail.smtp, false);
  assert.match(journal(root, 'postfix'), /postfix\/postfix-script\[1021\]: fatal: file \/etc\/postfix\/main\.cf: parameter mydomain: bad parameter value: aula_lab/);
});

test('a bad reload keeps the running postfix and its domain; postfix reload says why', () => {
  const { srv, root } = lab();
  write(root, CF, 'mydomain = aula.lab\nmydomain empresa.es\n');
  assert.match(root.run('systemctl reload postfix; echo $?').join('\n'), /^Job for postfix\.service failed[\s\S]*\n1$/);
  assert.deepEqual(root.run('systemctl is-active postfix'), ['active']);
  assert.match(journal(root, 'postfix'), /Reload failed for postfix\.service/);
  assert.deepEqual(root.run('postfix reload; echo $?'), [`postfix: fatal: ${CF}, line 2: missing '=' after attribute name: "mydomain empresa.es"`, '1']);
  write(root, CF, 'mydomain = empresa.es\n');
  assert.deepEqual(root.run('postfix reload; echo $?'), ['postfix/postfix-script: refreshing the Postfix mail system', '0']);
  assert.equal(srv.services.mail.domain, 'empresa.es');
});

test('postconf -n and postconf NAME read main.cf as any user', () => {
  const { root, user } = lab();
  write(root, CF, 'mydomain = empresa.es\nmyhostname = mail.$mydomain\nfoo = bar\n');
  assert.deepEqual(user.run('postconf -n'), ['foo = bar', 'mydomain = empresa.es', 'myhostname = mail.$mydomain', 'postconf: warning: /etc/postfix/main.cf: unused parameter: foo=bar']);
  write(root, CF, 'mydomain = empresa.es\n');
  assert.deepEqual(user.run('postconf mydomain inet_interfaces'), ['mydomain = empresa.es', 'inet_interfaces = all']);
  assert.deepEqual(user.run('postconf nada; echo $?'), ['postconf: warning: nada: unknown parameter', '0']);
  assert.deepEqual(user.run('postfix check; echo $?'), ['postfix: fatal: the postfix command is reserved for the superuser', '1']);
});

test('dovecot.conf: protocols turns POP3/IMAP on or off; a bad file fails the start with doveconf\'s error', () => {
  const { srv, root, user } = lab();
  const good = root.run(`cat ${DC}`).join('\n').replace('protocols = pop3 imap', 'protocols = imap');
  write(root, DC, good);
  assert.match(user.run('doveconf -n').join('\n'), /^# 2\.4\.1-4 \(7d8c0e5759\): \/etc\/dovecot\/dovecot\.conf\n# OS: Linux [^\n]*\ndovecot_config_version = 2\.4\.1\n[\s\S]*protocols = imap/);
  root.run('systemctl restart dovecot');
  assert.deepEqual([srv.services.mail.pop3, srv.services.mail.imap], [false, true]);
  write(root, DC, `${good}\nmail_location = maildir:~/Maildir`);
  assert.deepEqual(root.run('doveconf -n >/dev/null; echo $?'), [`doveconf: Fatal: Error in configuration file ${DC} line 6: Unknown setting: mail_location`, '89']);
  assert.match(root.run('systemctl reload dovecot; echo $?').join('\n'), /\n1$/);
  assert.deepEqual(root.run('systemctl is-active dovecot'), ['active'], 'a bad reload keeps dovecot running');
  root.run('systemctl restart dovecot');
  assert.deepEqual(root.run('systemctl is-active dovecot'), ['failed']);
  assert.match(journal(root, 'dovecot'), /dovecot\[1088\]: doveconf: Fatal: Error in configuration file \/etc\/dovecot\/dovecot\.conf line 6: Unknown setting: mail_location/);
});

test('a domain changed in the Mail panel writes main.cf again from the model (an edit not applied is lost)', () => {
  const { srv, root } = lab();
  write(root, CF, 'mydomain = empresa.es\n');
  srv.setServices({ ...srv.services, mail: { ...srv.services.mail, domain: 'otra.lab' } });
  assert.match(root.run(`cat ${CF}`).join('\n'), /mydomain = otra\.lab/);
});

type Saved = { devices: { id: string; pc?: { files?: { path: string; kind: string; mode: number; uid: number; content?: string; target?: string }[] } }[] };

test('a saved lab brings main.cf back as root\'s 644 file, never another user\'s nor behind a link', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  srv.setServices({ ...srv.services, mail: { smtp: true, pop3: true, imap: true, domain: 'aula.lab', users: [] } });
  const root = createShell(srv, 'linux', 'root');
  write(root, CF, 'mydomain = empresa.es\n');
  root.run('systemctl restart postfix');
  const json = JSON.parse(JSON.stringify(t.toJSON())) as Saved;
  const files = json.devices.find((d) => d.id === srv.id)?.pc?.files ?? [];
  for (const f of files) if (f.path === CF) Object.assign(f, { uid: 1000, mode: 0o666 });
  files.unshift({ path: '/tmp/p', kind: 'dir', mode: 0o777, uid: 1000 }, { path: '/etc/postfix', kind: 'link', target: '/tmp/p', mode: 0o777, uid: 1000 });
  const again = Topology.fromJSON(json).get(srv.id)?.device as Server;
  const sh = createShell(again, 'linux', 'root');
  assert.deepEqual(sh.run(`stat -c '%U %a %F' /etc/postfix ${CF}`), ['root 755 directory', 'root 644 regular file']);
  assert.match(sh.run(`cat ${CF}`).join('\n'), /mydomain = empresa\.es/);
  assert.equal(again.services.mail.domain, 'empresa.es');
});
