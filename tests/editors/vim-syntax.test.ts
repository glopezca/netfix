/**
 * Syntax highlighting of configuration files as vim shows them (filetype detection and its highlight groups), for
 * the «Configuración» view of GNU/Linux servers and routers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filetypeOf, highlight, SYNMAXCOL } from '../../src/editors/vim-syntax.ts';
import type { SynSpan } from '../../src/editors/vim-syntax.ts';

/** The text of each group in a line, e.g. ['Statement:PermitRootLogin', 'Constant:no']. */
const groups = (line: readonly SynSpan[]): string[] => line.filter((s) => s.group).map((s) => `${s.group}:${s.text}`);

test('the filetype comes from the path, as vim detects it', () => {
  assert.deepEqual([
    '/etc/ssh/sshd_config', '/etc/ssh/sshd_config.d/10-bastionado.conf', '/etc/kea/kea-dhcp4.conf', '/etc/bind/named.conf.options',
    '/etc/bind/db.aula.lab', '/etc/apache2/sites-enabled/000-default.conf', '/etc/postfix/main.cf', '/etc/dovecot/dovecot.conf',
    '/etc/sysctl.d/99-netfix.conf', '/etc/nftables.conf', '/etc/wireguard/wg0.conf', '/etc/hosts.txt',
  ].map(filetypeOf), ['sshdconfig', 'sshdconfig', 'json', 'named', 'bindzone', 'apache', 'pfmain', 'dovecot', 'sysctl', 'nftables', 'dosini', 'conf']);
});

test('lines keep every character: the spans of a line join into it', () => {
  const text = 'zone "aula.lab" {\n  type master; // primary\n};\n\n# end';
  const lines = highlight(text, 'named');
  assert.deepEqual(lines.map((l) => l.map((s) => s.text).join('')), text.split('\n'));
});

test('sshd_config: keywords, yes/no and numbers; comments to the end of the line', () => {
  const [a, b, c] = highlight('PermitRootLogin no\nMaxAuthTries 3\n# Bastionado del laboratorio', 'sshdconfig');
  assert.deepEqual(groups(a!), ['Statement:PermitRootLogin', 'Constant:no']);
  assert.deepEqual(groups(b!), ['Statement:MaxAuthTries', 'Number:3']);
  assert.deepEqual(groups(c!), ['Comment:# Bastionado del laboratorio']);
});

test('named.conf: statements, strings, addresses and block comments over several lines', () => {
  const lines = highlight('options {\n  forwarders { 8.8.8.8; };\n  /* two\n  lines */ recursion yes;\n};', 'named');
  assert.deepEqual(groups(lines[0]!), ['Statement:options']);
  assert.deepEqual(groups(lines[1]!), ['Statement:forwarders', 'Number:8.8.8.8']);
  assert.deepEqual(groups(lines[2]!), ['Comment:/* two']);
  assert.deepEqual(groups(lines[3]!), ['Comment:  lines */', 'Statement:recursion', 'Constant:yes']);
});

test('zone files: directives, record types, names and comments with ;', () => {
  const [a, b] = highlight('$TTL 86400\nsrv  IN  A  192.168.10.2 ; servidor', 'bindzone');
  assert.deepEqual(groups(a!), ['PreProc:$TTL', 'Number:86400']);
  assert.deepEqual(groups(b!), ['Statement:IN', 'Type:A', 'Number:192.168.10.2', 'Comment:; servidor']);
});

test('nftables, apache, postfix and JSON use their own groups', () => {
  assert.deepEqual(groups(highlight('    tcp dport 22 accept comment "SSH"', 'nftables')[0]!), ['Statement:tcp', 'Statement:dport', 'Number:22', 'Statement:accept', 'Statement:comment', 'String:"SSH"']);
  assert.deepEqual(groups(highlight('<VirtualHost *:80>\n  DocumentRoot /var/www/html', 'apache')[0]!), ['Type:<VirtualHost', 'Type:>']);
  assert.deepEqual(groups(highlight('  DocumentRoot ${APACHE_DIR}', 'apache')[0]!), ['Identifier:DocumentRoot', 'Special:${APACHE_DIR}']);
  assert.deepEqual(groups(highlight('myhostname = mail.$mydomain', 'pfmain')[0]!), ['Statement:myhostname', 'Identifier:$mydomain']);
  assert.deepEqual(groups(highlight('  "valid-lifetime": 4000, "authoritative": true', 'json')[0]!), ['Statement:"valid-lifetime"', 'Number:4000', 'Statement:"authoritative"', 'Constant:true']);
  assert.deepEqual(groups(highlight('[Interface]\nListenPort = 51820', 'dosini')[1]!), ['Identifier:ListenPort', 'Number:51820']);
});

test('a huge one-line file is highlighted in linear time (no slicing per token)', () => {
  const big = 'a 1 '.repeat(64_000);
  const start = performance.now();
  const [lineSpans] = highlight(big, 'conf');
  assert.equal(lineSpans!.map((s) => s.text).join(''), big);
  assert.ok(performance.now() - start < 1000, `${Math.round(performance.now() - start)} ms`);
});

test('hostile lines do not backtrack: long names, words and dotted labels stay fast; past SYNMAXCOL the text is plain', () => {
  const cases: [string, Parameters<typeof highlight>[1]][] = [
    ['a'.repeat(200_000), 'dovecot'], ['a.'.repeat(100_000), 'bindzone'], [`${'a'.repeat(100_000)} {`, 'dovecot'], ['1.'.repeat(100_000), 'named'], ['a: '.repeat(70_000), 'messages'], [`Oct 23 22:32:26 ${'h'.repeat(100_000)}`, 'messages'],
  ];
  for (const [text, ft] of cases) {
    const start = performance.now();
    const [spans] = highlight(text, ft);
    assert.equal(spans!.map((s) => s.text).join(''), text);
    assert.ok(performance.now() - start < 300, `${ft}: ${Math.round(performance.now() - start)} ms`);
  }
  const [long] = highlight(`${'x '.repeat(SYNMAXCOL)}# not a comment any more`, 'conf');
  assert.equal(long!.some((s) => s.group === 'Comment'), false);
});

test('a hostname starting with a record type is a name, not a type', () => {
  const [l] = highlight('@  IN  NS  NS.aula.lab.', 'bindzone');
  assert.deepEqual(groups(l!), ['Special:@', 'Statement:IN', 'Type:NS', 'Identifier:NS.aula.lab.']);
});

test('logs (vim «messages», as journalctl and syslog): date, time, host, program, PID, addresses and errors', () => {
  assert.equal(filetypeOf('/var/log/syslog'), 'messages');
  const [a, b, c] = highlight([
    'Oct 23 22:32:26 srv kea-dhcp4[812]: DHCP4_LEASE_ALLOC lease 192.168.10.100 has been allocated for 86400 seconds',
    'Oct 23 22:40:01 srv sshd[701]: error: maximum authentication attempts exceeded for admin from 192.168.20.10',
    '22:40:01 ssh: Accepted password for admin',
  ].join('\n'), 'messages');
  assert.deepEqual(groups(a!), ['Constant:Oct 23', 'Type:22:32:26', 'Identifier:srv', 'Statement:kea-dhcp4', 'Constant:[812]', 'Constant:192.168.10.100']);
  assert.deepEqual(groups(b!), ['Constant:Oct 23', 'Type:22:40:01', 'Identifier:srv', 'Statement:sshd', 'Constant:[701]',
    'Error:error: maximum authentication attempts exceeded for admin from 192.168.20.10']);
  assert.deepEqual(groups(c!), ['Type:22:40:01', 'Statement:ssh'], 'the web GUI format: time and unit');
});

test('shell scripts: detected by name, with sh.vim groups (keywords, $variables, strings, test operators, comments)', () => {
  assert.deepEqual(['/home/alumno/tipo.sh', '/root/.bashrc', '/etc/profile', '/home/ana/.profile', '/usr/local/bin/x.bash'].map(filetypeOf), ['sh', 'sh', 'sh', 'sh', 'sh']);
  const [a, b, c, d] = highlight('#!/bin/bash\nif (( $# == 0 )); then exit 1; fi\nfor r in "$@"; do [[ -d $r ]] && echo \'dir\'; done\nx=${HOME}/a  # fin', 'sh');
  assert.deepEqual(groups(a!), ['Comment:#!/bin/bash']);
  assert.deepEqual(groups(b!), ['Statement:if', 'PreProc:$#', 'Number:0', 'Statement:then', 'Statement:exit', 'Number:1', 'Statement:fi']);
  assert.deepEqual(groups(c!), ['Statement:for', 'Statement:in', 'String:"$@"', 'Statement:do', 'Statement:-d', 'PreProc:$r', 'Statement:echo', "String:'dir'", 'Statement:done']);
  assert.deepEqual(groups(d!), ['PreProc:${HOME}', 'Comment:# fin']);
});

test('shell scripts: no false positives (options, words with hyphens, # inside a word, profile elsewhere)', () => {
  assert.deepEqual(groups(highlight('ls -la a-b x-y /usr/bin/test my-test foo#bar', 'sh')[0]!), []);
  assert.deepEqual(groups(highlight('[ -n "$v" ] && test -eq', 'sh')[0]!), ['Statement:-n', 'String:"$v"', 'Statement:test', 'Statement:-eq']);
  assert.deepEqual(['/home/x/profile', '/etc/profile', '/home/ana/.bash_aliases'].map(filetypeOf), ['conf', 'sh', 'sh']);
});
