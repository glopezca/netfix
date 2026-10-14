/** nc -z and nmap against a firewalled server: open, closed (reject/no service) and filtered (drop). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;

function lab(): { srv: Server; pc: Pc } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  srv.setServices({ ...srv.services, ssh: { enabled: true, users: [{ name: 'admin', password: 'cisco' }] } });
  t.settle();
  createShell(srv, 'linux', 'root').run(`nft -f - <<'X'
table inet filter {
  chain input {
    type filter hook input priority filter; policy accept;
    tcp dport 25 reject with tcp reset
    tcp dport 8080 drop
  }
}
X`);
  return { srv, pc };
}

test('nc -z reports succeeded, refused and timed out', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.deepEqual(sh.run('nc -zv 10.0.0.2 22; echo $?'), ['Connection to 10.0.0.2 22 port [tcp/ssh] succeeded!', '0']);
  assert.deepEqual(sh.run('nc -zv 10.0.0.2 25'), ['nc: connect to 10.0.0.2 port 25 (tcp) failed: Connection refused']);
  assert.deepEqual(sh.run('nc -z -w 1 10.0.0.2 8080; echo $?'), ['nc: connect to 10.0.0.2 port 8080 (tcp) timed out: Operation now in progress', '1']);
  assert.deepEqual(sh.run('nc -zv 10.0.0.2 79-81').filter((l) => /succeeded/.test(l)), ['Connection to 10.0.0.2 80 port [tcp/http] succeeded!']);
});

test('nmap: open ports, a filtered one, collapsed closed ports; -sn sweep', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  const out = sh.run('nmap 10.0.0.2').join('\n');
  assert.match(out, /^Starting Nmap 7\.94SVN \( https:\/\/nmap\.org \) at \d{4}-\d\d-\d\d \d\d:\d\d UTC\nNmap scan report for 10\.0\.0\.2\nHost is up \(0\.00042s latency\)\.\nNot shown: 997 closed tcp ports \(conn-refused\)\nPORT     STATE    SERVICE\n22\/tcp   open     ssh\n80\/tcp   open     http\n8080\/tcp filtered http-proxy\n\nNmap done: 1 IP address \(1 host up\) scanned in [\d.]+ seconds$/);
  assert.match(sh.run('nmap -p 8080,8081 10.0.0.2').join('\n'), /PORT     STATE    SERVICE\n8080\/tcp filtered http-proxy\n8081\/tcp closed   blackice-icecap/);
  assert.match(sh.run('nmap -sn 10.0.0.0/28').join('\n'), /Nmap scan report for 10\.0\.0\.2\nHost is up[\s\S]*Nmap done: 16 IP addresses \(2 hosts up\)/);
  assert.match(sh.run('nmap -sn 10.0.0.0/16').join('\n'), /máximo \/24/);
});
