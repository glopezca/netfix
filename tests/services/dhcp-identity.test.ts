/** Server DHCP: reservations and automatic leases by MAC or by client identifier. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Server } from '../../src/devices/server.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Switch } from '../../src/devices/switch.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { asciiToHex, clientIdFromMac } from '../../src/core/mac.ts';
import type { DhcpReservation, PtDhcpPool } from '../../src/services/config.ts';
import { validatePool, leaseToReservation } from '../../src/services/dhcp-pt.ts';
import { servicesFromJson, servicesToJson } from '../../src/services/persist.ts';

const ip = (s: string): number => parseIp(s)!;

function lab(): { t: Topology; srv: Server; a: Pc; b: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const a = t.add('pc', 0, 0).device as Pc;
  const b = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: a.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  t.connect({ device: b.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/2' });
  srv.setStatic({ ip: ip('192.168.1.2'), prefix: 24 });
  return { t, srv, a, b };
}

function pool(extra: Partial<PtDhcpPool> = {}): PtDhcpPool {
  return { name: 'serverPool', start: ip('192.168.1.100'), prefix: 24, maxUsers: 50, leaseMinutes: 60, reservations: [], ...extra };
}

function serve(srv: Server, p: PtDhcpPool): void {
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [p] } });
}

function renew(t: Topology, ...pcs: Pc[]): void {
  pcs.forEach((p) => p.useDhcp());
  t.settle();
}

test('reservation by MAC matches the hardware address whatever client-id the client sends (Kea hw-address)', () => {
  const { t, srv, a } = lab();
  a.clientIdOverride = asciiToHex('cisco-router-gi0/0');
  serve(srv, pool({ reservations: [{ ip: ip('192.168.1.20'), mac: a.mac }] }));
  renew(t, a);
  assert.equal(formatIp(a.config.ip!), '192.168.1.20');
});

test('reservation by client identifier: matches option 61, not the MAC', () => {
  const { t, srv, a, b } = lab();
  a.clientIdOverride = asciiToHex('aula-pc-a');
  serve(srv, pool({ reservations: [{ ip: ip('192.168.1.30'), clientId: asciiToHex('aula-pc-a') }, { ip: ip('192.168.1.31'), clientId: clientIdFromMac(b.mac) }] }));
  renew(t, a, b);
  assert.equal(formatIp(a.config.ip!), '192.168.1.30');
  assert.equal(formatIp(b.config.ip!), '192.168.1.31');
  a.clientIdOverride = asciiToHex('otro-id');
  renew(t, a);
  assert.notEqual(formatIp(a.config.ip!), '192.168.1.30');
});

test('automatic leases follow the client-id by default and the MAC with identifyBy mac', () => {
  const { t, srv, a } = lab();
  serve(srv, pool());
  renew(t, a);
  const first = formatIp(a.config.ip!);
  a.clientIdOverride = asciiToHex('nuevo-id');
  renew(t, a);
  assert.notEqual(formatIp(a.config.ip!), first, 'client-id mode: a new identifier is a new client');

  const second = lab();
  serve(second.srv, pool({ identifyBy: 'mac' }));
  renew(second.t, second.a);
  const byMac = formatIp(second.a.config.ip!);
  second.a.clientIdOverride = asciiToHex('nuevo-id');
  renew(second.t, second.a);
  assert.equal(formatIp(second.a.config.ip!), byMac, 'mac mode: same MAC keeps its lease');
  assert.equal(second.srv.dhcpEngine.allBindings(second.t.net.clock.now()).length, 1);
});

test('a lease becomes a reservation by MAC or by client-id', () => {
  const { t, srv, a } = lab();
  serve(srv, pool());
  renew(t, a);
  const lease = srv.dhcpEngine.allBindings(t.net.clock.now())[0]!;
  const byMac = leaseToReservation(lease, 'mac');
  const byId = leaseToReservation(lease, 'client-id');
  assert.deepEqual(byMac, { ip: lease.ip, mac: a.mac, name: a.name });
  assert.deepEqual(byId, { ip: lease.ip, clientId: clientIdFromMac(a.mac), name: a.name });
  assert.equal(leaseToReservation({ ...lease, clientId: undefined }, 'client-id'), null);
});

test('validation: exactly one identifier, no duplicated IP or identifier', () => {
  const both = { ip: ip('192.168.1.5'), mac: '00aabbccddee', clientId: '0100aabbccddee' } as DhcpReservation;
  assert.match(validatePool(pool({ reservations: [both] }), []) ?? '', /MAC o un Client-ID/);
  assert.match(validatePool(pool({ reservations: [{ ip: ip('192.168.1.5') } as DhcpReservation] }), []) ?? '', /MAC o un Client-ID/);
  const dupIp = [{ ip: ip('192.168.1.5'), mac: '00aabbccddee' }, { ip: ip('192.168.1.5'), clientId: 'ab' }];
  assert.match(validatePool(pool({ reservations: dupIp }), []) ?? '', /repetida/);
  const dupId = [{ ip: ip('192.168.1.5'), clientId: 'abcd' }, { ip: ip('192.168.1.6'), clientId: 'abcd' }];
  assert.match(validatePool(pool({ reservations: dupId }), []) ?? '', /repetid/);
  assert.equal(validatePool(pool({ reservations: [{ ip: ip('192.168.1.5'), clientId: 'abcd' }] }), []), null);
});

test('kea-dhcp4.conf shows hw-address, client-id and match-client-id', () => {
  const { srv, a } = lab();
  serve(srv, pool({ identifyBy: 'mac', reservations: [{ ip: ip('192.168.1.20'), mac: a.mac }, { ip: ip('192.168.1.21'), clientId: '0161756c61' }] }));
  const conf = createShell(srv, 'linux').run('cat /etc/kea/kea-dhcp4.conf').join('\n');
  assert.match(conf, /"match-client-id": false/);
  assert.match(conf, /"hw-address": "[0-9a-f:]{17}", "ip-address": "192\.168\.1\.20"/);
  assert.match(conf, /"client-id": "01:61:75:6c:61", "ip-address": "192\.168\.1\.21"/);
});

test('JSON keeps client-id reservations and identifyBy; v0.2 files load as before', () => {
  const services = { ...lab().srv.services, dhcp: { enabled: true, pools: [pool({ identifyBy: 'mac', reservations: [{ ip: ip('192.168.1.21'), clientId: '0161756c61', name: 'x' }] })] } };
  const back = servicesFromJson(JSON.parse(JSON.stringify(servicesToJson(services))));
  const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(back.dhcp.pools[0]), plain(services.dhcp.pools[0]));
  const v02 = { ...servicesToJson(services), dhcp: { enabled: true, pools: [{ name: 'p', start: '10.0.0.10', prefix: 24, maxUsers: 5, leaseMinutes: 60, reservations: [{ ip: '10.0.0.5', mac: '0001.4200.0001' }] }] } };
  const old = servicesFromJson(v02).dhcp.pools[0]!;
  assert.equal(old.identifyBy, undefined);
  assert.deepEqual(old.reservations, [{ ip: ip('10.0.0.5'), mac: '000142000001', name: undefined }]);
  assert.throws(() => servicesFromJson({ ...v02, dhcp: { enabled: true, pools: [{ ...v02.dhcp.pools[0], reservations: [{ ip: '10.0.0.5', clientId: 'zz' }] }] } }), /Client-ID/);
});

test('custom client-id on a PC survives a JSON round trip', () => {
  const { t, a } = lab();
  a.clientIdOverride = asciiToHex('aula-pc-a');
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const pc = [...back.placed.values()].map((p) => p.device).find((d): d is Pc => d instanceof Pc && d.id === a.id)!;
  assert.equal(pc.clientIdOverride, asciiToHex('aula-pc-a'));
});
