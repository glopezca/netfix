/** traceroute (Linux), tracert (Windows) and IOS traceroute over two routers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { Session } from '../../src/ios/session.ts';
import type { IosDevice } from '../../src/ios/device.ts';
import { parseIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';

function cli(d: IosDevice, mode: 'config' | 'exec', ...lines: string[]): string[] {
  const s = new Session(d);
  s.mode = mode;
  return lines.flatMap((l) => s.input(l));
}

function lab(): { r1: Router; pc: Pc; out: Pc } {
  const t = new Topology();
  const r1 = t.add('router', 0, 0).device as Router;
  const r2 = t.add('router', 0, 0).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  const out = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: r1.id, port: 'GigabitEthernet0/0' }, { device: pc.id, port: 'FastEthernet0' });
  t.connect({ device: r1.id, port: 'GigabitEthernet0/1' }, { device: r2.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: r2.id, port: 'GigabitEthernet0/1' }, { device: out.id, port: 'FastEthernet0' });
  cli(r1, 'config', 'interface g0/0', 'ip address 192.168.10.1 255.255.255.0', 'no shutdown', 'interface g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.0.2');
  cli(r2, 'config', 'interface g0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown', 'interface g0/1', 'ip address 10.0.1.1 255.255.255.0', 'no shutdown', 'exit', 'ip route 192.168.10.0 255.255.255.0 10.0.0.1');
  pc.setStatic({ ip: parseIp('192.168.10.10')!, prefix: 24, gateway: parseIp('192.168.10.1')! });
  out.setStatic({ ip: parseIp('10.0.1.10')!, prefix: 24, gateway: parseIp('10.0.1.1')! });
  t.settle();
  createShell(pc, 'windows').run('ping -n 4 10.0.1.10');
  return { r1, pc, out };
}

test('GNU/Linux traceroute lists every router and ends at the destination', () => {
  const { pc } = lab();
  const out = createShell(pc, 'linux').run('traceroute 10.0.1.10').join('\n');
  assert.match(out, /^traceroute to 10\.0\.1\.10 \(10\.0\.1\.10\), 30 hops max, 60 byte packets$/m);
  assert.match(out, /^ 1  _gateway \(192\.168\.10\.1\)  \d+\.\d{3} ms  \d+\.\d{3} ms  \d+\.\d{3} ms$/m);
  assert.match(out, /^ 2  10\.0\.0\.2 \(10\.0\.0\.2\)  /m);
  assert.match(out, /^ 3  10\.0\.1\.10 \(10\.0\.1\.10\)  /m);
  assert.doesNotMatch(out, /^ 4 /m);
  assert.match(createShell(pc, 'linux').run('traceroute -n 10.0.1.10').join('\n'), /^ 1  192\.168\.10\.1  \d/m);
});

test('Windows tracert and IOS traceroute', () => {
  const { pc, r1 } = lab();
  const w = createShell(pc, 'windows').run('tracert 10.0.1.10').join('\n');
  assert.match(w, /Tracing route to 10\.0\.1\.10 over a maximum of 30 hops/);
  assert.match(w, /^ {2}1 +(<1|\d+) ms +(<1|\d+) ms +(<1|\d+) ms {2}192\.168\.10\.1$/m);
  assert.match(w, /^ {2}3 .* {2}10\.0\.1\.10$/m);
  assert.match(w, /Trace complete\./);
  const ios = cli(r1, 'exec', 'traceroute 10.0.1.10').join('\n');
  assert.match(ios, /Tracing the route to 10\.0\.1\.10/);
  assert.match(ios, /^ {2}1 10\.0\.0\.2 \d+ msec \d+ msec \d+ msec$/m);
  assert.match(ios, /^ {2}2 10\.0\.1\.10 /m);
});
