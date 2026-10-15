/** Search domain from DHCP (option 15): short names resolve as in Ubuntu (glibc, ndots:1) and Windows (DNS suffix). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { resolutionCandidates } from '../../src/shells/net-tools.ts';
import type { Pc } from '../../src/devices/pc.ts';

const plain = (t: string): string => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function lab(): Pc {
  const ex = EXAMPLES.find((e) => e.id === 'dns-reenvio');
  assert.ok(ex);
  return ex.build().byLabel('PC0') as Pc;
}

test('candidates follow ndots:1: a name without dots tries the search domain first; a final dot means as typed', () => {
  assert.deepEqual(resolutionCandidates('www', ['empresa.lan']), ['www.empresa.lan', 'www']);
  assert.deepEqual(resolutionCandidates('www.google.com', ['empresa.lan']), ['www.google.com', 'www.google.com.empresa.lan']);
  assert.deepEqual(resolutionCandidates('www.', ['empresa.lan']), ['www']);
  assert.deepEqual(resolutionCandidates('www', []), ['www']);
});

test('the PC learns empresa.lan from DHCP: resolv.conf shows it and ping, nslookup and host complete the name', () => {
  const sh = createShell(lab(), 'linux');
  assert.match(sh.run('cat /etc/resolv.conf').join('\n'), /^search empresa\.lan$/m);
  assert.match(sh.run('ping -c 1 www').join('\n'), /^PING www\.empresa\.lan \(192\.168\.50\.\d+\)/);
  assert.match(sh.run('nslookup www').join('\n'), /www\.empresa\.lan\tcanonical name = intranet\.empresa\.lan\.\nName:\tintranet\.empresa\.lan\nAddress: 192\.168\.50\.2/);
  assert.match(sh.run('host ns1').join('\n'), /^ns1\.empresa\.lan has address 192\.168\.50\.2$/m);
  assert.match(sh.run('nslookup www.nada.lan').join('\n'), /can't find www\.nada\.lan: NXDOMAIN/, 'the name as typed in the error');
});

test('dig does not use the search list unless +search, as the real dig', () => {
  const sh = createShell(lab(), 'linux');
  assert.match(sh.run('dig www').join('\n'), /status: NXDOMAIN/);
  assert.match(sh.run('dig +search www').join('\n'), /^;www\.empresa\.lan\.\s+IN\s+A$[\s\S]*^intranet\.empresa\.lan\.\s+\d+\s+IN\s+A\s+192\.168\.50\.2$/m);
});

test('Windows uses the connection-specific DNS suffix in ping and nslookup', () => {
  const win = createShell(lab(), 'windows');
  assert.match(win.run('ping -n 1 www').join('\n'), /Pinging www\.empresa\.lan \[192\.168\.50\.\d+\] with 32 bytes of data:/);
  assert.match(win.run('nslookup www').join('\n'), /Name: {4}intranet\.empresa\.lan\nAddress: {2}192\.168\.50\.2\nAliases: {2}www\.empresa\.lan/);
});

test('hostname -f is the canonical name in /etc/hosts (Ubuntu does not add the DHCP domain there)', () => {
  const sh = createShell(lab(), 'linux');
  assert.deepEqual(sh.run('hostname -f').map(plain), ['pc0']);
  assert.match(sh.run('cat /etc/hosts').join('\n'), /^127\.0\.1\.1 pc0$/m, 'no .localdomain anywhere');
});

test('no search without a DHCP domain (static IP, released lease), for addresses or reverse names', async () => {
  const { Topology } = await import('../../src/net/topology.ts');
  const { dnsSearch, searchDomains } = await import('../../src/shells/net-tools.ts');
  const pc = lab();
  assert.deepEqual(searchDomains(pc), ['empresa.lan']);
  const sh = createShell(pc, 'linux');
  sh.run('sudo dhclient -r');
  assert.deepEqual(searchDomains(pc), []);
  assert.doesNotMatch(sh.run('cat /etc/resolv.conf').join('\n'), /search/);
  const fresh = new Topology().add('pc', 0, 0).device as Pc;
  fresh.setStatic({ ip: 0x0a000002, prefix: 24, dns: 0x0a000001 });
  assert.deepEqual(searchDomains(fresh), []);
  assert.equal(dnsSearch(lab(), '192.168.50.2', 'A').name, '192.168.50.2', 'an address is not searched');
});
