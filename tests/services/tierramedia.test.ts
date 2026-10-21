/**
 * Tierra Media scenarios of the ASIR2-SRI textbook (Annex XXII), reproduced in Netfix:
 * UT2 practice 1 (Arnor, Server DHCP with MAC reservations outside the dynamic range),
 * UT2 practice 2 (Mordor, IOS pool + `show running-config | section dhcp`) and UT3 (Lothlorien DNS).
 */
import { zonesFromLegacy } from '../../src/services/dns-zones.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Server } from '../../src/devices/server.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Router } from '../../src/devices/router.ts';
import { Switch } from '../../src/devices/switch.ts';
import { applyConfig, Session } from '../../src/ios/session.ts';
import { pcCommand } from '../../src/devices/pc-console.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { formatMacCisco } from '../../src/core/mac.ts';
import type { DnsRecord } from '../../src/services/config.ts';

const ip = (s: string): number => parseIp(s)!;

interface TierraMedia {
  t: Topology;
  mordor: Router;
  arnor: Server;
  lothlorien: Server;
  gondor: Pc;
  rohan: Pc;
  pc: Pc;
}

/** Mordor joins 192.168.10.0/24 (Arnor, Gondor, Rohan, PC) and 192.168.20.0/24 (Lothlorien). */
function tierraMedia(): TierraMedia {
  const t = new Topology();
  const mordor = t.add('router', 0, 0).device as Router;
  const s1 = t.add('switch', 0, 0).device as Switch;
  const s2 = t.add('switch', 0, 0).device as Switch;
  const arnor = t.add('server', 0, 0).device as Server;
  const lothlorien = t.add('server', 0, 0).device as Server;
  const [gondor, rohan, pc] = [0, 1, 2].map(() => t.add('pc', 0, 0).device as Pc) as [Pc, Pc, Pc];
  t.connect({ device: mordor.id, port: 'GigabitEthernet0/0' }, { device: s1.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: mordor.id, port: 'GigabitEthernet0/1' }, { device: s2.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: arnor.id, port: 'FastEthernet0' }, { device: s1.id, port: 'FastEthernet0/24' });
  t.connect({ device: lothlorien.id, port: 'FastEthernet0' }, { device: s2.id, port: 'FastEthernet0/24' });
  [gondor, rohan, pc].forEach((h, i) => t.connect({ device: h.id, port: 'FastEthernet0' }, { device: s1.id, port: `FastEthernet0/${i + 1}` }));
  assert.deepEqual(applyConfig(mordor, `hostname Mordor
interface GigabitEthernet0/0
 ip address 192.168.10.254 255.255.255.0
 no shutdown
interface GigabitEthernet0/1
 ip address 192.168.20.254 255.255.255.0
 no shutdown`.split('\n')), []);
  arnor.setStatic({ ip: ip('192.168.10.192'), prefix: 24, gateway: ip('192.168.10.254'), dns: ip('192.168.20.192') });
  lothlorien.setStatic({ ip: ip('192.168.20.192'), prefix: 24, gateway: ip('192.168.20.254'), dns: ip('192.168.20.192') });
  return { t, mordor, arnor, lothlorien, gondor, rohan, pc };
}

const A = (name: string, value: string): DnsRecord => ({ name, type: 'A', value, ttl: 86400 });

function configureLothlorien(lothlorien: Server): void {
  lothlorien.setServices({ ...lothlorien.services, dns: { enabled: true, zones: zonesFromLegacy(undefined, [
    A('mordor.tierramedia.jc', '192.168.10.254'), A('hobbiton.tierramedia.jc', '10.0.32.64'),
    A('gondor.tierramedia.jc', '192.168.10.64'), A('rohan.tierramedia.jc', '192.168.10.65'),
    A('lothlorien.tierramedia.jc', '192.168.20.192'), A('rivendel.tierramedia.jc', '192.168.20.193'),
    { name: 'dns.tierramedia.jc', type: 'CNAME', value: 'lothlorien.tierramedia.jc', ttl: 86400 },
  ]) } });
}

test('UT2 practice 1: Arnor (Server) pool .1–.32 and MAC reservations .64/.65 outside the range', () => {
  const tm = tierraMedia();
  tm.arnor.setServices({ ...tm.arnor.services, dhcp: { enabled: true, pools: [{
    name: 'TIERRAMEDIA-LAN', start: ip('192.168.10.1'), prefix: 24, maxUsers: 32, gateway: ip('192.168.10.254'),
    dns: ip('192.168.20.192'), domain: 'tierramedia.jc', leaseMinutes: 1440,
    reservations: [{ ip: ip('192.168.10.64'), mac: tm.gondor.mac, name: 'Gondor' }, { ip: ip('192.168.10.65'), mac: tm.rohan.mac, name: 'Rohan' }],
  }] } });
  [tm.gondor, tm.rohan, tm.pc].forEach((h) => h.useDhcp());
  tm.t.settle();
  assert.equal(formatIp(tm.gondor.config.ip!), '192.168.10.64');
  assert.equal(formatIp(tm.rohan.config.ip!), '192.168.10.65');
  assert.equal(formatIp(tm.pc.config.ip!), '192.168.10.1');
  assert.equal(formatIp(tm.gondor.config.gateway!), '192.168.10.254');
  assert.equal(formatIp(tm.gondor.config.dns!), '192.168.20.192');
  assert.equal(tm.gondor.dhcpClient.lease?.domainName, 'tierramedia.jc');
});

test('UT2 practice 2: Mordor IOS pool, hardware-address reservations and show running-config | section dhcp', () => {
  const tm = tierraMedia();
  assert.deepEqual(applyConfig(tm.mordor, `ip dhcp excluded-address 192.168.10.33 192.168.10.254
ip dhcp pool HOMBRES
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.254
 dns-server 192.168.20.192
 domain-name tierramedia.jc
ip dhcp pool GONDOR
 host 192.168.10.64 255.255.255.0
 hardware-address ${formatMacCisco(tm.gondor.mac)}
ip dhcp pool ROHAN
 host 192.168.10.65 255.255.255.0
 hardware-address ${formatMacCisco(tm.rohan.mac)}`.split('\n')), []);
  [tm.gondor, tm.rohan, tm.pc].forEach((h) => h.useDhcp());
  tm.t.settle();
  assert.equal(formatIp(tm.gondor.config.ip!), '192.168.10.64');
  assert.equal(formatIp(tm.rohan.config.ip!), '192.168.10.65');
  assert.equal(formatIp(tm.pc.config.ip!), '192.168.10.1');
  const s = new Session(tm.mordor);
  s.mode = 'exec';
  const section = s.input('show running-config | section dhcp');
  assert.equal(section[0], 'ip dhcp excluded-address 192.168.10.33 192.168.10.254');
  assert.ok(section.includes('ip dhcp pool GONDOR') && section.includes(' host 192.168.10.64 255.255.255.0'));
  assert.ok(!section.some((l) => l.startsWith('interface')));
  assert.match(s.input('show ip dhcp binding').join('\n'), /192\.168\.10\.64 .*Infinite +Manual/);
});

test('UT3: Lothlorien DNS for tierramedia.jc answers nslookup and ping by FQDN from Gondor', () => {
  const tm = tierraMedia();
  configureLothlorien(tm.lothlorien);
  tm.gondor.setStatic({ ip: ip('192.168.10.64'), prefix: 24, gateway: ip('192.168.10.254'), dns: ip('192.168.20.192') });
  tm.t.settle();
  const look = (name: string): string => pcCommand(tm.gondor, `nslookup ${name}`).join('\n');
  assert.match(look('lothlorien.tierramedia.jc'), /Address:\s+192\.168\.20\.192/);
  assert.match(look('rivendel.tierramedia.jc'), /Address:\s+192\.168\.20\.193/);
  assert.match(look('hobbiton.tierramedia.jc'), /Address:\s+10\.0\.32\.64/);
  assert.match(look('mordor.tierramedia.jc'), /Address:\s+192\.168\.10\.254/);
  assert.match(look('dns.tierramedia.jc'), /192\.168\.20\.192/);
  assert.match(pcCommand(tm.gondor, 'ping lothlorien.tierramedia.jc').join('\n'), /Reply from 192\.168\.20\.192/);
});
