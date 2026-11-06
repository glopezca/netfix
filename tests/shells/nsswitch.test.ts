/**
 * /etc/nsswitch.conf (v0.36): the «hosts:» line with its [STATUS=action] items as glibc reads them, and the maintainer
 * scripts of libnss-resolve (resolve [!UNAVAIL=return] before dns) and libnss-mdns (mdns4_minimal before resolve or dns).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { nssNext, parseHostsLine, withMdns, withResolve } from '../../src/shells/nsswitch.ts';
import type { Host } from '../../src/devices/host.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));
const hosts = (line: string): string => `passwd: files\nhosts:          ${line}\nnetworks: files\n`;
const hostsOf = (text: string): string => /^hosts:[ \t]*(.*)$/m.exec(text)?.[1] ?? '';

test('the hosts line: sources in order, files left out, each with its actions', () => {
  const s = parseHostsLine('files mdns4_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] dns wins');
  assert.deepEqual(s.map((x) => x.source), ['mdns4_minimal', 'resolve', 'dns', 'wins']);
  assert.deepEqual(s[0]?.actions, [{ status: 'NOTFOUND', negate: false, action: 'return' }]);
  assert.deepEqual(s[1]?.actions, [{ status: 'UNAVAIL', negate: true, action: 'return' }]);
  assert.equal(s[0]?.notFoundReturn, true);
  assert.equal(s[1]?.notFoundReturn, true, '[!UNAVAIL=return] also returns on NOTFOUND');
  assert.equal(s[2]?.notFoundReturn, false);
});

test('glibc spelling: case, spaces inside the brackets, several items, bad items ignored', () => {
  const [a] = parseHostsLine('dns [ notfound = RETURN  tryagain=continue ]');
  assert.deepEqual(a?.actions, [{ status: 'NOTFOUND', negate: false, action: 'return' }, { status: 'TRYAGAIN', negate: false, action: 'continue' }]);
  const [b] = parseHostsLine('dns [BOGUS=return SUCCESS=jump]');
  assert.deepEqual(b?.actions, []);
  assert.deepEqual(parseHostsLine('').map((x) => x.source), []);
});

test('the next step: SUCCESS returns and the rest continue unless an item says otherwise', () => {
  const [plainDns] = parseHostsLine('dns');
  assert.equal(nssNext(plainDns!.actions, 'SUCCESS'), 'return');
  assert.equal(nssNext(plainDns!.actions, 'NOTFOUND'), 'continue');
  assert.equal(nssNext(plainDns!.actions, 'UNAVAIL'), 'continue');
  const [resolve] = parseHostsLine('resolve [!UNAVAIL=return]');
  assert.equal(nssNext(resolve!.actions, 'NOTFOUND'), 'return', 'resolved said no: dns is not asked');
  assert.equal(nssNext(resolve!.actions, 'TRYAGAIN'), 'return');
  assert.equal(nssNext(resolve!.actions, 'UNAVAIL'), 'continue', 'resolved is not running: on to dns');
  const [cont] = parseHostsLine('dns [SUCCESS=continue]');
  assert.equal(nssNext(cont!.actions, 'SUCCESS'), 'continue');
});

test('a huge hosts line is cut, not walked to the end', () => {
  const s = parseHostsLine(`${'dns '.repeat(10_000)}wins`);
  assert.ok(s.length <= 32, `${s.length} sources`);
});

test('withResolve: before dns, after mdns4_minimal, once; out again on remove', () => {
  assert.equal(hostsOf(withResolve(hosts('files dns'), true)), 'files resolve [!UNAVAIL=return] dns');
  const both = withResolve(hosts('files mdns4_minimal [NOTFOUND=return] dns'), true);
  assert.equal(hostsOf(both), 'files mdns4_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] dns');
  assert.equal(withResolve(both, true), both, 'installed again: the line does not change');
  assert.equal(hostsOf(withResolve(hosts('files'), true)), 'files resolve [!UNAVAIL=return]', 'no dns: at the end');
  assert.equal(hostsOf(withResolve(both, false)), 'files mdns4_minimal [NOTFOUND=return] dns');
  assert.match(withResolve(hosts('files dns'), true), /^passwd: files\n[\s\S]*networks: files\n$/, 'the other lines stay');
});

test('withMdns goes before resolve when it is there', () => {
  assert.equal(hostsOf(withMdns(hosts('files resolve [!UNAVAIL=return] dns'), true)), 'files mdns4_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] dns');
  assert.equal(hostsOf(withMdns(hosts('files mdns4_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] dns'), false)), 'files resolve [!UNAVAIL=return] dns');
});

test('apt install libnss-resolve edits nsswitch.conf; apt remove puts it back; a hand-edited line keeps the rest', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  assert.match(run(pc, 'apt install -y libnss-resolve'), /Setting up libnss-resolve \(258\.1-1ubuntu1\) \.\.\./);
  assert.match(run(pc, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files resolve \[!UNAVAIL=return\] dns$/);
  run(pc, 'apt remove -y libnss-resolve');
  assert.match(run(pc, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files dns$/);
  run(pc, 'sed -i "s/^hosts:.*/hosts:          files dns wins/" /etc/nsswitch.conf; apt install -y libnss-resolve');
  assert.match(run(pc, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files resolve \[!UNAVAIL=return\] dns wins$/);
});

test('libnss-resolve and avahi-daemon together: the order Ubuntu writes', () => {
  const pc = lab('internet').byLabel('PC1') as Host;
  run(pc, 'apt install -y libnss-resolve avahi-daemon');
  assert.match(run(pc, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: +files mdns4_minimal \[NOTFOUND=return\] resolve \[!UNAVAIL=return\] dns$/);
});

test('ping follows the actions: [NOTFOUND=return] after dns keeps wins from being asked; resolve without the module is skipped', () => {
  const pc1 = lab('internet').byLabel('PC1') as Host;
  run(pc1, 'apt install -y winbind libnss-winbind');
  run(pc1, 'sed -i "s/^hosts:.*/hosts:          files dns [NOTFOUND=return] wins/" /etc/nsswitch.conf');
  assert.match(run(pc1, 'ping -c 1 pc0; echo "status $?"'), /status 2$/, 'the DNS said NXDOMAIN: the lookup ends there');
  run(pc1, "sed -i 's/^hosts:.*/hosts:          files resolve [!UNAVAIL=return] dns wins/' /etc/nsswitch.conf");
  assert.match(run(pc1, 'ping -c 1 pc0'), /1 received/, 'no libnss-resolve: UNAVAIL, on to dns and wins');
});
