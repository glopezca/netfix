import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Pc } from '../../src/devices/pc.ts';
import { runSync } from '../../src/net/sync.ts';
import type { TcpResult } from '../../src/net/tcp.ts';
import type { DnsResult } from '../../src/net/dns.ts';
import { firstAddress, reverseName, ipFromReverse, isValidHostname, normalizeName } from '../../src/net/dns.ts';
import { frameProtocol, tcpService } from '../../src/net/packets.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';

function pair(): { t: Topology; a: Pc; b: Pc } {
  const t = new Topology();
  const a = t.add('pc', 0, 0).device as Pc;
  const b = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: a.id, port: 'FastEthernet0' }, { device: b.id, port: 'FastEthernet0' });
  a.setStatic({ ip: parseIp('10.0.0.1')!, prefix: 24 });
  b.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  return { t, a, b };
}

const GET = { app: 'HTTP', kind: 'request', method: 'GET', host: 'b', path: '/' } as const;

test('tcp: handshake, request and reply with simulation labels', () => {
  const { t, a, b } = pair();
  b.tcp.listen(80, (req, peer) => {
    assert.equal(formatIp(peer.ip), '10.0.0.1');
    assert.equal(req.app, 'HTTP');
    return { app: 'HTTP', kind: 'response', status: 200, reason: 'OK', server: 'test', contentType: 'text/plain', body: 'hola' };
  });
  const r = runSync<TcpResult>(a.hooks, (done) => a.connect(parseIp('10.0.0.2')!, 80, GET, done));
  assert.equal(r?.kind, 'ok');
  if (r?.kind === 'ok' && r.reply.app === 'HTTP' && r.reply.kind === 'response') assert.equal(r.reply.body, 'hola');
  t.settle(10);
  const tcp = t.net.history.filter((e) => e.frame.ip?.tcp).map((e) => `${e.protocol}:${e.frame.ip!.tcp!.flags.join('+')}`);
  assert.deepEqual(tcp, ['TCP:SYN', 'TCP:SYN+ACK', 'HTTP:ACK+PSH', 'HTTP:ACK+PSH+FIN', 'TCP:ACK']);
  assert.equal(tcpService(t.net.history.find((e) => e.frame.ip?.tcp)!.frame.ip!.tcp!), 'HTTP');
  assert.deepEqual(b.tcp.listeningPorts(), [80]);
});

test('tcp: closed port is refused, handler null resets, no route and timeout', () => {
  const { a, b } = pair();
  const closed = runSync<TcpResult>(a.hooks, (done) => a.connect(parseIp('10.0.0.2')!, 22, GET, done));
  assert.equal(closed?.kind, 'refused');
  b.tcp.listen(25, () => null);
  const reset = runSync<TcpResult>(a.hooks, (done) => a.connect(parseIp('10.0.0.2')!, 25, GET, done));
  assert.equal(reset?.kind, 'refused');
  const noroute = runSync<TcpResult>(a.hooks, (done) => a.connect(parseIp('8.8.8.8')!, 80, GET, done));
  assert.equal(noroute?.kind, 'noroute');
  const timeout = runSync<TcpResult>(a.hooks, (done) => a.connect(parseIp('10.0.0.9')!, 80, GET, done, 500));
  assert.equal(timeout?.kind, 'timeout');
  b.tcp.unlisten(25);
  assert.equal(b.tcp.isListening(25), false);
});

test('dns resolver: no server, timeout and helpers', () => {
  const { a } = pair();
  const none = runSync<DnsResult>(a.hooks, (done) => a.lookup('x.lab', 'A', done));
  assert.equal(none?.kind, 'noserver');
  const to = runSync<DnsResult>(a.hooks, (done) => a.lookup('x.lab', 'A', done, parseIp('10.0.0.2')!));
  assert.equal(to?.kind, 'timeout');
  assert.equal(reverseName(parseIp('10.1.2.3')!), '3.2.1.10.in-addr.arpa');
  assert.equal(formatIp(ipFromReverse('3.2.1.10.in-addr.arpa.')!), '10.1.2.3');
  assert.equal(ipFromReverse('foo'), undefined);
  assert.equal(normalizeName(' WWW.Lab. '), 'www.lab');
  assert.ok(isValidHostname('www.aula.lab'));
  assert.ok(!isValidHostname('bad..name'));
  const msg = { id: 1, response: true, qname: 'www.lab', qtype: 'A' as const, answers: [
    { name: 'www.lab', type: 'CNAME' as const, ttl: 60, data: 'web.lab' },
    { name: 'web.lab', type: 'A' as const, ttl: 60, data: '10.0.0.80' },
  ] };
  assert.equal(formatIp(firstAddress(msg)!), '10.0.0.80');
  assert.equal(firstAddress({ ...msg, answers: [] }), undefined);
  assert.equal(frameProtocol({ src: 'a', dst: 'b', ip: { src: 1, dst: 2, ttl: 1, protocol: 'udp', udp: { sport: 1, dport: 53, dns: msg } } }), 'DNS');
});
