/**
 * getent (glibc): the hosts, ahosts, passwd and group databases through /etc/nsswitch.conf, as a program sees them.
 * It shows what resolvectl does not: ping only gets LLMNR through libnss-resolve, and `wins` behind
 * `resolve [!UNAVAIL=return]` is reached only while resolved is stopped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { formatIp } from '../../src/core/ip.ts';
import type { Host } from '../../src/devices/host.ts';
import { setPackageInstalled } from '../../src/net/host-packages.ts';

const run = (h: Host, cmd: string, user?: string): string => createShell(h, 'linux', user).run(cmd).join('\n');
const conf = (h: Host, body: string): string => run(h, `printf '[Resolve]\\n${body}\\n' > /etc/systemd/resolved.conf; systemctl restart systemd-resolved`, 'root');
const hostsLine = (h: Host, line: string): string => run(h, `sed -i 's/^hosts:.*/hosts:          ${line}/' /etc/nsswitch.conf`, 'root');

function lab(): { pc0: Host; pc1: Host; pc2: Host } {
  const t = EXAMPLES.find((e) => e.id === 'basico')!.build();
  const [pc0, pc1, pc2] = ['PC0', 'PC1', 'PC2'].map((l) => t.byLabel(l) as Host) as [Host, Host, Host];
  pc2.os = 'linux';
  return { pc0, pc1, pc2 };
}

test('getent hosts: files, the address as key, enumeration and exit statuses', () => {
  const { pc1 } = lab();
  assert.equal(run(pc1, 'getent hosts localhost; echo $?'), '127.0.0.1       localhost\n0');
  assert.equal(run(pc1, 'getent hosts pc1'), '127.0.1.1       pc1', 'its /etc/hosts line');
  assert.equal(run(pc1, 'getent hosts 127.0.1.1'), '127.0.1.1       pc1', 'an address: the reverse lookup');
  assert.equal(run(pc1, 'getent hosts'), '127.0.0.1       localhost\n127.0.1.1       pc1');
  assert.equal(run(pc1, 'getent hosts nadie.aula.lab; echo $?'), '2', 'not found: nothing and 2');
  assert.equal(run(pc1, 'getent hosts nadie localhost; echo $?'), '127.0.0.1       localhost\n2', 'one key missing: 2');
  run(pc1, "printf '10.0.0.5 web.aula.lab web\\n' >> /etc/hosts", 'root');
  assert.equal(run(pc1, 'getent hosts web'), '10.0.0.5        web.aula.lab web', 'canonical name, then the aliases');
});

test('getent ahosts: STREAM, DGRAM and RAW, the canonical name on the first line', () => {
  const { pc1 } = lab();
  assert.equal(run(pc1, 'getent ahosts localhost'), '127.0.0.1       STREAM localhost\n127.0.0.1       DGRAM  \n127.0.0.1       RAW    ');
  assert.equal(run(pc1, 'getent ahostsv4 10.1.2.3'), '10.1.2.3        STREAM 10.1.2.3\n10.1.2.3        DGRAM  \n10.1.2.3        RAW    ');
  assert.match(run(pc1, 'getent ahostsv6 localhost'), /^::ffff:127\.0\.0\.1 STREAM localhost$/m, 'IPv4 mapped (no IPv6 in Netfix)');
});

test('getent errors, as glibc words them', () => {
  const { pc1 } = lab();
  const tryHelp = "Try `getent --help' or `getent --usage' for more information.";
  assert.equal(run(pc1, 'getent foo x 2>&1; echo $?'), `Unknown database: foo\n${tryHelp}\n1`);
  assert.equal(run(pc1, 'getent 2>&1; echo $?'), `getent: wrong number of arguments\n${tryHelp}\n1`);
  assert.match(run(pc1, 'getent --help'), /^Usage: getent \[OPTION\.\.\.\] database \[key \.\.\.\]$/m);
  assert.match(run(pc1, 'getent shadow root 2>&1; echo $?'), /Netfix[^\n]*shadow[^\n]*\n1$/);
});

test('getent passwd and group: by name, by number, or the whole file', () => {
  const { pc1 } = lab();
  assert.equal(run(pc1, 'getent passwd root'), 'root:x:0:0:root:/root:/bin/bash');
  assert.equal(run(pc1, 'getent passwd 0'), 'root:x:0:0:root:/root:/bin/bash');
  assert.equal(run(pc1, 'getent group 0'), run(pc1, 'getent group root'));
  assert.equal(run(pc1, 'getent passwd nadie; echo $?'), '2');
  assert.equal(run(pc1, 'getent passwd'), run(pc1, 'cat /etc/passwd'));
});

test('LLMNR reaches programs only through libnss-resolve (resolvectl works without it)', () => {
  const { pc1, pc2 } = lab();
  conf(pc1, 'LLMNR=yes');
  conf(pc2, 'LLMNR=yes');
  assert.match(run(pc1, 'resolvectl query pc2'), /protocol LLMNR\/IPv4/);
  assert.equal(run(pc1, 'getent hosts pc2; echo $?'), '2', 'files dns: no LLMNR');
  setPackageInstalled(pc1, 'libnss-resolve', true);
  hostsLine(pc1, 'files resolve [!UNAVAIL=return] dns');
  assert.equal(run(pc1, 'getent hosts pc2'), `${formatIp(pc2.config.ip ?? 0).padEnd(15)} pc2`);
  assert.match(run(pc1, 'getent ahosts pc2'), new RegExp(`^${formatIp(pc2.config.ip ?? 0).replace(/\./g, '\\.')} +STREAM pc2$`, 'm'));
});

test('wins behind resolve [!UNAVAIL=return]: not reached while resolved runs, reached when it stops', () => {
  const { pc0, pc1 } = lab();
  for (const p of ['libnss-resolve', 'winbind', 'libnss-winbind']) setPackageInstalled(pc1, p, true);
  hostsLine(pc1, 'files resolve [!UNAVAIL=return] wins dns');
  assert.equal(run(pc1, 'getent hosts pc0; echo $?'), '2', 'resolve says NOTFOUND (no LLMNR): return');
  run(pc1, 'systemctl stop systemd-resolved', 'root');
  assert.equal(run(pc1, 'getent hosts pc0'), `${formatIp(pc0.config.ip ?? 0).padEnd(15)} pc0`, 'UNAVAIL: on to wins (NetBIOS)');
});
