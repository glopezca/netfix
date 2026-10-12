/** ISP clouds and the emulated Internet: operator router, public lines, public DNS, two sites. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Server } from '../../src/devices/server.ts';
import { Session } from '../../src/ios/session.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';

const ip = (t: string): number => parseIp(t)!;
const sh = (h: Pc | Server, cmd: string): string => createShell(h, 'linux').run(cmd).join('\n');

function homeLab(): { t: Topology; cloud: Cloud; pc: Pc } {
  const t = new Topology();
  const cloud = t.add('cloud', 0, 0).device as Cloud;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: cloud.id, port: 'Fibra0' }, { device: pc.id, port: 'FastEthernet0' });
  pc.useDhcp();
  t.settle();
  return { t, cloud, pc };
}

test('operator router line: DHCP, NAT to the public address, public DNS and web', () => {
  const { pc, cloud } = homeLab();
  assert.equal(formatIp(cloud.settings.block), '81.32.0.0');
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.1.33');
  assert.equal(formatIp(pc.config.gateway ?? 0), '192.168.1.1');
  assert.equal(formatIp(pc.config.dns ?? 0), '8.8.8.8');
  assert.match(sh(pc, 'ping -c 2 8.8.8.8'), /2 received/);
  assert.match(sh(pc, 'host www.google.com'), /www\.google\.com has address 142\.250\.184\.4/);
  assert.match(sh(pc, 'host nada.invalid-tld-xyz.com'), /not found: 3\(NXDOMAIN\)/);
  assert.equal(sh(pc, 'curl -s ifconfig.me').trim(), '81.32.5.2', 'the web sees the NAT address of Fibra0');
  const trace = sh(pc, 'traceroute -n 8.8.8.8');
  const hops = [...trace.matchAll(/^ ?\d+ {2}(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(hops, ['192.168.1.1', '81.32.0.1', '198.51.100.1', '198.51.100.2', '142.250.0.1', '8.8.8.8']);
});

test('public line: a Cisco router gets x.y.n.2/29 by DHCP and does PAT for its LAN', () => {
  const t = new Topology();
  const cloud = t.add('cloud', 0, 0).device as Cloud;
  const r = t.add('router', 0, 0).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  cloud.setSettings({ ...cloud.settings, ports: { ...cloud.settings.ports, Coaxial0: { ...cloud.settings.ports.Coaxial0, mode: 'public' } } });
  t.connect({ device: cloud.id, port: 'Coaxial0' }, { device: r.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: r.id, port: 'GigabitEthernet0/0' });
  const s = new Session(r);
  s.mode = 'config';
  for (const l of ['interface g0/1', 'ip address dhcp', 'ip nat outside', 'no shutdown', 'interface g0/0', 'ip address 192.168.10.1 255.255.255.0', 'ip nat inside', 'no shutdown', 'exit',
    'access-list 1 permit 192.168.10.0 0.0.0.255', 'ip nat inside source list 1 interface GigabitEthernet0/1 overload']) s.input(l);
  pc.setStatic({ ip: ip('192.168.10.10'), prefix: 24, gateway: ip('192.168.10.1'), dns: ip('8.8.4.4') });
  t.settle();
  assert.equal(formatIp(r.plane.leases.get('GigabitEthernet0/1')?.ip ?? 0), '81.32.1.2');
  assert.match(createShell(pc, 'windows').run('ping -n 4 example.com').join('\n'), /Reply from 93\.184\.215\.14/);
  assert.equal(sh(pc, 'curl -s http://ifconfig.me/').trim(), '81.32.1.2');
});

function twoSites(kind: 'a' | 'ns'): { a: Pc; srv: Server; b: Cloud } {
  const t = new Topology();
  const ca = t.add('cloud', 0, 0).device as Cloud;
  const cb = t.add('cloud', 0, 0).device as Cloud;
  const a = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  t.connect({ device: ca.id, port: 'Fibra0' }, { device: a.id, port: 'FastEthernet0' });
  t.connect({ device: cb.id, port: 'DSL0' }, { device: srv.id, port: 'FastEthernet0' });
  const wan = ip('81.33.3.2');
  const forwards = [{ proto: 'tcp' as const, port: 80, ip: ip('192.168.1.10'), toPort: 80 }, { proto: 'udp' as const, port: 53, ip: ip('192.168.1.10'), toPort: 53 }];
  cb.setSettings({ ...cb.settings, ports: { ...cb.settings.ports, DSL0: { ...cb.settings.ports.DSL0, forwards } }, domains: [{ name: 'sede2.es', kind, ip: wan }] });
  srv.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1'), dns: ip('8.8.8.8') });
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, enabled: true, origin: 'sede2.es', records: [{ name: '@', type: 'A', value: '81.33.3.2', ttl: 3600 }, { name: 'intranet', type: 'A', value: '81.33.3.2', ttl: 3600 }] } });
  a.useDhcp();
  t.settle();
  return { a, srv, b: cb };
}

test('two sites: a registered domain (A) reaches a server published with port forwarding', () => {
  const { a } = twoSites('a');
  assert.match(sh(a, 'host www.sede2.es'), /www\.sede2\.es has address 81\.33\.3\.2/);
  const page = new BrowserEngine(a).open('http://www.sede2.es/');
  assert.equal(page.kind, 'page');
  assert.equal(page.kind === 'page' ? page.response.status : 0, 200);
});

test('two sites: delegation (NS) makes 8.8.8.8 ask the site\'s own DNS server', () => {
  const { a, srv } = twoSites('ns');
  assert.match(sh(a, 'host intranet.sede2.es'), /intranet\.sede2\.es has address 81\.33\.3\.2/);
  assert.match(sh(a, 'host nohay.sede2.es'), /NXDOMAIN/);
  assert.match(sh(srv, 'journalctl -u named'), /client 81\.32\.0\.0|query: intranet\.sede2\.es/);
  assert.match(sh(a, 'curl -sI http://intranet.sede2.es/ | head -1'), /200 OK/);
  assert.match(sh(a, 'curl -s http://81.33.3.2:8080/; echo rc=$?'), /rc=7/, 'closed port: connection refused');
});

test('lab «Internet: dos sedes» works end to end', async () => {
  const { EXAMPLES } = await import('../../src/net/examples.ts');
  const t = EXAMPLES.find((e) => e.id === 'internet')!.build();
  const pc0 = t.byLabel('PC0') as Pc;
  const pc1 = t.byLabel('PC1') as Pc;
  const r = t.byLabel('SEDE1') as Router;
  assert.equal(formatIp(r.plane.leases.get('GigabitEthernet0/1')?.ip ?? 0), '81.32.5.2');
  assert.match(createShell(pc0, 'windows').run('ping -n 4 www.sede2.es').join('\n'), /Reply from 81\.33\.3\.2/);
  const page = new BrowserEngine(pc0).open('http://www.sede2.es/');
  assert.equal(page.kind === 'page' ? page.response.status : page.kind, 200);
  assert.equal(sh(pc1, 'curl -s ifconfig.me').trim(), '81.32.5.2');
  assert.match(createShell(pc0, 'windows').run('tracert 8.8.8.8').join('\n'), /81\.32\.5\.1[\s\S]*81\.32\.0\.1[\s\S]*Trace complete/);
});

test('clouds are saved and restored with their lines, forwards and domains', async () => {
  const { EXAMPLES } = await import('../../src/net/examples.ts');
  const saved = JSON.parse(JSON.stringify(EXAMPLES.find((e) => e.id === 'internet')!.build().toJSON()));
  const t = Topology.fromJSON(saved);
  const sur = t.byLabel('ISP-Sur') as Cloud;
  assert.equal(sur.settings.isp, 'ISP-Sur');
  assert.deepEqual(sur.settings.domains.map((d) => [d.name, d.kind, formatIp(d.ip)]), [['sede2.es', 'ns', '81.33.3.2']]);
  assert.equal(sur.settings.ports.DSL0.forwards.length, 3);
  assert.equal((t.byLabel('ISP-Norte') as Cloud).settings.ports.Fibra0.mode, 'public');
  assert.match(sh(t.byLabel('PC1') as Pc, 'host www.sede2.es'), /has address 81\.33\.3\.2/);
});
