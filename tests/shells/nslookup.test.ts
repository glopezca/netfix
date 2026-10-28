/** nslookup: query types, reverse lookups and the interactive mode (`>`), as BIND 9 on Ubuntu and as Windows. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Pc } from '../../src/devices/pc.ts';

function shell(os: 'linux' | 'windows') {
  const ex = EXAMPLES.find((e) => e.id === 'servidores');
  assert.ok(ex);
  return createShell(ex.build().byLabel('PC1') as Pc, os);
}

const text = (lines: readonly string[]): string => lines.join('\n');

test('Linux: -type= asks for other records, an IP is looked up in reverse', () => {
  const sh = shell('linux');
  assert.equal(text(sh.run('nslookup -type=mx aula.lab')), 'Server:\t\t192.168.10.2\nAddress:\t192.168.10.2#53\n\naula.lab\tmail exchanger = 10 srv.aula.lab.\n');
  assert.match(text(sh.run('nslookup -query=ns aula.lab')), /^aula\.lab\tnameserver = srv\.aula\.lab\.$/m);
  assert.match(text(sh.run('nslookup -type=soa aula.lab')), /^aula\.lab\n\torigin = srv\.aula\.lab\n\tmail addr = [^\n]+\n\tserial = \d+\n\trefresh = \d+\n\tretry = \d+\n\texpire = \d+\n\tminimum = \d+$/m);
  assert.match(text(sh.run('nslookup 192.168.10.2')), /^2\.10\.168\.192\.in-addr\.arpa\tname = srv\.aula\.lab\.$/m);
});

test('Linux: a type with no records says so and shows where the authoritative answers are', () => {
  const sh = shell('linux');
  const out = text(sh.run('nslookup -type=txt aula.lab'));
  assert.match(out, /^\*\*\* Can't find aula\.lab: No answer\n\nAuthoritative answers can be found from:\naula\.lab\n\torigin = srv\.aula\.lab$/m);
});

test('Linux: nslookup without arguments is interactive: lookups, set type, server, set all and exit', () => {
  const sh = shell('linux');
  assert.deepEqual(sh.run('nslookup'), []);
  assert.equal(sh.prompt(), '> ');
  assert.match(text(sh.run('srv')), /^Server:\t\t192\.168\.10\.2\nAddress:\t192\.168\.10\.2#53\n\nName:\tsrv\.aula\.lab\nAddress: 192\.168\.10\.2/);
  assert.deepEqual(sh.run('set type=mx'), []);
  assert.match(text(sh.run('aula.lab')), /aula\.lab\tmail exchanger = 10 srv\.aula\.lab\./);
  assert.deepEqual(sh.run('set q=bogus'), ['unknown query type: bogus']);
  assert.deepEqual(sh.run('set colour'), ['*** Invalid option: colour']);
  assert.deepEqual(sh.run('server srv.aula.lab'), ['Default server: srv.aula.lab', 'Address: 192.168.10.2#53']);
  assert.match(text(sh.run('set all')), /^Default server: srv\.aula\.lab\nAddress: 192\.168\.10\.2#53\n\nSet options:\n {2}novc\t\t\tnodebug\t\tnod2\n[\s\S]*querytype = mx {6}\tclass = IN/);
  assert.deepEqual(sh.run('server nada.aula.lab'), ["*** Can't find address for server nada.aula.lab: NXDOMAIN"]);
  assert.equal(sh.prompt(), '> ');
  assert.deepEqual(sh.run('exit'), []);
  assert.notEqual(sh.prompt(), '> ');
});

test('Linux: set debug shows the sections of each answer', () => {
  const sh = shell('linux');
  sh.run('nslookup');
  sh.run('set debug');
  const out = text(sh.run('srv.aula.lab'));
  assert.match(out, /------------\n {4}QUESTIONS:\n\tsrv\.aula\.lab, type = A, class = IN\n {4}ANSWERS:\n {4}->  srv\.aula\.lab\n\tinternet address = 192\.168\.10\.2\n\tttl = \d+\n {4}AUTHORITY RECORDS:\n {4}ADDITIONAL RECORDS:\n------------\nName:\tsrv\.aula\.lab/);
  sh.run('exit');
});

test('Linux: "nslookup - SERVER" is interactive against that server', () => {
  const sh = shell('linux');
  sh.run('nslookup - 192.168.10.2');
  assert.equal(sh.prompt(), '> ');
  assert.match(text(sh.run('www')), /^Server:\t\t192\.168\.10\.2\n/);
  assert.deepEqual(sh.run('help'), ["The 'help' command is not yet implemented."]);
  sh.run('exit');
  sh.run('nslookup - srv.aula.lab');
  assert.match(text(sh.run('www')), /^Server:\t\tsrv\.aula\.lab\n/, 'a server given by name');
  sh.run('exit');
  assert.deepEqual(sh.run('nslookup -timeout=5 -norecurse srv >/dev/null; echo $?'), ['0'], 'options it does not need are accepted');
  assert.deepEqual(sh.run('nslookup -type=txt aula.lab >/dev/null; echo $?'), ['1']);
});

test('Windows: the server is named from its PTR record and other types use the Windows layout', () => {
  const win = shell('windows');
  assert.equal(text(win.run('nslookup srv.aula.lab')), 'Server:  srv.aula.lab\nAddress:  192.168.10.2\n\nName:    srv.aula.lab\nAddress:  192.168.10.2\n');
  assert.match(text(win.run('nslookup -type=mx aula.lab')), /^aula\.lab\tMX preference = 10, mail exchanger = srv\.aula\.lab$/m);
  assert.match(text(win.run('nslookup -q=soa aula.lab')), /^aula\.lab\n {8}primary name server = srv\.aula\.lab\n {8}responsible mail addr = [^\n]+\n {8}serial {2}= \d+\n {8}refresh = \d+ \([^)]+\)/m);
  assert.match(text(win.run('nslookup 192.168.10.2')), /Name: {4}srv\.aula\.lab\nAddress: {2}192\.168\.10\.2/);
});

test('Windows: interactive nslookup prints the default server, keeps the > prompt and leaves with exit', () => {
  const win = shell('windows');
  assert.deepEqual(win.run('nslookup'), ['Default Server:  srv.aula.lab', 'Address:  192.168.10.2', '']);
  assert.equal(win.prompt(), '> ');
  assert.match(text(win.run('www')), /^Server:  srv\.aula\.lab\nAddress:  192\.168\.10\.2\n\nName:    srv\.aula\.lab\nAddress:  192\.168\.10\.2\nAliases:  www\.aula\.lab/);
  assert.deepEqual(win.run('set type=ns'), []);
  assert.match(text(win.run('aula.lab')), /^aula\.lab\tnameserver = srv\.aula\.lab$/m);
  assert.deepEqual(win.run('set colour'), ['*** Invalid option: colour']);
  assert.deepEqual(win.run('server 192.168.10.2'), ['Default Server:  srv.aula.lab', 'Address:  192.168.10.2', '']);
  assert.deepEqual(win.run('set debug'), []);
  assert.deepEqual(win.run('set querytype=A'), []);
  assert.match(text(win.run('srv')), /------------\nGot answer:\n {4}HEADER:\n {8}opcode = QUERY, id = \d+, rcode = NOERROR\n {8}header flags: {2}response, auth\. answer, want recursion[^\n]*\.\n {8}questions = 1, {2}answers = 1[\s\S]* {4}->  srv\.aula\.lab\n {8}internet address = 192\.168\.10\.2\n {8}ttl = \d+ \(/);
  assert.match(text(win.run('help')), /^Commands: {3}\(identifiers are shown in uppercase/);
  assert.deepEqual(win.run('exit'), []);
  assert.notEqual(win.prompt(), '> ');
});

test('Windows: Ctrl+C leaves interactive nslookup', () => {
  const win = shell('windows');
  win.run('nslookup');
  win.interrupt();
  assert.notEqual(win.prompt(), '> ');
});
