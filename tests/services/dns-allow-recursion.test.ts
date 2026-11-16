/**
 * allow-recursion on a Linux router (WAN eth0 to the ISP, LAN eth1): LAN clients get recursion with a network list
 * and with localnets, as on Ubuntu, where localnets is the network of every interface, not only the first one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';

const FIXTURE = new URL('../fixtures/dns-allow-recursion.json', import.meta.url);
const OPTIONS = '/etc/bind/named.conf.options';

function lab(): { t: Topology; router: Server; foca: Pc } {
  const t = Topology.fromJSON(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  t.settle(5000);
  const dev = (label: string): unknown => [...t.placed.values()].find((p) => p.label === label)?.device;
  return { t, router: dev('pingüino00') as Server, foca: dev('foca00') as Pc };
}

/** Replaces allow-recursion in the generated file, as root would, and restarts named. */
function allow(router: Server, list: string, extra = ''): void {
  const fs = hostSystem(router).fs;
  const text = String(fs.readFile(OPTIONS));
  fs.writeFile(OPTIONS, extra + text.replace(/allow-recursion \{[^}]*\};/, `allow-recursion { ${list} };`));
  createShell(router, 'linux', 'root').run('systemctl restart named');
}

const dig = (pc: Pc, name: string): string => createShell(pc, 'linux').run(`dig @192.168.0.254 ${name}`).join('\n');

for (const list of ['192.168.0.0/24; localhost;', 'localnets; localhost;']) {
  test(`a LAN client resolves public names with allow-recursion { ${list} }`, () => {
    const { router, foca } = lab();
    allow(router, list);
    assert.ok(router.services.dns.allowRecursion?.length, 'named read the list');
    const out = dig(foca, 'www.google.com');
    assert.match(out, /status: NOERROR/, out);
    assert.match(out, /flags: qr rd ra;/);
    assert.match(dig(foca, 'foca00.artico.es'), /flags: qr aa rd ra;/, 'the zone stays authoritative');
  });
}

test('a list that leaves the LAN out refuses it; a negated host and an acl work as in BIND', () => {
  const { router, foca } = lab();
  allow(router, 'localhost;');
  assert.match(dig(foca, 'www.google.com'), /status: REFUSED/);
  assert.match(dig(foca, 'foca00.artico.es'), /flags: qr aa rd;/, 'authoritative answers do not need recursion');
  allow(router, '!192.168.0.16; lan;', 'acl lan { 192.168.0.0/24; localhost; };\n');
  assert.deepEqual(router.services.dns.allowRecursion, ['!192.168.0.16', '192.168.0.0/24', 'localhost']);
  assert.match(dig(foca, 'www.google.com'), /status: REFUSED/, 'foca00 (192.168.0.16) is excluded');
});

test('the list edited in the host view is written to the file and survives save and open', () => {
  const { t, router } = lab();
  assert.deepEqual(router.services.dns.allowRecursion, ['any'], 'a lab saved before 0.51 ("any") still opens');
  allow(router, '192.168.0.0/24; localhost;');
  assert.match(String(hostSystem(router).fs.readFile(OPTIONS)), /allow-recursion \{ 192\.168\.0\.0\/24; localhost; \};/);
  const copy = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const again = [...copy.placed.values()].find((p) => p.label === 'pingüino00')?.device as Server;
  assert.deepEqual(again.services.dns.allowRecursion, ['192.168.0.0/24', 'localhost']);
});
