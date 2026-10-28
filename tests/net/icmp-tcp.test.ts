/**
 * An ICMP destination unreachable also answers a denied TCP connection, as on real routers: the error quotes the
 * original header, a Linux client aborts connect() in SYN_SENT with the errno of the code (host and administratively
 * prohibited: No route to host; net: Network is unreachable), and a Windows client ignores it and times out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { AppPayload, IpPacket } from '../../src/net/packets.ts';
import { TcpLayer } from '../../src/net/tcp.ts';
import type { TcpResult } from '../../src/net/tcp.ts';
import { parseIp } from '../../src/core/ip.ts';

function bastionado(): Topology {
  const t = EXAMPLES.find((e) => e.id === 'bastionado')?.build();
  assert.ok(t, 'the bastionado lab exists');
  return t;
}

test('ssh denied by an IOS ACL: Linux says No route to host at once', () => {
  const t = bastionado();
  const out = createShell(t.byLabel('ALUMNO') as Pc, 'linux', 'alumno').run('ssh admin@172.20.0.10');
  assert.deepEqual(out, ['ssh: connect to host 172.20.0.10 port 22: No route to host']);
});

test('nc to a port denied by an IOS ACL fails with No route to host', () => {
  const t = bastionado();
  const sh = createShell(t.byLabel('ALUMNO') as Pc, 'linux', 'alumno');
  assert.match(sh.run('nc -zv 172.20.0.10 22 2>&1').join('\n'), /nc: connect to 172\.20\.0\.10 port 22 \(tcp\) failed: No route to host/);
});

test('curl to a port denied by an IOS ACL fails at once with error 7', () => {
  const t = bastionado();
  const sh = createShell(t.byLabel('ALUMNO') as Pc, 'linux', 'alumno');
  assert.match(sh.run('curl http://172.20.0.10:22/ 2>&1; echo "rc=$?"').join('\n'), /curl: \(7\) Failed to connect to 172\.20\.0\.10 port 22 after 0 ms: Couldn't connect to server\nrc=7/);
});

test('the permitted traffic still works', () => {
  const t = bastionado();
  const sh = createShell(t.byLabel('ALUMNO') as Pc, 'linux', 'alumno');
  assert.deepEqual(sh.run('curl -s -o /dev/null -w "%{http_code}\\n" http://172.20.0.10/'), ['200']);
});

test('a Windows client ignores the ICMP error during connect and times out', () => {
  const t = bastionado();
  const pc = t.byLabel('ALUMNO') as Pc;
  pc.os = 'windows';
  const out = createShell(pc, 'windows', 'alumno').run('ssh admin@172.20.0.10');
  assert.deepEqual(out, ['ssh: connect to host 172.20.0.10 port 22: Connection timed out']);
});

test('a router without a route answers net unreachable: ssh says Network is unreachable', () => {
  const t = EXAMPLES.find((e) => e.id === 'servidores')?.build();
  assert.ok(t);
  const out = createShell(t.byLabel('PC1') as Pc, 'linux', 'alumno').run('ssh admin@8.8.8.8');
  assert.deepEqual(out, ['ssh: connect to host 8.8.8.8 port 22: Network is unreachable']);
});

test('no ICMP error about a broadcast or an unaddressed sender (a DHCP DISCOVER denied by an ACL)', () => {
  const t = bastionado();
  const gw = t.byLabel('GW') as Router;
  const sent: IpPacket[] = [];
  const send = gw.plane.stack.send.bind(gw.plane.stack);
  gw.plane.stack.send = (p: IpPacket): boolean => { sent.push(p); return send(p); };
  const discover: IpPacket = { src: 0, dst: 0xffffffff, ttl: 64, protocol: 'udp', udp: { sport: 68, dport: 67 } };
  gw.plane.forward('GigabitEthernet0/1', { ...discover, dst: parseIp('172.20.0.255') ?? 0 });
  gw.plane.forward('GigabitEthernet0/1', discover);
  assert.equal(sent.filter((p) => p.icmp).length, 0);
});

function tcpPair(): { layer: TcpLayer; results: TcpResult[]; sport: () => number } {
  const emitted: IpPacket[] = [];
  const layer = new TcpLayer({ send: (p) => { emitted.push(p); return true; }, sourceFor: () => 10, schedule: () => undefined, ttl: 64 });
  const results: TcpResult[] = [];
  const payload: AppPayload = { app: 'HTTP', kind: 'request', method: 'GET', host: 'x', path: '/', headers: {} };
  layer.request(20, 22, payload, (r) => results.push(r));
  return { layer, results, sport: () => emitted[0]?.tcp?.sport ?? 0 };
}

test('TcpLayer: an ICMP error must quote this very connection', () => {
  const { layer, results, sport } = tcpPair();
  layer.icmpUnreachable({ protocol: 'tcp', src: 10, dst: 20, sport: sport() + 1, dport: 22 }, 'host');
  layer.icmpUnreachable({ protocol: 'tcp', src: 10, dst: 21, sport: sport(), dport: 22 }, 'host');
  layer.icmpUnreachable({ protocol: 'tcp', src: 11, dst: 20, sport: sport(), dport: 22 }, 'host');
  assert.deepEqual(results, []);
  layer.icmpUnreachable({ protocol: 'tcp', src: 10, dst: 20, sport: sport(), dport: 22 }, 'admin');
  assert.deepEqual(results, [{ kind: 'unreachable', reason: 'host' }]);
  layer.icmpUnreachable({ protocol: 'tcp', src: 10, dst: 20, sport: sport(), dport: 22 }, 'net');
  assert.equal(results.length, 1, 'reported once');
});

test('TcpLayer: past SYN_SENT an ICMP error no longer aborts; port unreachable means refused', () => {
  const a = tcpPair();
  a.layer.receive({ src: 20, dst: 10, ttl: 64, protocol: 'tcp', tcp: { sport: 22, dport: a.sport(), flags: ['SYN', 'ACK'], seq: 5, ack: 1 } });
  a.layer.icmpUnreachable({ protocol: 'tcp', src: 10, dst: 20, sport: a.sport(), dport: 22 }, 'host');
  assert.deepEqual(a.results, []);
  const b = tcpPair();
  b.layer.icmpUnreachable({ protocol: 'tcp', src: 10, dst: 20, sport: b.sport(), dport: 22 }, 'port');
  assert.deepEqual(b.results, [{ kind: 'refused' }]);
});
