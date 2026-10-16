/** Regression tests for the phase-8 ECC review (NAT engine, clouds from files, DNS loops, browser, glob). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NatTable } from '../../src/net/nat.ts';
import type { IpPacket } from '../../src/net/packets.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';
import { Topology } from '../../src/net/topology.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Server } from '../../src/devices/server.ts';
import { validateCloud, cloudFromJson } from '../../src/devices/cloud-config.ts';
import { matchPattern } from '../../src/bash/glob.ts';
import { createShell } from '../../src/shells/factory.ts';
import { Session } from '../../src/ios/session.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';

const ip = (t: string): number => parseIp(t)!;
const tcp = (src: string, sport: number, dst: string, dport: number): IpPacket => ({ src: ip(src), dst: ip(dst), ttl: 64, protocol: 'tcp', tcp: { sport, dport, flags: ['SYN'], seq: 1, ack: 0 } });

test('NAT: a port mapping wins over PAT, PAT never takes a published port, ICMP ids are translated', () => {
  const nat = new NatTable();
  const statics = [{ local: ip('192.168.1.10'), global: ip('81.32.1.2'), proto: 'tcp' as const, localPort: 80, globalPort: 80 }];
  const pat = () => ({ global: ip('81.32.1.2'), overload: true });
  const out = nat.inside(tcp('192.168.1.20', 80, '8.8.8.8', 443), statics, pat);
  assert.ok(out && out !== 'drop');
  assert.notEqual(out.tcp?.sport, 80, 'source port 80 is published: PAT picks another one');
  const inbound = nat.outside(tcp('9.9.9.9', 5000, '81.32.1.2', 80), statics);
  assert.equal(formatIp(inbound?.dst ?? 0), '192.168.1.10');
  const ping: IpPacket = { src: ip('192.168.1.20'), dst: ip('8.8.8.8'), ttl: 64, protocol: 'icmp', icmp: { type: 'echo-request', id: 7, seq: 1 } };
  const sent = nat.inside(ping, statics, pat);
  assert.ok(sent && sent !== 'drop' && sent.icmp?.id === 7);
  const back = nat.outside({ src: ip('8.8.8.8'), dst: ip('81.32.1.2'), ttl: 60, protocol: 'icmp', icmp: { type: 'echo-reply', id: 7, seq: 1 } }, statics);
  assert.equal(formatIp(back?.dst ?? 0), '192.168.1.20');
  assert.equal(nat.inside(tcp('192.168.1.30', 1, '8.8.8.8', 1), [], () => 'exhausted'), 'drop');
  assert.equal(nat.inside(tcp('192.168.1.30', 1, '8.8.8.8', 1), [], () => null), null);
  nat.reset();
  assert.deepEqual([nat.entries().length, nat.hits, nat.misses], [0, 0, 0]);
});

test('IOS NAT: an exhausted 1:1 pool drops instead of leaking private addresses; reload clears NAT, ACL and HTTP', () => {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const s = new Session(r);
  s.mode = 'config';
  for (const l of ['interface g0/0', 'ip address 192.168.1.1 255.255.255.0', 'ip nat inside', 'no shutdown', 'interface g0/1', 'ip address 10.0.0.1 255.255.255.0', 'ip nat outside', 'no shutdown', 'exit',
    'access-list 1 permit any', 'ip nat pool ONE 10.0.0.50 10.0.0.50 prefix-length 24', 'ip nat inside source list 1 pool ONE', 'ip http server']) s.input(l);
  const first = r.natTable.inside(tcp('192.168.1.2', 1000, '10.0.0.9', 80), [], () => ({ global: ip('10.0.0.50'), overload: false, rule: 0 }));
  assert.ok(first && first !== 'drop');
  assert.equal(s.input('ip nat inside source list 1 pool NOPE')[0], '%Pool NOPE not found');
  r.resetConfig();
  assert.deepEqual([r.natTable.entries().length, r.acls.size, r.nat.dynamic.length, r.http.server, r.web.listeningPort()], [0, 0, 0, false, undefined]);
});

test('clouds: reserved or duplicate public blocks and NS delegation to the emulated Internet are refused', () => {
  const t = new Topology();
  const a = t.add('cloud', 0, 0).device as Cloud;
  const b = t.add('cloud', 0, 0).device as Cloud;
  assert.match(validateCloud({ ...b.settings, block: a.settings.block }, b.otherBlocks()) ?? '', /ya lo usa otra nube/);
  assert.match(validateCloud({ ...b.settings, block: ip('8.8.0.0') }) ?? '', /Internet emulada/);
  assert.match(validateCloud({ ...b.settings, domains: [{ name: 'x.es', kind: 'ns', ip: ip('8.8.8.8') }] }) ?? '', /no es una dirección pública/);
  const loaded = cloudFromJson({ isp: 'X', block: '81.40.0.0', domains: [{ name: 'evil.es', kind: 'ns', ip: '8.8.8.8' }] }, b.settings);
  assert.deepEqual(loaded.domains, []);
  const file = t.toJSON();
  const twin = { ...file, devices: file.devices.map((d) => (d.kind === 'cloud' ? { ...d, cloud: { ...(d.cloud as object), block: '81.32.0.0' } } : d)) };
  const blocks = [...Topology.fromJSON(JSON.parse(JSON.stringify(twin))).placed.values()].map((p) => formatIp((p.device as Cloud).settings.block));
  assert.equal(new Set(blocks).size, 2, `distinct blocks after load: ${blocks.join(', ')}`);
});

test('a domain delegated to 8.8.8.8 answers SERVFAIL instead of looping forever', () => {
  const t = new Topology();
  const c = t.add('cloud', 0, 0).device as Cloud;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: c.id, port: 'Fibra0' }, { device: pc.id, port: 'FastEthernet0' });
  c.setSettings({ ...c.settings, domains: [{ name: 'evil.es', kind: 'ns', ip: ip('8.8.8.8') }] });
  pc.useDhcp();
  t.settle();
  assert.match(createShell(pc, 'linux').run('dig www.evil.es').join('\n'), /status: SERVFAIL/);
  t.settle(5000);
  assert.ok(t.net.pending() < 20, `queue drained (${t.net.pending()} tasks left)`);
});

test('a redirect to another site does not carry the saved router password', () => {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const sw = t.add('switch', 0, 0).device;
  const pc = t.add('pc', 0, 0).device as Pc;
  const srv = t.add('server', 0, 0).device as Server;
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'FastEthernet0/1' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/2' });
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/3' });
  const s = new Session(r);
  s.mode = 'config';
  for (const l of ['interface g0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'exit', 'enable secret class', 'ip http server']) s.input(l);
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24 });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  t.settle();
  createShell(srv, 'linux', 'root').run('echo "Redirect /trampa http://10.0.0.1/level/15/configure/-" >> /etc/apache2/apache2.conf; systemctl reload apache2');
  const web = new BrowserEngine(pc);
  assert.equal(web.login('http://10.0.0.1/', 'x', 'class').kind, 'page');
  assert.equal(web.open('http://10.0.0.2/trampa').kind, 'auth', 'the router asks again: no password sent across sites');
  assert.equal(web.open('http://10.0.0.1/level/15/configure/-').kind, 'page', 'typed URL still logged in');
});

test('plain wildcards match in linear time; cp refuses to copy a directory into itself', () => {
  const start = Date.now();
  assert.equal(matchPattern(`${'*a'.repeat(12)}*b`, 'a'.repeat(255)), false);
  assert.ok(Date.now() - start < 200);
  assert.ok(matchPattern('*.conf', 'site.conf') && matchPattern('[!.]*', 'x') && !matchPattern('*/x', 'a/b', { pathname: true }));
  const t = new Topology();
  const pc = t.add('pc', 0, 0).device as Pc;
  const out = createShell(pc, 'linux').run('mkdir -p /tmp/a/b; cp -r /tmp/a /tmp/a/b; echo rc=$?').join('\n');
  assert.match(out, /cannot copy a directory, '\/tmp\/a', into itself, '\/tmp\/a\/b\/a'[\s\S]*rc=1/);
});

test('operator router with a small LAN (/29) hands out addresses inside it', () => {
  const t = new Topology();
  const c = t.add('cloud', 0, 0).device as Cloud;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: c.id, port: 'DSL1' }, { device: pc.id, port: 'FastEthernet0' });
  c.setSettings({ ...c.settings, ports: { ...c.settings.ports, DSL1: { ...c.settings.ports.DSL1, lanIp: ip('192.168.5.6'), lanPrefix: 29 } } });
  pc.useDhcp();
  t.settle();
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.5.2');
  assert.equal(formatIp(pc.config.gateway ?? 0), '192.168.5.6');
});

test('a topology file bounds labels and IOS configuration (lines and their length)', () => {
  const base = { id: 'r', kind: 'router', x: 0, y: 0, seed: 1, label: 'R' };
  const file = (d: object): unknown => ({ format: 'netfix', version: 2, devices: [{ ...base, ...d }], links: [] });
  assert.throws(() => Topology.fromJSON(file({ label: 'x'.repeat(200) })));
  assert.throws(() => Topology.fromJSON(file({ config: Array.from({ length: 20_001 }, () => '!') })));
  assert.throws(() => Topology.fromJSON(file({ config: ['x'.repeat(5000)] })));
  assert.throws(() => Topology.fromJSON(file({ startup: 'hostname X' })));
  assert.equal(Topology.fromJSON(file({ config: ['hostname Aula'], startup: ['hostname Aula'] })).placed.size, 1);
});
