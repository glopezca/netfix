/** Server DHCP: a reservation can be moved and replaced in one step (no «already reserved» dead end). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Server } from '../../src/devices/server.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Switch } from '../../src/devices/switch.ts';
import { LinuxRouter } from '../../src/devices/linux-router.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { DhcpReservation } from '../../src/services/config.ts';
import { reserveLease, setReservations, withReservation } from '../../src/services/dhcp-reservations.ts';

const ip = (s: string): number => parseIp(s)!;

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  srv.setStatic({ ip: ip('192.168.1.2'), prefix: 24 });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'serverPool', start: ip('192.168.1.100'), prefix: 24, maxUsers: 50, leaseMinutes: 60, reservations: [] }] } });
  return { t, srv, pc };
}

const reservations = (srv: Server): readonly DhcpReservation[] => srv.services.dhcp.pools[0]!.reservations;

test('withReservation replaces the entry with the same address or the same client', () => {
  const a: DhcpReservation = { ip: ip('192.168.1.20'), mac: '000142abcdef' };
  const b: DhcpReservation = { ip: ip('192.168.1.21'), clientId: '01000142abcdef' };
  assert.deepEqual(withReservation([a, b], { ip: ip('192.168.1.30'), mac: '000142abcdef' }), [b, { ip: ip('192.168.1.30'), mac: '000142abcdef' }], 'the client moves');
  assert.deepEqual(withReservation([a, b], { ip: ip('192.168.1.20'), mac: '0001aaaaaaaa' }), [b, { ip: ip('192.168.1.20'), mac: '0001aaaaaaaa' }], 'the address goes to another client');
  assert.deepEqual(withReservation([a], b), [a, b], 'another client and address are added');
});

test('reserving a lease of a client that already had a reservation moves it instead of failing', () => {
  const { t, srv, pc } = lab();
  pc.useDhcp();
  t.settle();
  const leased = pc.config.ip!;
  // The client was reserved elsewhere before (by MAC): reserving its lease used to fail as a duplicate client.
  assert.equal(setReservations(srv, 'serverPool', [{ ip: ip('192.168.1.40'), mac: pc.mac }]), null);
  assert.equal(reserveLease(srv, leased, 'mac'), null);
  assert.deepEqual(reservations(srv).map((r) => r.ip), [leased], 'one reservation, at the lease\'s address');
  // …and it is reversed by deleting it.
  assert.equal(setReservations(srv, 'serverPool', reservations(srv).filter((r) => r.ip !== leased)), null);
  assert.equal(reservations(srv).length, 0);
});

test('a Linux router off DHCP keeps the lease\'s address as static and can then change it', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const r = t.add('linux-router', 0, 0).device as LinuxRouter;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: r.id, port: r.primaryPort() });
  srv.setStatic({ ip: ip('192.168.1.2'), prefix: 24 });
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'serverPool', start: ip('192.168.1.100'), prefix: 24, maxUsers: 50, leaseMinutes: 60, reservations: [], gateway: ip('192.168.1.1') }] } });
  r.useDhcp();
  t.settle();
  const lease = r.config.ip;
  assert.ok(lease !== undefined && r.config.mode === 'dhcp');
  // What the panel's DHCP box now does when unticked.
  r.setStatic({ ip: r.config.ip, prefix: r.config.prefix, gateway: r.config.gateway, dns: r.config.dns });
  assert.equal(r.config.mode, 'static');
  assert.equal(r.config.ip, lease);
  assert.equal(r.config.gateway, ip('192.168.1.1'), 'the gateway the lease gave is kept');
  r.setStatic({ ...r.config, ip: ip('192.168.1.50') });
  assert.equal(r.config.ip, ip('192.168.1.50'));
});
