import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../src/devices/router.ts';
import { DhcpServer } from '../../src/dhcp/server.ts';
import type { ServerContext } from '../../src/dhcp/server.ts';
import type { DhcpMessage, DhcpType } from '../../src/net/packets.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { clientIdFromMac, asciiToHex } from '../../src/core/mac.ts';
import { openConsole, runAll } from '../helpers.ts';
import { showBindings, showPools, showStatistics, showConflicts } from '../../src/dhcp/show.ts';

const ip = (s: string): number => parseIp(s)!;
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);

function ctx(over: Partial<ServerContext> = {}): ServerContext & { logs: string[] } {
  const logs: string[] = [];
  return {
    ifaceName: 'GigabitEthernet0/0',
    ifaceAddrs: [{ ip: ip('192.168.1.1'), prefix: 24 }],
    ownIps: [ip('192.168.1.1')],
    now: T0,
    ipInUse: () => false,
    log: (l) => logs.push(l),
    logs,
    ...over,
  };
}

function msg(type: DhcpType, mac: string, extra: Partial<DhcpMessage> & { requestedIp?: number; serverId?: number; clientId?: string | null } = {}): DhcpMessage {
  const clientId = extra.clientId === null ? undefined : extra.clientId ?? clientIdFromMac(mac);
  return {
    op: 'BOOTREQUEST', xid: 1, ciaddr: extra.ciaddr ?? 0, yiaddr: 0, siaddr: 0, giaddr: extra.giaddr ?? 0, chaddr: mac, broadcastFlag: false,
    options: { messageType: type, clientId, requestedIp: extra.requestedIp, serverId: extra.serverId },
  };
}

function server(lines: readonly string[]): DhcpServer {
  const r = new Router();
  runAll(openConsole(r, 'config'), lines);
  return r.dhcp;
}

function dora(s: DhcpServer, mac: string, c = ctx(), opts: { clientId?: string | null; giaddr?: number } = {}): number {
  const offer = s.handle(msg('DISCOVER', mac, opts), c);
  assert.ok(offer, 'no offer');
  assert.equal(offer.msg.options.messageType, 'OFFER');
  const ack = s.handle(msg('REQUEST', mac, { ...opts, requestedIp: offer.msg.yiaddr, serverId: offer.msg.options.serverId }), c);
  assert.equal(ack?.msg.options.messageType, 'ACK');
  return ack!.msg.yiaddr;
}

const LAN = ['ip dhcp excluded-address 192.168.1.1 192.168.1.10', 'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0',
  'default-router 192.168.1.1', 'dns-server 8.8.8.8', 'domain-name lab.local', 'lease 0 8'];

test('DORA assigns the lowest non-excluded address with pool options', () => {
  const s = server(LAN);
  const c = ctx();
  const offer = s.handle(msg('DISCOVER', 'aabbcc000001'), c)!;
  assert.equal(formatIp(offer.msg.yiaddr), '192.168.1.11');
  assert.equal(offer.via, 'broadcast');
  const o = offer.msg.options;
  assert.equal(o.subnetPrefix, 24);
  assert.deepEqual(o.routers, [ip('192.168.1.1')]);
  assert.deepEqual(o.dnsServers, [ip('8.8.8.8')]);
  assert.equal(o.domainName, 'lab.local');
  assert.equal(o.leaseSeconds, 8 * 3600);
  assert.equal(o.serverId, ip('192.168.1.1'));
  const ack = s.handle(msg('REQUEST', 'aabbcc000001', { requestedIp: offer.msg.yiaddr, serverId: o.serverId }), c)!;
  assert.equal(ack.msg.options.messageType, 'ACK');
  assert.equal(formatIp(dora(s, 'aabbcc000002', c)), '192.168.1.12');
  const table = showBindings(s, T0).join('\n');
  assert.match(table, /192\.168\.1\.11\s+01aa\.bbcc\.0000\.01\s+Oct 10 2026 05:00 PM\s+Automatic/);
});

test('a client keeps its address on a new DISCOVER', () => {
  const s = server(LAN);
  const a = dora(s, 'aabbcc000001');
  assert.equal(dora(s, 'aabbcc000001'), a);
});

test('manual binding with client-identifier (host pool) and inherited options', () => {
  const s = server([...LAN, 'ip dhcp pool PRN', 'host 192.168.1.20 255.255.255.0', 'client-identifier 0100.1122.3344.55', 'client-name prn']);
  const c = ctx();
  const offer = s.handle(msg('DISCOVER', '001122334455'), c)!;
  assert.equal(formatIp(offer.msg.yiaddr), '192.168.1.20');
  assert.deepEqual(offer.msg.options.routers, [ip('192.168.1.1')], 'inherits default-router from LAN');
  assert.equal(offer.msg.options.hostname, 'prn');
  assert.equal(formatIp(dora(s, '001122334455', c)), '192.168.1.20');
  assert.match(showBindings(s, T0).join('\n'), /192\.168\.1\.20\s+0100\.1122\.3344\.55\s+Infinite\s+Manual/);
  assert.equal(formatIp(dora(s, 'aabbcc000001', c)), '192.168.1.11', 'host address is not given to others');
});

test('manual binding with hardware-address works for PCs (client-id = 01+MAC) and without option 61', () => {
  const s = server([...LAN, 'ip dhcp pool PC', 'host 192.168.1.30 /24', 'hardware-address 0011.2233.4455']);
  assert.equal(formatIp(dora(s, '001122334455')), '192.168.1.30');
  const s2 = server([...LAN, 'ip dhcp pool PC', 'host 192.168.1.30 /24', 'hardware-address 0011.2233.4455']);
  assert.equal(formatIp(dora(s2, '001122334455', ctx(), { clientId: null })), '192.168.1.30');
});

test('hardware-address does not match a client with a non-MAC client-id (Cisco router)', () => {
  const ciscoId = `00${asciiToHex('cisco-0011.2233.4455-Gi0/0')}`;
  const s = server([...LAN, 'ip dhcp pool R2', 'host 192.168.1.30 /24', 'hardware-address 0011.2233.4455']);
  assert.equal(formatIp(dora(s, '001122334455', ctx(), { clientId: ciscoId })), '192.168.1.11');
  const hexDotted = ciscoId.match(/.{1,4}/g)!.join('.');
  const s2 = server([...LAN, 'ip dhcp pool R2', 'host 192.168.1.30 /24', `client-identifier ${hexDotted}`]);
  assert.equal(formatIp(dora(s2, '001122334455', ctx(), { clientId: ciscoId })), '192.168.1.30');
});

test('client-identifier also matches clients that send no option 61', () => {
  const s = server([...LAN, 'ip dhcp pool PC', 'host 192.168.1.40 /24', 'client-identifier 0100.1122.3344.55']);
  assert.equal(formatIp(dora(s, '001122334455', ctx(), { clientId: null })), '192.168.1.40');
});

test('host pool on another subnet is ignored', () => {
  const s = server([...LAN, 'ip dhcp pool FAR', 'host 10.9.9.9 /24', 'client-identifier 0100.1122.3344.55']);
  assert.equal(formatIp(dora(s, '001122334455')), '192.168.1.11');
});

test('address reservations by client-id, hardware-address and ascii', () => {
  const s = server([...LAN, 'address 192.168.1.50 client-id 0100.1122.3344.55', 'address 192.168.1.51 hardware-address 0011.2233.4466',
    'address 192.168.1.52 client-id cliente1 ascii']);
  assert.equal(formatIp(dora(s, '001122334455')), '192.168.1.50');
  assert.equal(formatIp(dora(s, '001122334466')), '192.168.1.51');
  assert.equal(formatIp(dora(s, '0011223344ff', ctx(), { clientId: asciiToHex('cliente1') })), '192.168.1.52');
  assert.equal(formatIp(dora(s, 'aabbcc000001')), '192.168.1.11', 'reserved addresses are skipped for others');
  assert.match(showPools(s, T0).join('\n'), /3 reserved addresses are currently in the pool/);
});

test('reserved-only refuses unknown clients', () => {
  const s = server([...LAN, 'address 192.168.1.50 hardware-address 0011.2233.4455', 'reserved-only']);
  assert.equal(s.handle(msg('DISCOVER', 'aabbcc000001'), ctx()), null);
  assert.equal(formatIp(dora(s, '001122334455')), '192.168.1.50');
});

test('ping conflict is logged, recorded and skipped', () => {
  const s = server(LAN);
  const c = ctx({ ipInUse: (a) => a === ip('192.168.1.11') });
  assert.equal(formatIp(dora(s, 'aabbcc000001', c)), '192.168.1.12');
  assert.ok(c.logs.includes('%DHCPD-4-PING_CONFLICT: DHCP address conflict:  server pinged 192.168.1.11.'));
  assert.match(showConflicts(s).join('\n'), /192\.168\.1\.11\s+Ping\s+Oct 10 2026 09:00 AM/);
  s.clearConflicts();
  assert.equal(s.conflictList().length, 0);
});

test('relay: pool chosen by giaddr and reply goes to the relay', () => {
  const s = server([...LAN, 'ip dhcp pool REMOTE', 'network 10.10.0.0 255.255.0.0', 'default-router 10.10.0.1', 'ip dhcp excluded-address 10.10.0.1']);
  const c = ctx();
  const offer = s.handle(msg('DISCOVER', 'aabbcc000009', { giaddr: ip('10.10.0.1') }), c)!;
  assert.equal(formatIp(offer.msg.yiaddr), '10.10.0.2');
  assert.equal(offer.msg.giaddr, ip('10.10.0.1'));
  assert.equal(offer.via, 'relay');
});

test('no pool for subnet → no reply; NAK on wrong requested address', () => {
  const s = server(LAN);
  const c = ctx({ ifaceAddrs: [{ ip: ip('172.16.0.1'), prefix: 16 }] });
  assert.equal(s.handle(msg('DISCOVER', 'aabbcc000001'), c), null);
  const nak = s.handle(msg('REQUEST', 'aabbcc000001', { requestedIp: ip('10.0.0.5') }), ctx());
  assert.equal(nak?.msg.options.messageType, 'NAK');
});

test('INIT-REBOOT request for a free address is acknowledged unless renew deny unknown', () => {
  const s = server(LAN);
  const ack = s.handle(msg('REQUEST', 'aabbcc000001', { requestedIp: ip('192.168.1.77') }), ctx());
  assert.equal(ack?.msg.options.messageType, 'ACK');
  const s2 = server([...LAN, 'renew deny unknown']);
  const nak = s2.handle(msg('REQUEST', 'aabbcc000001', { requestedIp: ip('192.168.1.77') }), ctx());
  assert.equal(nak?.msg.options.messageType, 'NAK');
});

test('release, decline, expiry and statistics', () => {
  const s = server(LAN);
  const a = dora(s, 'aabbcc000001');
  s.handle(msg('RELEASE', 'aabbcc000001', { ciaddr: a }), ctx());
  assert.equal(s.allBindings(T0).length, 0);
  const b = dora(s, 'aabbcc000002');
  s.handle(msg('DECLINE', 'aabbcc000002', { requestedIp: b }), ctx());
  assert.equal(s.conflictList()[0]?.method, 'Gratuitous ARP');
  dora(s, 'aabbcc000003');
  assert.equal(s.allBindings(T0 + 9 * 3600 * 1000).length, 0, 'lease of 8h expired');
  const stats = showStatistics(s).join('\n');
  assert.match(stats, /DHCPDISCOVER\s+3/);
  assert.match(stats, /DHCPREQUEST\s+3/);
  assert.match(stats, /DHCPRELEASE\s+1/);
  assert.match(stats, /DHCPDECLINE\s+1/);
  assert.match(stats, /DHCPOFFER\s+3/);
  assert.match(stats, /Expired bindings\s+1/);
  s.clearStatistics();
  assert.match(showStatistics(s).join('\n'), /DHCPDISCOVER\s+0/);
});

test('secondary network is used when primary is exhausted', () => {
  const s = server(['ip dhcp pool P', 'network 10.0.0.0 255.255.255.252', 'network 10.0.1.0 /30 secondary']);
  const c = ctx({ ifaceAddrs: [{ ip: ip('10.0.0.1'), prefix: 30 }], ownIps: [ip('10.0.0.1')] });
  assert.equal(formatIp(dora(s, 'aabbcc000001', c)), '10.0.0.2');
  assert.equal(formatIp(dora(s, 'aabbcc000002', c)), '10.0.1.1');
});

test('debug output mirrors IOS wording', () => {
  const s = server(LAN);
  s.debugEvents = true;
  s.debugPacket = true;
  const c = ctx();
  dora(s, 'aabbcc000001', c);
  const text = c.logs.join('\n');
  assert.match(text, /DHCPD: DHCPDISCOVER received from client 01aa\.bbcc\.0000\.01 on interface GigabitEthernet0\/0\./);
  assert.match(text, /DHCPD: Sending DHCPOFFER to client 01aa\.bbcc\.0000\.01 \(192\.168\.1\.11\)\./);
  assert.match(text, /DHCPD: assigned IP address 192\.168\.1\.11 to client 01aa\.bbcc\.0000\.01\./);
  assert.match(text, /DHCPD: broadcasting BOOTREPLY to client aabb\.cc00\.0001\./);
});

test('show ip dhcp pool reports totals', () => {
  const s = server(LAN);
  dora(s, 'aabbcc000001');
  const out = showPools(s, T0).join('\n');
  assert.match(out, /Pool LAN :/);
  assert.match(out, /Total addresses\s+: 254/);
  assert.match(out, /Leased addresses\s+: 1/);
  assert.match(out, /Excluded addresses\s+: 10/);
  assert.match(out, /192\.168\.1\.12\s+192\.168\.1\.1\s+- 192\.168\.1\.254\s+1\s+\/ 10\s+\/ 254/);
  assert.deepEqual(showPools(s, T0, 'X'), ['%DHCP pool X does not exist']);
});

test('service dhcp disabled ignores requests', () => {
  const s = server([...LAN, 'no service dhcp']);
  assert.equal(s.handle(msg('DISCOVER', 'aabbcc000001'), ctx()), null);
});

test('infinite lease and high utilization log', () => {
  const s = server(['ip dhcp pool T', 'network 10.0.0.0 /30', 'lease infinite', 'utilization mark high 50 log']);
  const c = ctx({ ifaceAddrs: [{ ip: ip('10.0.0.1'), prefix: 30 }], ownIps: [ip('10.0.0.1')] });
  dora(s, 'aabbcc000001', c);
  assert.match(showBindings(s, T0).join('\n'), /Infinite\s+Automatic/);
  assert.ok(c.logs.some((l) => l.startsWith('%DHCPD-6-HIGH_UTIL: Pool T')));
});
