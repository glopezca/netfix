/** Linux router (2911 hardware, Ubuntu software): ip_forward, forward chain, masquerade, dnat, traceroute. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

/**
 *   pc 192.168.1.10 ── Gi0/1 [lr] Gi0/0 ── wan 203.0.113.20 (gw none: it only knows its own net)
 *                      192.168.1.1   203.0.113.1
 *   dmz 172.16.0.80 ── Gi0/2 172.16.0.1
 */
function lab(): { t: Topology; lr: LinuxRouter; pc: Pc; wan: Server; dmz: Server } {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as LinuxRouter;
  const pc = t.add('pc', 0, 0).device as Pc;
  const wan = t.add('server', 0, 0).device as Server;
  const dmz = t.add('server', 0, 0).device as Server;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: pc.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/0' }, { device: wan.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/2' }, { device: dmz.id, port: 'FastEthernet0' });
  const root = createShell(lr, 'linux', 'root');
  root.run('ip addr add 203.0.113.1/24 dev eth0; ip addr add 192.168.1.1/24 dev eth1; ip addr add 172.16.0.1/24 dev eth2');
  pc.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  wan.setStatic({ ip: ip('203.0.113.20'), prefix: 24 });
  dmz.setStatic({ ip: ip('172.16.0.80'), prefix: 24, gateway: ip('172.16.0.1') });
  t.settle();
  return { t, lr, pc, wan, dmz };
}

test('the router has three NICs as eth0-2 and only forwards with net.ipv4.ip_forward=1', () => {
  const { lr, pc } = lab();
  const root = createShell(lr, 'linux', 'root');
  assert.match(all(root.run('ip -br a')), /eth0 +UP +203\.0\.113\.1\/24 \neth1 +UP +192\.168\.1\.1\/24 \neth2 +UP +172\.16\.0\.1\/24 /);
  const sh = createShell(pc, 'linux');
  assert.match(all(sh.run('ping -c 1 192.168.1.1')), / 0% packet loss/, 'the router itself answers');
  assert.match(all(sh.run('ping -c 1 172.16.0.80')), /100% packet loss/, 'no forwarding by default');
  root.run('sysctl -w net.ipv4.ip_forward=1');
  assert.match(all(sh.run('ping -c 1 172.16.0.80')), / 0% packet loss/);
  assert.match(all(sh.run('traceroute -n 172.16.0.80')), /1 {2}192\.168\.1\.1 [\s\S]*2 {2}172\.16\.0\.80 /);
  assert.equal(lr.kind, 'linuxrouter');
  assert.deepEqual(lr.portNames(), ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2']);
});

test('forward chain, masquerade towards the WAN and dnat to the DMZ web server', () => {
  const { lr, pc, wan } = lab();
  const root = createShell(lr, 'linux', 'root');
  root.run('sysctl -w net.ipv4.ip_forward=1');
  root.run(`nft -f - <<'EOF'
table inet filter {
  chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
    iifname "eth1" oifname "eth0" accept
    iifname "eth0" oifname "eth2" tcp dport 80 accept
  }
}
table ip nat {
  chain prerouting {
    type nat hook prerouting priority dstnat;
    iifname "eth0" tcp dport 8080 dnat to 172.16.0.80:80
  }
  chain postrouting {
    type nat hook postrouting priority srcnat;
    oifname "eth0" masquerade
  }
}
EOF`);
  const sh = createShell(pc, 'linux');
  const wanRoot = createShell(wan, 'linux', 'root');
  wanRoot.run('nft add table ip t; nft add chain ip t input { type filter hook input priority 0 \\; }; nft add rule ip t input icmp type echo-request log prefix \\"IN \\"');
  assert.match(all(sh.run('ping -c 1 203.0.113.20')), / 0% packet loss/, 'the WAN server has no route back: only masquerade makes it work');
  assert.match(all(wanRoot.run('dmesg')), /IN IN=eth0 OUT= SRC=203\.0\.113\.1 DST=203\.0\.113\.20/, 'the WAN sees the router address');
  assert.match(all(sh.run('ping -c 1 172.16.0.80')), /100% packet loss/, 'LAN → DMZ not allowed by the forward chain');
  const wanSh = createShell(wan, 'linux');
  assert.match(all(wanSh.run('curl -s http://203.0.113.1:8080/')), /Servidor web de Netfix/, 'dnat publishes the DMZ web server');
  assert.match(all(wanSh.run('nc -z -w 1 203.0.113.1 22; echo $?')), /timed out|1$/);
  assert.match(all(root.run('nft list ruleset')), /oifname "eth0" masquerade/);
});

test('the router saves its NICs and routes; ip route add on hosts', () => {
  const { t, lr, pc } = lab();
  const root = createShell(lr, 'linux', 'root');
  root.run('ip route add 10.9.0.0/16 via 172.16.0.80');
  assert.match(all(root.run('ip route')), /10\.9\.0\.0\/16 via 172\.16\.0\.80 dev eth2/);
  const t2 = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const lr2 = t2.get(lr.id)?.device as LinuxRouter;
  assert.deepEqual(lr2.nics().map((n) => n.ip), [ip('203.0.113.1'), ip('192.168.1.1'), ip('172.16.0.1')]);
  assert.equal(lr2.staticRoutes.length, 1);
  const pcRoot = createShell(pc, 'linux', 'root');
  assert.deepEqual(pcRoot.run('ip route add 10.0.0.0/8 via 192.168.1.1; ip route'), [
    'default via 192.168.1.1 dev eth0 proto static metric 100',
    '10.0.0.0/8 via 192.168.1.1 dev eth0',
    '192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.10',
  ]);
  assert.deepEqual(pcRoot.run('ip route add 10.0.0.0/8 via 9.9.9.9'), ['Error: Nexthop has invalid gateway.']);
  assert.deepEqual(pcRoot.run('ip addr add 1.2.3.4/8 dev eth3'), ['Cannot find device "eth3"']);
});
