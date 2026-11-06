/**
 * kea-dhcp4.conf (already checked by kea-dhcp4 -t) into Netfix's DHCP model: one pool per subnet4 with its first range,
 * lease time, match-client-id, the options the model knows, reservations and interfaces-config. What the model
 * cannot represent is left out without an error, as the real checker accepts it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importKea } from '../../src/services/kea-import.ts';
import type { PtDhcpPool } from '../../src/services/config.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const conf = (body: string): string => `{ "Dhcp4": {\n${body}\n} }\n`;
const POOL: PtDhcpPool = { name: 'LAN', start: ip('192.168.10.100'), prefix: 24, maxUsers: 50, leaseMinutes: 1440, reservations: [], tftp: ip('192.168.10.9') };

test('a full subnet: range, lifetime, options, reservations and identity', () => {
  const r = importKea(conf(`"subnet4": [ { "id": 7, "subnet": "172.16.0.0/16",
    "pools": [ { "pool": "172.16.1.10 - 172.16.1.59" }, { "pool": "172.16.2.0/24" } ],
    "valid-lifetime": 7200, "match-client-id": false,
    "option-data": [ { "name": "routers", "data": "172.16.0.1" }, { "name": "domain-name-servers", "data": "172.16.0.2, 8.8.8.8" },
      { "name": "domain-name", "data": "aula.lan" }, { "name": "netbios-name-servers", "data": "172.16.0.3" }, { "name": "ntp-servers", "data": "172.16.0.4" } ],
    "reservations": [ { "hw-address": "00:11:22:33:44:55", "ip-address": "172.16.0.50", "hostname": "impresora" },
      { "client-id": "01:aa:bb:cc:dd:ee:ff", "ip-address": "172.16.0.51" }, { "duid": "00:01", "ip-address": "172.16.0.52" } ] } ]`), []);
  assert.deepEqual(r?.pools, [{
    name: 'subnet7', start: ip('172.16.1.10'), prefix: 16, maxUsers: 50, leaseMinutes: 120, identifyBy: 'mac',
    gateway: ip('172.16.0.1'), dns: ip('172.16.0.2'), domain: 'aula.lan', wins: ip('172.16.0.3'),
    reservations: [{ ip: ip('172.16.0.50'), mac: '001122334455', name: 'impresora' }, { ip: ip('172.16.0.51'), clientId: '01aabbccddeeff' }],
  }]);
  assert.equal(r?.interfaces, undefined, 'no interfaces-config: every interface');
});

test('the pool keeps its name and TFTP server when its network is the same', () => {
  const r = importKea(conf(`"subnet4": [ { "subnet": "192.168.10.0/24", "pools": [ { "pool": "192.168.10.20 - 192.168.10.29" } ] },
    { "subnet": "10.1.0.0/24", "pools": [ { "pool": "10.1.0.0/24" } ] } ]`), [POOL]);
  assert.equal(r?.pools[0]?.name, 'LAN');
  assert.equal(r?.pools[0]?.tftp, ip('192.168.10.9'));
  assert.equal(r?.pools[0]?.maxUsers, 10);
  assert.equal(r?.pools[1]?.name, 'subnet2', 'no id: its position');
  assert.equal(r?.pools[1]?.start, ip('10.1.0.1'), 'the range is clamped to the usable addresses');
  assert.equal(r?.pools[1]?.maxUsers, 254);
});

test('inheritance from Dhcp4 and Kea defaults; a subnet without pools is left out', () => {
  const r = importKea(conf(`"valid-lifetime": 600, "match-client-id": false,
    "option-data": [ { "name": "routers", "data": "10.0.0.1" } ],
    "subnet4": [ { "subnet": "10.0.0.0/24", "pools": [ { "pool": "10.0.0.10-10.0.0.19" } ] },
      { "subnet": "10.9.0.0/24" }, { "subnet": "10.8.0.0/31", "pools": [ { "pool": "10.8.0.0/31" } ] } ]`), []);
  assert.equal(r?.pools.length, 1);
  assert.equal(r?.pools[0]?.leaseMinutes, 10);
  assert.equal(r?.pools[0]?.identifyBy, 'mac');
  assert.equal(r?.pools[0]?.gateway, ip('10.0.0.1'));
  const def = importKea(conf(`"subnet4": [ { "subnet": "10.0.0.0/24", "pools": [ { "pool": "10.0.0.10-10.0.0.19" } ] } ]`), []);
  assert.equal(def?.pools[0]?.leaseMinutes, 120, "Kea's default valid-lifetime is 7200 s");
  assert.equal(def?.pools[0]?.identifyBy, undefined);
});

test('interfaces-config: names without the address, * is every interface', () => {
  const ifaces = (list: string): readonly string[] | undefined => importKea(conf(`"interfaces-config": { "interfaces": [ ${list} ] }, "subnet4": []`), [])?.interfaces;
  assert.deepEqual(ifaces('"eth0/10.0.0.2", "eth1", "eth0"'), ['eth0', 'eth1']);
  assert.equal(ifaces('"*"'), undefined);
  assert.deepEqual(ifaces('"ens33"'), [], 'an interface the device does not have');
});

test('limits: a lifetime too long, a domain that is not one, reservations outside the subnet', () => {
  const r = importKea(conf(`"subnet4": [ { "subnet": "10.0.0.0/24", "pools": [ { "pool": "10.0.0.10-10.0.0.19" } ], "valid-lifetime": 999999999,
    "option-data": [ { "name": "domain-name", "data": "a\\"b" } ],
    "reservations": [ { "hw-address": "00:11:22:33:44:55", "ip-address": "10.9.9.9" }, { "hw-address": "zz", "ip-address": "10.0.0.5" } ] } ]`), []);
  assert.equal(r?.pools[0]?.leaseMinutes, 525_600);
  assert.equal(r?.pools[0]?.domain, undefined);
  assert.deepEqual(r?.pools[0]?.reservations, []);
  const many = Array.from({ length: 600 }, (_, i) => `{ "subnet": "10.${Math.floor(i / 250)}.${i % 250}.0/24", "pools": [ { "pool": "10.${Math.floor(i / 250)}.${i % 250}.0/24" } ] }`);
  assert.equal(importKea(conf(`"subnet4": [ ${many.join(',')} ]`), [])?.pools.length, 500);
});

test('a reservation keeps a host name only if it is one (letters, digits, dots and hyphens, up to 64)', () => {
  const names = (...hostnames: string[]): (string | undefined)[] => {
    const hosts = hostnames.map((h, i) => `{ "hw-address": "00:11:22:33:44:5${i}", "ip-address": "10.0.0.${i + 5}", "hostname": ${JSON.stringify(h)} }`);
    const r = importKea(conf(`"subnet4": [ { "subnet": "10.0.0.0/24", "pools": [ { "pool": "10.0.0.10-10.0.0.19" } ], "reservations": [ ${hosts.join(',')} ] } ]`), []);
    return (r?.pools[0]?.reservations ?? []).map((x) => x.name);
  };
  assert.deepEqual(names('pc-1.lab', '<b>x</b>', 'a\u001b[31m', 'x'.repeat(65), ''), ['pc-1.lab', undefined, undefined, undefined, undefined]);
});

test('a text that does not parse gives nothing', () => {
  assert.equal(importKea('{ "Dhcp4": ', []), undefined);
});
