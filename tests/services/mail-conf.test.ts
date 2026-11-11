/** main.cf (Postfix 3.10) and dovecot.conf (Dovecot 2.4) as their checkers read them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMainCf, parseMainCf, postfixValue } from '../../src/services/postfix-conf.ts';
import { parseDovecotConf } from '../../src/services/dovecot-conf.ts';

test('main.cf: continuation lines, comments, $name expansion and the domain of the model', () => {
  const cf = parseMainCf('# comment\nmyhostname = mail.$mydomain\nmydomain = Aula.LAB\nmydestination = $mydomain,\n  localhost\n');
  assert.equal(cf.error, undefined);
  assert.equal(cf.params.get('mydestination'), '$mydomain, localhost');
  assert.equal(postfixValue(cf.params, 'myhostname'), 'mail.Aula.LAB');
  assert.deepEqual(checkMainCf('myhostname = mail.$mydomain\nmydomain = Aula.LAB\n'), { warnings: [], domain: 'aula.lab' });
  assert.equal(checkMainCf('myhostname = srv.empresa.es\n').domain, 'empresa.es', 'mydomain defaults to myhostname minus its first label');
  assert.equal(checkMainCf('mydomain = localdomain\n').domain, '', "Postfix's localdomain is no mail domain");
});

test('main.cf: a line without = is fatal for postconf; a bad name is fatal for postfix check; unknown names warn', () => {
  assert.equal(parseMainCf('mydomain = a.lab\nmydomain a.lab\n').error, `/etc/postfix/main.cf, line 2: missing '=' after attribute name: "mydomain a.lab"`);
  assert.equal(checkMainCf('mydomain = aula_lab\n').error, 'file /etc/postfix/main.cf: parameter mydomain: bad parameter value: aula_lab');
  assert.deepEqual(parseMainCf('foo = bar\nsmtpd_tls_cert_file = x\n').warnings, ['/etc/postfix/main.cf: unused parameter: foo=bar']);
});

const GOOD = 'dovecot_config_version = 2.4.1\ndovecot_storage_version = 2.4.1\nprotocols = imap\n!include_try conf.d/*.conf\nservice imap-login {\n  inet_listener imap {\n    port = 143\n  }\n}\n';

test('dovecot.conf: protocols, sections and the lines of doveconf -n', () => {
  const c = parseDovecotConf(GOOD);
  assert.equal(c.error, undefined);
  assert.deepEqual(c.protocols, ['imap']);
  assert.deepEqual(c.lines.slice(2), ['protocols = imap', 'service imap-login {', '  inet_listener imap {', '    port = 143', '  }', '}']);
  assert.deepEqual(parseDovecotConf('dovecot_config_version = 2.4.1\nprotocols = none\n').protocols, []);
});

test('dovecot.conf: the errors doveconf gives, with the line', () => {
  const P = 'Error in configuration file /etc/dovecot/dovecot.conf';
  assert.equal(parseDovecotConf('protocols = imap\n').error, `${P} line 1: The first setting must be dovecot_config_version`);
  assert.equal(parseDovecotConf('dovecot_config_version = 2.4.1\nmail_location = maildir:~/Maildir\n').error, `${P} line 2: Unknown setting: mail_location`);
  assert.equal(parseDovecotConf('dovecot_config_version = 2.4.1\nprotocols imap\n').error, `${P} line 2: Expecting '='`);
  assert.equal(parseDovecotConf('dovecot_config_version = 2.4.1\n}\n').error, `${P} line 2: Unexpected '}'`);
  assert.equal(parseDovecotConf('dovecot_config_version = 2.4.1\nservice imap {\n').error, `${P} line 2: Missing '}'`);
  assert.equal(parseDovecotConf('dovecot_config_version = 2.4.1\nprotocols = imap smtp\n').error, `${P}: protocols: Unknown protocol: smtp`);
});

test('hostile files stay cheap: a self-doubling $name and a huge line without a brace', () => {
  const t0 = Date.now();
  assert.ok((postfixValue(parseMainCf('a = $a$a$a$a\n').params, 'a') ?? '').length <= 4096);
  assert.match(parseDovecotConf(`dovecot_config_version = 2.4.1\nservice ${' '.repeat(200000)}x\n`).error ?? '', /Expecting '='/);
  assert.ok(Date.now() - t0 < 1000);
});

test('hostile files stay cheap: long blank runs, $name blow-up and long warnings', () => {
  const t0 = Date.now();
  parseDovecotConf(`dovecot_config_version = 2.4.1\nnamespace${' '.repeat(200_000)}x {\n}\n`);
  assert.ok(Date.now() - t0 < 1000, 'no quadratic regex on a long run of spaces');
  const big = new Map([['a', 'x'.repeat(250_000)], ['myhostname', '$a'.repeat(2048)]]);
  assert.ok((postfixValue(big, 'myhostname') ?? '').length <= 4096, 'expansion bounded within one pass');
  const { warnings } = parseMainCf(`zzz_unknown = ${'y'.repeat(10_000)}\n`);
  assert.ok(warnings.every((w) => w.length < 200), 'the unused-parameter warning is cut');
});
