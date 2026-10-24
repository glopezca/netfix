/** netfilter on a host: input/output chains, ct state, reject vs drop, counters, log and sysctl. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { runNft } from '../../src/net/nft/apply.ts';
import type { Host } from '../../src/devices/host.ts';
import type { AppPayload } from '../../src/net/packets.ts';
import type { TcpResult } from '../../src/net/tcp.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;

function lab(): { t: Topology; srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  t.settle();
  return { t, srv, pc };
}

function nft(h: Host, src: string): void {
  const r = runNft(h.kernel.netfilter.ruleset, src);
  if (!r.ok) assert.fail(r.error);
  h.kernel.netfilter.setRuleset(r.ruleset);
}

function ping(t: Topology, from: Host, to: string): string {
  let result = 'timeout';
  from.stack.echo(ip(to), 7, 1, undefined, (r) => { result = r.kind; });
  t.settle(3000);
  return result;
}

function http(t: Topology, from: Host, to: string, port = 80): string {
  let result: TcpResult | undefined;
  const req: AppPayload = { app: 'HTTP', kind: 'request', method: 'GET', host: to, path: '/' };
  from.connect(ip(to), port, req, (r) => { result = r; }, 2000);
  t.settle(4000);
  return result?.kind ?? 'none';
}

const POLICY = `table inet filter {
  chain input {
    type filter hook input priority filter; policy drop;
    ct state established,related accept
    iif lo accept
    ip saddr 10.0.0.0/24 tcp dport 80 counter accept
    tcp dport 443 reject with tcp reset
    tcp dport 8080 counter log prefix "BLOCK " drop
  }
}`;

test('input policy drop: only allowed services answer; reject refuses, drop times out', () => {
  const { t, srv, pc } = lab();
  assert.equal(ping(t, pc, '10.0.0.2'), 'reply');
  assert.equal(http(t, pc, '10.0.0.2'), 'ok');
  nft(srv, POLICY);
  assert.equal(ping(t, pc, '10.0.0.2'), 'timeout', 'echo request dropped by the policy');
  assert.equal(http(t, pc, '10.0.0.2', 22), 'timeout', 'port 22 dropped by the policy');
  assert.equal(http(t, pc, '10.0.0.2', 443), 'refused', 'reject with tcp reset');
  assert.equal(http(t, pc, '10.0.0.2'), 'ok', 'web allowed from the LAN');
  assert.equal(http(t, pc, '10.0.0.2', 8080), 'timeout');
  const counters = [...srv.kernel.netfilter.counters.values()];
  assert.deepEqual(counters.map((c) => c.packets), [1, 1]);
  assert.match(srv.kernel.log.at(-1)?.text ?? '', /^BLOCK IN=eth0 OUT= MAC=\S+ SRC=10\.0\.0\.10 DST=10\.0\.0\.2 LEN=52 TOS=0x00 PREC=0x00 TTL=128 ID=\d+ DF PROTO=TCP SPT=\d+ DPT=8080 WINDOW=64240 RES=0x00 SYN URGP=0$/);
});

test('ct state lets the server\'s own connections come back through a drop policy', () => {
  const { t, srv, pc } = lab();
  nft(srv, POLICY);
  assert.equal(ping(t, srv, '10.0.0.10'), 'reply', 'echo reply is established');
  assert.equal(http(t, srv, '10.0.0.10'), 'refused', 'the RST from the PC (no web server) comes back as established');
  nft(srv, 'flush ruleset');
  assert.equal(ping(t, pc, '10.0.0.2'), 'reply');
});

test('output chain and icmp_echo_ignore_all', () => {
  const { t, srv, pc } = lab();
  nft(srv, 'table ip out { chain output { type filter hook output priority 0; ip daddr 10.0.0.10 icmp type echo-request drop; } }');
  assert.equal(ping(t, srv, '10.0.0.10'), 'timeout');
  assert.equal(http(t, srv, '10.0.0.10'), 'refused', 'only ICMP is blocked');
  assert.equal(srv.kernel.sysctl.set('net.ipv4.icmp_echo_ignore_all', '1'), null);
  assert.equal(ping(t, pc, '10.0.0.2'), 'timeout');
  assert.equal(srv.kernel.sysctl.set('net.ipv4.icmp_echo_ignore_all', '2'), 'invalid');
  assert.equal(srv.kernel.sysctl.set('net.ipv4.nope', '1'), 'unknown');
  assert.equal(srv.kernel.sysctl.get('net.ipv4.conf.all.forwarding'), '0');
  srv.kernel.sysctl.set('net.ipv4.ip_forward', '1');
  assert.equal(srv.kernel.sysctl.get('net.ipv4.conf.all.forwarding'), '1', 'mirrored keys');
});
