/** ISP clouds and the emulated Internet: operator router, public lines, public DNS, two sites. */
import { zonesFromLegacy } from '../../src/services/dns-zones.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Server } from '../../src/devices/server.ts';
import { Session } from '../../src/ios/session.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { portFromJson, portToJson, validatePort } from '../../src/devices/cloud-config.ts';
import { createShell } from '../../src/shells/factory.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';

const ip = (t: string): number => parseIp(t)!;
const sh = (h: Pc | Server, cmd: string): string => createShell(h, 'linux').run(cmd).join('\n');

function homeLab(): { t: Topology; cloud: Cloud; pc: Pc } {
  const t = new Topology();
  const cloud = t.add('cloud', 0, 0).device as Cloud;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: cloud.id, port: 'GigabitEthernet4' }, { device: pc.id, port: 'FastEthernet0' });
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
  assert.equal(sh(pc, 'curl -s ifconfig.me').trim(), '81.32.5.2', 'the web sees the NAT address of GigabitEthernet4');
  const trace = sh(pc, 'traceroute -n 8.8.8.8');
  const hops = [...trace.matchAll(/^ ?\d+ {2}(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(hops, ['192.168.1.1', '81.32.0.1', '198.51.100.1', '198.51.100.2', '142.250.0.1', '8.8.8.8']);
});

test('public line: a Cisco router gets x.y.n.2/29 by DHCP and does PAT for its LAN', () => {
  const t = new Topology();
  const cloud = t.add('cloud', 0, 0).device as Cloud;
  const r = t.add('router', 0, 0).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  cloud.setSettings({ ...cloud.settings, ports: { ...cloud.settings.ports, GigabitEthernet0: { ...cloud.settings.ports.GigabitEthernet0, mode: 'public' } } });
  t.connect({ device: cloud.id, port: 'GigabitEthernet0' }, { device: r.id, port: 'GigabitEthernet0/1' });
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
  t.connect({ device: ca.id, port: 'GigabitEthernet4' }, { device: a.id, port: 'FastEthernet0' });
  t.connect({ device: cb.id, port: 'GigabitEthernet2' }, { device: srv.id, port: 'FastEthernet0' });
  const wan = ip('81.33.3.2');
  const forwards = [{ proto: 'tcp' as const, port: 80, ip: ip('192.168.1.10'), toPort: 80 }, { proto: 'udp' as const, port: 53, ip: ip('192.168.1.10'), toPort: 53 }];
  cb.setSettings({ ...cb.settings, ports: { ...cb.settings.ports, GigabitEthernet2: { ...cb.settings.ports.GigabitEthernet2, forwards } }, domains: [{ name: 'sede2.es', kind, ip: wan }] });
  srv.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1'), dns: ip('8.8.8.8') });
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, enabled: true, zones: zonesFromLegacy('sede2.es', [{ name: '@', type: 'A', value: '81.33.3.2', ttl: 3600 }, { name: 'intranet', type: 'A', value: '81.33.3.2', ttl: 3600 }]) } });
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
  assert.equal(sur.settings.ports.GigabitEthernet2.forwards.length, 3);
  assert.equal((t.byLabel('ISP-Norte') as Cloud).settings.ports.GigabitEthernet4.mode, 'public');
  assert.match(sh(t.byLabel('PC1') as Pc, 'host www.sede2.es'), /has address 81\.33\.3\.2/);
});

test('DMZ (0.91.0): whatever is not forwarded goes to the exposed host — ping and its web — and the setting is checked and saved', () => {
  const t = new Topology();
  const ca = t.add('cloud', 0, 0).device as Cloud;
  const cb = t.add('cloud', 0, 0).device as Cloud;
  const a = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  t.connect({ device: ca.id, port: 'GigabitEthernet4' }, { device: a.id, port: 'FastEthernet0' });
  t.connect({ device: cb.id, port: 'GigabitEthernet2' }, { device: srv.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1'), dns: ip('8.8.8.8') });
  a.useDhcp();
  t.settle();
  // Without it, the router answers the ping itself and refuses the web.
  assert.match(sh(a, 'ping -c 1 81.33.3.2'), /ttl=25\d /, 'the router\'s own reply (TTL 255 minus the hops)');
  assert.match(sh(a, 'curl -s http://81.33.3.2/; echo rc=$?'), /rc=7/);
  cb.setSettings({ ...cb.settings, ports: { ...cb.settings.ports, GigabitEthernet2: { ...cb.settings.ports.GigabitEthernet2, dmz: ip('192.168.1.10') } } });
  t.settle();
  assert.match(sh(a, 'ping -c 1 81.33.3.2'), /1 received/);
  assert.match(sh(a, 'ping -c 1 81.33.3.2'), /ttl=[56]\d /, 'the exposed host answers (TTL 64 minus the hops), not the router');
  assert.match(sh(a, 'curl -sI http://81.33.3.2/ | head -1'), /200 OK/);
  const line = cb.settings.ports.GigabitEthernet2;
  assert.equal(portFromJson('GigabitEthernet2', JSON.parse(JSON.stringify(portToJson(line)))).dmz, ip('192.168.1.10'), 'saved with the lab');
  assert.ok(validatePort({ ...line, dmz: ip('10.0.0.5') }), 'outside the LAN');
  assert.ok(validatePort({ ...line, dmz: line.lanIp }), 'the router itself');
  assert.equal(portFromJson('GigabitEthernet2', { ...JSON.parse(JSON.stringify(portToJson(line))), dmz: '8.8.8.8' }).dmz, undefined, 'a bad one in a file: the defaults');
});

test('0.96.0: the cloud\'s ports are Ethernet; each line\'s WAN access is a setting (xDSL with its ATM circuit)', async () => {
  const { CLOUD_PORTS, LEGACY_CLOUD_PORTS } = await import('../../src/devices/cloud-config.ts');
  const { pc, cloud, t } = homeLab();
  assert.deepEqual([...cloud.portNames()], ['GigabitEthernet0', 'GigabitEthernet1', 'GigabitEthernet2', 'GigabitEthernet3', 'GigabitEthernet4', 'GigabitEthernet5']);
  assert.deepEqual(CLOUD_PORTS.map((p) => cloud.settings.ports[p].wan.kind), ['cable', 'cable', 'xdsl', 'xdsl', 'fttx', 'fttx'], 'by place, as the old names said');
  assert.deepEqual(cloud.settings.ports.GigabitEthernet2.wan.pvc, { vpi: 8, vci: 32 });
  const line = cloud.settings.ports.GigabitEthernet2;
  assert.ok(validatePort({ ...line, wan: { kind: 'xdsl', pvc: { vpi: 300, vci: 32 } } }), 'VPI out of range');
  assert.ok(validatePort({ ...line, wan: { kind: 'fttx', pvc: { vpi: 8, vci: 32 } } }), 'a circuit only on xDSL');
  assert.equal(validatePort({ ...line, wan: { kind: 'xdsl', pvc: { vpi: 0, vci: 33 } } }), null);
  const saved = { ...line, wan: { kind: 'xdsl' as const, pvc: { vpi: 1, vci: 40 } } };
  assert.deepEqual(portFromJson('GigabitEthernet2', JSON.parse(JSON.stringify(portToJson(saved)))).wan, saved.wan, 'saved with the lab');
  // A lab saved before 0.96.0: ports named after their access, no `wan` — each link and setting lands on its line.
  const file = JSON.parse(JSON.stringify(t.toJSON())) as { devices: { kind: string; cloud?: { ports: Record<string, unknown> } }[]; links: { a: { port: string }; b: { port: string } }[] };
  const old = Object.fromEntries(Object.entries(LEGACY_CLOUD_PORTS).map(([k, v]) => [v, k]));
  for (const d of file.devices) if (d.kind === 'cloud' && d.cloud) {
    d.cloud.ports = Object.fromEntries(Object.entries(d.cloud.ports).map(([k, v]) => { const { wan: _w, ...rest } = v as Record<string, unknown>; return [old[k] ?? k, { ...rest, down: 77 }]; }));
  }
  for (const l of file.links) for (const e of [l.a, l.b]) if (/^GigabitEthernet\d$/.test(e.port)) e.port = old[e.port] ?? e.port;
  assert.ok(file.links.some((l) => l.a.port === 'Fibra0' || l.b.port === 'Fibra0'), 'the PC was on Fibra0');
  const back = Topology.fromJSON(file);
  const c2 = [...back.placed.values()].find((p) => p.device.kind === 'cloud')!.device as Cloud;
  assert.equal(c2.settings.ports.GigabitEthernet4.down, 77, 'Fibra0\'s settings on GigabitEthernet4');
  assert.equal(c2.settings.ports.GigabitEthernet4.wan.kind, 'fttx');
  const pc2 = [...back.placed.values()].find((p) => p.device.kind === 'pc')!.device as Pc;
  assert.match(sh(pc2, 'ping -c 1 8.8.8.8'), /1 received/, 'the PC on the old Fibra0 still reaches the Internet');
  assert.ok(pc);
});
