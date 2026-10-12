/** IOS NAT on the 2911: standard ACLs, PAT on the outside interface, pools, static port mappings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { Session, applyConfig } from '../../src/ios/session.ts';
import type { IosDevice } from '../../src/ios/device.ts';
import { parseIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';

function cli(d: IosDevice, mode: 'config' | 'exec', ...lines: string[]): string[] {
  const s = new Session(d);
  s.mode = mode;
  return lines.flatMap((l) => s.input(l));
}

const ip = (t: string): number => parseIp(t)!;

/**
 *  PC 192.168.10.10 ─┐                                   ┌─ OUT 10.0.1.10
 *  WEB 192.168.10.20 ┴─ G0/0 R1 G0/1 ── 10.0.0.0/30 ── G0/0 R2 G0/1
 *        (inside)               (outside)        R2 knows nothing about 192.168.10.0/24
 */
function lab(): { t: Topology; r1: Router; r2: Router; pc: Pc; web: Server; out: Pc } {
  const t = new Topology();
  const r1 = t.add('router', 0, 0).device as Router;
  const r2 = t.add('router', 0, 0).device as Router;
  const sw = t.add('switch', 0, 0).device;
  const pc = t.add('pc', 0, 0).device as Pc;
  const web = t.add('server', 0, 0).device as Server;
  const out = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: r1.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'FastEthernet0/1' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/2' });
  t.connect({ device: web.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/3' });
  t.connect({ device: r1.id, port: 'GigabitEthernet0/1' }, { device: r2.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: r2.id, port: 'GigabitEthernet0/1' }, { device: out.id, port: 'FastEthernet0' });
  cli(r1, 'config', 'hostname R1', 'interface g0/0', 'ip address 192.168.10.1 255.255.255.0', 'ip nat inside', 'no shutdown',
    'interface g0/1', 'ip address 10.0.0.1 255.255.255.252', 'ip nat outside', 'no shutdown', 'exit', 'ip route 0.0.0.0 0.0.0.0 10.0.0.2');
  cli(r2, 'config', 'hostname R2', 'interface g0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown',
    'interface g0/1', 'ip address 10.0.1.1 255.255.255.0', 'no shutdown');
  pc.setStatic({ ip: ip('192.168.10.10'), prefix: 24, gateway: ip('192.168.10.1') });
  web.setStatic({ ip: ip('192.168.10.20'), prefix: 24, gateway: ip('192.168.10.1') });
  out.setStatic({ ip: ip('10.0.1.10'), prefix: 24, gateway: ip('10.0.1.1') });
  t.settle();
  return { t, r1, r2, pc, web, out };
}

const ping = (h: Pc, target: string): string => createShell(h, 'windows').run(`ping -n 4 ${target}`).join('\n');

test('without NAT the far side cannot answer; PAT on the outside interface fixes it', () => {
  const { r1, pc } = lab();
  assert.match(ping(pc, '10.0.1.10'), /Request timed out/);
  assert.deepEqual(cli(r1, 'config', 'access-list 1 permit 192.168.10.0 0.0.0.255', 'ip nat inside source list 1 interface GigabitEthernet0/1 overload'), []);
  assert.match(ping(pc, '10.0.1.10'), /Reply from 10\.0\.1\.10/);
  const tr = cli(r1, 'exec', 'show ip nat translations').join('\n');
  assert.match(tr, /^Pro  Inside global\s+Inside local\s+Outside local\s+Outside global$/m);
  assert.match(tr, /^icmp 10\.0\.0\.1:\d+\s+192\.168\.10\.10:\d+\s+10\.0\.1\.10:\d+\s+10\.0\.1\.10:\d+$/m);
  const stats = cli(r1, 'exec', 'show ip nat statistics').join('\n');
  assert.match(stats, /Outside interfaces:\n  GigabitEthernet0\/1/);
  assert.match(stats, /\[Id: 1\] access-list 1 interface GigabitEthernet0\/1 refcount 1/);
  assert.match(cli(r1, 'exec', 'show access-lists').join('\n'), /Standard IP access list 1\n    10 permit 192\.168\.10\.0, wildcard bits 0\.0\.0\.255 \(\d+ match\(es\)\)/);
  cli(r1, 'exec', 'clear ip nat translation *');
  assert.equal(r1.natTable.entries().length, 0);
});

test('running-config keeps NAT and ACLs, and reloading it restores them', () => {
  const { r1 } = lab();
  cli(r1, 'config', 'ip access-list standard LAN', 'permit 192.168.10.0 0.0.0.255', 'deny any', 'exit',
    'ip nat pool PUB 10.0.0.1 10.0.0.1 netmask 255.255.255.252', 'ip nat inside source list LAN pool PUB overload',
    'ip nat inside source static tcp 192.168.10.20 80 interface GigabitEthernet0/1 8080');
  const run = r1.runningConfig();
  for (const l of ['ip access-list standard LAN', ' permit 192.168.10.0 0.0.0.255', ' deny any', ' ip nat inside', ' ip nat outside',
    'ip nat pool PUB 10.0.0.1 10.0.0.1 netmask 255.255.255.252', 'ip nat inside source list LAN pool PUB overload',
    'ip nat inside source static tcp 192.168.10.20 80 interface GigabitEthernet0/1 8080']) assert.ok(run.includes(l), l);
  r1.resetConfig();
  assert.deepEqual(applyConfig(r1, run), []);
  assert.deepEqual(r1.runningConfig(), run);
});

test('static port mapping publishes an inside web server; debug ip nat logs it', () => {
  const { r1, out } = lab();
  cli(r1, 'config', 'ip nat inside source static tcp 192.168.10.20 80 interface GigabitEthernet0/1 80');
  cli(r1, 'exec', 'debug ip nat');
  const logs: string[] = [];
  r1.onConsole((l) => logs.push(l));
  const page = createShell(out, 'linux').run('curl -sI http://10.0.0.1/ | head -1').join('\n');
  assert.match(page, /HTTP\/1\.1 200 OK/);
  assert.ok(logs.some((l) => /^NAT: s=10\.0\.1\.10, d=10\.0\.0\.1->192\.168\.10\.20 \[\d+\]$/.test(l)), logs.join('\n'));
  assert.match(cli(r1, 'exec', 'show ip nat translations').join('\n'), /^tcp  10\.0\.0\.1:80\s+192\.168\.10\.20:80\s+---\s+---$/m);
});

test('dynamic pool without overload binds one global address per inside host', () => {
  const { r1, r2, pc } = lab();
  cli(r2, 'config', 'ip route 10.0.0.8 255.255.255.248 10.0.0.1');
  cli(r1, 'config', 'access-list 1 permit host 192.168.10.10', 'ip nat pool P 10.0.0.9 10.0.0.10 prefix-length 29', 'ip nat inside source list 1 pool P');
  const p = ping(pc, '10.0.1.10');
  assert.match(p, /Reply from 10\.0\.1\.10/, p + cli(r1, 'exec', 'show ip nat translations', 'show ip nat statistics').join('\n') + cli(r2, 'exec', 'show ip route', 'show arp').join('\n'));
  assert.match(cli(r1, 'exec', 'show ip nat translations').join('\n'), /^---  10\.0\.0\.9\s+192\.168\.10\.10\s+---\s+---$/m);
  assert.match(cli(r1, 'exec', 'show ip nat statistics').join('\n'), /total addresses 2, allocated 1 \(50%\)/);
});
