import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../src/devices/router.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { openConsole, runAll } from '../helpers.ts';

function configured(lines: readonly string[]): { r: Router; out: string[] } {
  const r = new Router();
  const c = openConsole(r, 'config');
  const out = runAll(c, lines);
  return { r, out };
}

test('every pool command is accepted and shown in running-config', () => {
  const { r, out } = configured([
    'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    'ip dhcp excluded-address 192.168.1.254',
    'ip dhcp pool LAN',
    ' network 192.168.1.0 255.255.255.0',
    ' network 192.168.2.0 /24 secondary',
    ' default-router 192.168.1.1 192.168.1.2',
    ' dns-server 8.8.8.8 1.1.1.1',
    ' domain-name lab.local',
    ' netbios-name-server 192.168.1.5',
    ' netbios-node-type h-node',
    ' lease 2 12 30',
    ' option 150 ip 192.168.1.20',
    ' option 66 ascii tftp.lab.local',
    ' option 43 hex 0104.c0a8.0114',
    ' bootfile pxelinux.0',
    ' next-server 192.168.1.20',
    ' address 192.168.1.50 client-id 0100.1122.3344.55',
    ' address 192.168.1.51 hardware-address 0011.2233.4466',
    ' address 192.168.1.52 client-id impresora ascii',
    ' utilization mark high 80 log',
    ' utilization mark low 20',
    ' update arp',
    ' renew deny unknown',
    ' import all',
    ' accounting AAA',
    ' class VOZ',
    '  address range 192.168.1.100 192.168.1.120',
    ' exit',
    'ip dhcp pool PRINTER',
    ' host 192.168.1.20 255.255.255.0',
    ' client-identifier 0100.50.7966.6800',
    ' client-name printer01',
    'ip dhcp pool ROUTER2',
    ' host 192.168.1.30',
    ' hardware-address 0060.5c3a.1b01 ieee802',
    ' exit',
    'no ip dhcp conflict logging',
    'ip dhcp ping packets 0',
    'ip dhcp ping timeout 800',
    'ip dhcp bootp ignore',
    'ip dhcp database tftp://192.168.1.20/dhcp.db timeout 80',
    'ip dhcp relay information option',
    'ip dhcp relay information trust-all',
    'ip dhcp smart-relay',
    'ip dhcp use vrf connected',
  ]);
  assert.deepEqual(out.filter((l) => l.startsWith('%')), []);
  const cfg = r.runningConfig();
  for (const expected of [
    'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
    'ip dhcp excluded-address 192.168.1.254',
    'no ip dhcp conflict logging',
    'ip dhcp ping packets 0',
    'ip dhcp ping timeout 800',
    'ip dhcp pool LAN',
    ' network 192.168.1.0 255.255.255.0',
    ' network 192.168.2.0 255.255.255.0 secondary',
    ' default-router 192.168.1.1 192.168.1.2',
    ' dns-server 8.8.8.8 1.1.1.1',
    ' lease 2 12 30',
    ' option 150 ip 192.168.1.20',
    ' option 66 ascii tftp.lab.local',
    ' option 43 hex 0104.c0a8.0114',
    ' address 192.168.1.50 client-id 0100.1122.3344.55',
    ' address 192.168.1.51 hardware-address 0011.2233.4466',
    ' address 192.168.1.52 client-id impresora ascii',
    ' class VOZ',
    '  address range 192.168.1.100 192.168.1.120',
    ' utilization mark high 80 log',
    'ip dhcp pool PRINTER',
    ' host 192.168.1.20 255.255.255.0',
    ' client-identifier 0100.5079.6668.00',
    ' client-name printer01',
    ' host 192.168.1.30 255.255.255.0',
    ' hardware-address 0060.5c3a.1b01 ieee802',
    'ip dhcp database tftp://192.168.1.20/dhcp.db timeout 80',
  ]) assert.ok(cfg.includes(expected), `missing: ${expected}`);
  const r2 = new Router();
  assert.deepEqual(applyConfig(r2, cfg), []);
  assert.deepEqual(r2.runningConfig(), cfg);
});

test('host and network are mutually exclusive in a pool', () => {
  const { out } = configured(['ip dhcp pool A', 'network 10.0.0.0 255.0.0.0', 'host 10.0.0.5 255.0.0.0']);
  assert.deepEqual(out, ['% This command may not be used with network, origin or vrf pools.']);
  const { out: out2 } = configured(['ip dhcp pool B', 'host 10.0.0.5', 'network 10.0.0.0']);
  assert.deepEqual(out2, ['% This command may not be used with host pools.']);
});

test('reservations must be inside the pool network', () => {
  const { out } = configured(['ip dhcp pool A', 'address 10.0.0.5 client-id 01aa.bbcc.ddee.ff']);
  assert.match(out[0] ?? '', /Network must be configured/);
  const { out: out2 } = configured(['ip dhcp pool A', 'network 10.0.0.0 /24', 'address 10.0.1.5 hardware-address aabb.ccdd.eeff']);
  assert.match(out2[0] ?? '', /is not in the pool's network/);
  const { out: out3 } = configured(['ip dhcp pool A', 'network 10.0.0.0 /24', 'address 10.0.0.5 client-id zz']);
  assert.match(out3[0] ?? '', /Invalid input/);
});

test('network host bits are cleared and classful mask is used when omitted', () => {
  const { r } = configured(['ip dhcp pool A', 'network 172.16.5.9']);
  assert.ok(r.runningConfig().includes(' network 172.16.0.0 255.255.0.0'));
});

test('no forms remove configuration', () => {
  const { r } = configured([
    'ip dhcp excluded-address 10.0.0.1 10.0.0.5', 'ip dhcp pool A', 'network 10.0.0.0 /24', 'default-router 10.0.0.1',
    'address 10.0.0.9 hardware-address aabb.ccdd.eeff', 'lease infinite', 'no default-router', 'no address 10.0.0.9', 'no lease', 'exit',
    'no ip dhcp excluded-address 10.0.0.1 10.0.0.5', 'no service dhcp',
  ]);
  const cfg = r.runningConfig().join('\n');
  assert.doesNotMatch(cfg, /default-router|address 10\.0\.0\.9|lease|excluded/);
  assert.match(cfg, /no service dhcp/);
  const c = openConsole(r, 'config');
  assert.deepEqual(c.run('no ip dhcp pool NOPE'), ['%DHCP pool NOPE does not exist']);
  c.run('no ip dhcp pool A');
  assert.doesNotMatch(r.runningConfig().join('\n'), /ip dhcp pool A/);
});

test('prompts and help inside the pool', () => {
  const r = new Router();
  const c = openConsole(r, 'config');
  c.run('ip dhcp pool LAN');
  assert.equal(c.session.prompt(), 'Router(dhcp-config)#');
  const help = c.session.help('');
  for (const kw of ['network', 'host', 'client-identifier', 'hardware-address', 'address', 'default-router', 'lease', 'option']) {
    assert.ok(help.some((l) => l.trimStart().startsWith(kw)), `help lacks ${kw}`);
  }
  assert.ok(c.session.help('address 10.0.0.1 ').some((l) => l.includes('client-id')));
  assert.ok(c.session.help('address 10.0.0.1 ').some((l) => l.includes('hardware-address')));
  assert.ok(c.session.help('lease ').some((l) => l.includes('<0-365>')));
  assert.ok(c.session.help('network 10.0.0.0 ').some((l) => l.includes('/nn or A.B.C.D')));
  c.run('class X');
  assert.equal(c.session.prompt(), 'Router(config-dhcp-pool-class)#');
  c.run('exit');
  assert.equal(c.session.prompt(), 'Router(dhcp-config)#');
  c.run('ip dhcp pool OTHER');
  assert.equal(c.session.prompt(), 'Router(dhcp-config)#');
  assert.equal(c.session.pool, 'OTHER');
});

test('debug commands toggle flags', () => {
  const r = new Router();
  const c = openConsole(r);
  assert.deepEqual(c.run('debug ip dhcp server events'), ['DHCP server event debugging is on.']);
  c.run('debug ip dhcp server packet');
  assert.deepEqual(c.run('show debugging'), ['DHCP server:', '  DHCP server event debugging is on.', '  DHCP server packet debugging is on.']);
  assert.deepEqual(c.run('undebug all'), ['All possible debugging has been turned off']);
  assert.equal(r.dhcp.debugEvents, false);
});
