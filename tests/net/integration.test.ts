import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Router } from '../../src/devices/router.ts';
import { Switch } from '../../src/devices/switch.ts';
import { Pc } from '../../src/devices/pc.ts';
import { pcCommand } from '../../src/devices/pc-console.ts';
import { applyConfig, Session } from '../../src/ios/session.ts';
import { formatIp, parseIp } from '../../src/core/ip.ts';

function cfg(dev: Router | Switch, text: string): void {
  const errors = applyConfig(dev, text.trim().split('\n'));
  assert.deepEqual(errors, []);
}

function exec(dev: Router | Switch, line: string): string[] {
  const s = new Session(dev);
  s.mode = 'exec';
  return s.input(line);
}

/** R0 — S0 — PC0, PC1 (one LAN). */
function lan(): { t: Topology; r: Router; s: Switch; pcs: Pc[] } {
  const t = new Topology();
  const r = t.add('router', 300, 100).device as Router;
  const s = t.add('switch', 300, 250).device as Switch;
  const pcs = [t.add('pc', 200, 400).device as Pc, t.add('pc', 400, 400).device as Pc];
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: s.id, port: 'GigabitEthernet0/1' });
  pcs.forEach((pc, i) => t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: s.id, port: `FastEthernet0/${i + 1}` }));
  return { t, r, s, pcs };
}

const LAN_CONFIG = `
hostname GW
ip dhcp excluded-address 192.168.1.1 192.168.1.10
ip dhcp pool LAN
 network 192.168.1.0 255.255.255.0
 default-router 192.168.1.1
 dns-server 8.8.8.8
 domain-name lab.local
interface GigabitEthernet0/0
 ip address 192.168.1.1 255.255.255.0
 no shutdown
`;

test('PCs get addresses by DHCP through a switch (full DORA)', () => {
  const { t, r, pcs } = lan();
  cfg(r, LAN_CONFIG);
  pcs.forEach((pc) => pc.useDhcp());
  t.settle();
  assert.equal(pcs[0]!.dhcpStatus, 'ok');
  assert.equal(formatIp(pcs[0]!.config.ip!), '192.168.1.11');
  assert.equal(formatIp(pcs[1]!.config.ip!), '192.168.1.12');
  assert.equal(formatIp(pcs[0]!.config.gateway!), '192.168.1.1');
  assert.equal(formatIp(pcs[0]!.config.dns!), '8.8.8.8');
  const protocols = new Set(t.net.history.map((e) => e.protocol));
  assert.ok(protocols.has('DHCP'));
  const dhcpTypes = t.net.history.flatMap((e) => (e.frame.ip?.udp?.dhcp ? [e.frame.ip.udp.dhcp.options.messageType] : []));
  for (const type of ['DISCOVER', 'OFFER', 'REQUEST', 'ACK']) assert.ok(dhcpTypes.includes(type as never), `missing ${type}`);
  const binding = exec(r, 'show ip dhcp binding').join('\n');
  assert.match(binding, /192\.168\.1\.11\s+01/);
  const ipconfig = pcCommand(pcs[0]!, 'ipconfig /all').join('\n');
  assert.match(ipconfig, /IPv4 Address\.+: 192\.168\.1\.11/);
  assert.match(ipconfig, /DHCP Servers\.+: 192\.168\.1\.1/);
  assert.match(ipconfig, /Connection-specific DNS Suffix\.\.: lab\.local/);
});

test('ping between PCs and to the gateway; router ping shows .!!!!', () => {
  const { t, r, pcs } = lan();
  cfg(r, LAN_CONFIG);
  pcs.forEach((pc) => pc.useDhcp());
  t.settle();
  const out = pcCommand(pcs[0]!, 'ping 192.168.1.12').join('\n');
  assert.match(out, /Reply from 192\.168\.1\.12: bytes=32 time<1ms TTL=128/);
  assert.match(out, /Received = 4, Lost = 0/);
  const gw = pcCommand(pcs[0]!, 'ping -n 2 192.168.1.1').join('\n');
  assert.match(gw, /TTL=255/);
  const rping = exec(r, 'ping 192.168.1.12');
  assert.ok(rping.includes('!!!!!') || rping.includes('.!!!!'), rping.join('\n'));
  assert.match(exec(r, 'show arp').join('\n'), /Internet  192\.168\.1\.12\s+0\s+\S+\s+ARPA   GigabitEthernet0\/0/);
  assert.match(pcCommand(pcs[0]!, 'arp -a').join('\n'), /192\.168\.1\.1/);
});

test('manual bindings: client-identifier and hardware-address host pools', () => {
  const { t, r, pcs } = lan();
  const [a, b] = pcs as [Pc, Pc];
  const cid = `01${a.mac}`.match(/.{1,4}/g)!.join('.');
  const mac = b.mac.match(/.{1,4}/g)!.join('.');
  cfg(r, `${LAN_CONFIG}
ip dhcp pool PC0-FIJO
 host 192.168.1.100 255.255.255.0
 client-identifier ${cid}
ip dhcp pool PC1-FIJO
 host 192.168.1.101 255.255.255.0
 hardware-address ${mac}`);
  pcs.forEach((pc) => pc.useDhcp());
  t.settle();
  assert.equal(formatIp(a.config.ip!), '192.168.1.100');
  assert.equal(formatIp(b.config.ip!), '192.168.1.101');
  assert.equal(formatIp(a.config.gateway!), '192.168.1.1', 'inherits default-router');
  assert.match(exec(r, 'show ip dhcp binding').join('\n'), /192\.168\.1\.100\s+\S+\s+Infinite\s+Manual/);
});

test('address … hardware-address / client-id reservations inside the network pool', () => {
  const { t, r, pcs } = lan();
  const [a, b] = pcs as [Pc, Pc];
  cfg(r, `${LAN_CONFIG.replace(' domain-name lab.local', ` domain-name lab.local
 address 192.168.1.50 hardware-address ${a.mac.match(/.{1,4}/g)!.join('.')}
 address 192.168.1.51 client-id ${`01${b.mac}`.match(/.{1,4}/g)!.join('.')}`)}`);
  pcs.forEach((pc) => pc.useDhcp());
  t.settle();
  assert.equal(formatIp(a.config.ip!), '192.168.1.50');
  assert.equal(formatIp(b.config.ip!), '192.168.1.51');
});

test('DHCP relay with ip helper-address across two routers', () => {
  const t = new Topology();
  const server = t.add('router', 0, 0).device as Router;
  const edge = t.add('router', 0, 0).device as Router;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: server.id, port: 'GigabitEthernet0/0' }, { device: edge.id, port: 'GigabitEthernet0/0' });
  t.connect({ device: edge.id, port: 'GigabitEthernet0/1' }, { device: sw.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  cfg(server, `
hostname SERVER
ip dhcp excluded-address 10.2.2.1
ip dhcp pool REMOTA
 network 10.2.2.0 255.255.255.0
 default-router 10.2.2.1
interface GigabitEthernet0/0
 ip address 10.0.0.1 255.255.255.252
 no shutdown
ip route 10.2.2.0 255.255.255.0 10.0.0.2`);
  cfg(edge, `
hostname EDGE
interface GigabitEthernet0/0
 ip address 10.0.0.2 255.255.255.252
 no shutdown
interface GigabitEthernet0/1
 ip address 10.2.2.1 255.255.255.0
 ip helper-address 10.0.0.1
 no shutdown`);
  server.dhcp.debugPacket = true;
  edge.dhcp.debugPacket = true;
  const logs: string[] = [];
  server.onConsole((l) => logs.push(l));
  edge.onConsole((l) => logs.push(l));
  pc.useDhcp();
  t.settle();
  assert.equal(pc.dhcpStatus, 'ok');
  assert.equal(formatIp(pc.config.ip!), '10.2.2.2');
  assert.equal(formatIp(pc.config.gateway!), '10.2.2.1');
  assert.ok(logs.some((l) => l.includes('through relay 10.2.2.1')), logs.join('\n'));
  assert.ok(logs.some((l) => l.includes('DHCPD: setting giaddr to 10.2.2.1.')));
  assert.match(pcCommand(pc, 'ping 10.0.0.1').join('\n'), /Received = 4/);
});

test('router interface as DHCP client: ip address dhcp, default route and client-identifier', () => {
  const t = new Topology();
  const isp = t.add('router', 0, 0).device as Router;
  const cpe = t.add('router', 0, 0).device as Router;
  t.connect({ device: isp.id, port: 'GigabitEthernet0/0' }, { device: cpe.id, port: 'GigabitEthernet0/1' });
  const cid = cpe.plane.clientIdText('GigabitEthernet0/1');
  assert.match(cid, /^0063\.6973\.636f\.2d/, 'cisco-<mac>-Gi0/1 client id');
  cfg(isp, `
hostname ISP
ip dhcp pool WAN
 network 100.64.0.0 255.255.255.0
 default-router 100.64.0.1
ip dhcp pool CPE
 host 100.64.0.77 255.255.255.0
 client-identifier ${cid}
interface GigabitEthernet0/0
 ip address 100.64.0.1 255.255.255.0
 no shutdown`);
  const logs: string[] = [];
  cpe.onConsole((l) => logs.push(l));
  cfg(cpe, `
hostname CPE
interface GigabitEthernet0/1
 ip address dhcp
 no shutdown`);
  t.settle();
  assert.ok(logs.some((l) => l.startsWith('%DHCP-6-ADDRESS_ASSIGN: Interface GigabitEthernet0/1 assigned DHCP address 100.64.0.77, mask 255.255.255.0, hostname CPE')), logs.join('\n'));
  assert.match(exec(cpe, 'show ip interface brief').join('\n'), /GigabitEthernet0\/1\s+100\.64\.0\.77\s+YES DHCP\s+up\s+up/);
  assert.match(exec(cpe, 'show ip route').join('\n'), /S\*\s+0\.0\.0\.0\/0 \[254\/0\] via 100\.64\.0\.1/);
  assert.match(exec(cpe, 'show dhcp lease').join('\n'), /Temp IP addr: 100\.64\.0\.77/);
  exec(cpe, 'release dhcp GigabitEthernet0/1');
  t.settle(100);
  assert.doesNotMatch(exec(isp, 'show ip dhcp binding').join('\n'), /100\.64\.0\.77.*Automatic/);
  exec(cpe, 'renew dhcp g0/1');
  t.settle();
  assert.equal(formatIp(cpe.dhcpLearned('GigabitEthernet0/1')!.ip), '100.64.0.77');
});

test('router-on-a-stick: subinterfaces, trunk and one pool per VLAN', () => {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const sw = t.add('switch', 0, 0).device as Switch;
  const p10 = t.add('pc', 0, 0).device as Pc;
  const p20 = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: p10.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  t.connect({ device: p20.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/2' });
  cfg(sw, `
vlan 10
 name VENTAS
vlan 20
interface FastEthernet0/1
 switchport mode access
 switchport access vlan 10
interface FastEthernet0/2
 switchport access vlan 20
interface GigabitEthernet0/1
 switchport mode trunk`);
  cfg(r, `
ip dhcp pool V10
 network 10.10.0.0 255.255.255.0
 default-router 10.10.0.1
ip dhcp pool V20
 network 10.20.0.0 255.255.255.0
 default-router 10.20.0.1
ip dhcp excluded-address 10.10.0.1
ip dhcp excluded-address 10.20.0.1
interface GigabitEthernet0/0
 no shutdown
interface GigabitEthernet0/0.10
 encapsulation dot1Q 10
 ip address 10.10.0.1 255.255.255.0
interface GigabitEthernet0/0.20
 encapsulation dot1Q 20
 ip address 10.20.0.1 255.255.255.0`);
  p10.useDhcp();
  p20.useDhcp();
  t.settle();
  assert.equal(formatIp(p10.config.ip!), '10.10.0.2');
  assert.equal(formatIp(p20.config.ip!), '10.20.0.2');
  assert.match(pcCommand(p10, 'ping 10.20.0.2').join('\n'), /Received = [34]/, 'first echo may be lost while the router resolves ARP, as in PT');
  assert.ok(t.net.history.some((e) => e.frame.vlan === 10), 'tagged frames on the trunk');
  const vlans = exec(sw, 'show vlan brief').join('\n');
  assert.match(vlans, /10\s+VENTAS\s+active\s+Fa0\/1/);
  assert.match(exec(sw, 'show mac address-table').join('\n'), /10\s+\S+\s+DYNAMIC\s+Fa0\/1/);
});

test('DHCP snooping: untrusted rogue server blocked; option 82 needs trust on the server', () => {
  const t = new Topology();
  const legit = t.add('router', 0, 0).device as Router;
  const rogue = t.add('router', 0, 0).device as Router;
  const sw = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: legit.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'GigabitEthernet0/1' });
  t.connect({ device: rogue.id, port: 'GigabitEthernet0/0' }, { device: sw.id, port: 'FastEthernet0/24' });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
  cfg(legit, `
ip dhcp pool OK
 network 192.168.50.0 255.255.255.0
interface GigabitEthernet0/0
 ip address 192.168.50.1 255.255.255.0
 no shutdown`);
  cfg(rogue, `
ip dhcp pool EVIL
 network 192.168.50.0 255.255.255.0
 default-router 192.168.50.66
interface GigabitEthernet0/0
 ip address 192.168.50.66 255.255.255.0
 no shutdown`);
  cfg(sw, `
ip dhcp snooping
ip dhcp snooping vlan 1
interface GigabitEthernet0/1
 ip dhcp snooping trust`);
  pc.useDhcp();
  t.settle();
  assert.equal(pc.dhcpStatus, 'failed', 'option 82 with giaddr 0 is rejected by the IOS server');
  cfg(legit, `
interface GigabitEthernet0/0
 ip dhcp relay information trusted`);
  pc.useDhcp();
  t.settle();
  assert.equal(pc.dhcpStatus, 'ok');
  assert.notEqual(formatIp(pc.config.gateway ?? 0), '192.168.50.66', 'rogue OFFER dropped');
  assert.match(exec(sw, 'show ip dhcp snooping binding').join('\n'), /Total number of bindings: 1/);
  assert.match(exec(sw, 'show ip dhcp snooping').join('\n'), /GigabitEthernet0\/1\s+yes/);
  assert.ok(sw.runningConfig().includes(' ip dhcp snooping trust'));
});

test('DHCP failure gives APIPA and ping-before-offer detects conflicts', () => {
  const { t, r, pcs } = lan();
  const [a, b] = pcs as [Pc, Pc];
  a.useDhcp();
  t.settle();
  assert.equal(a.dhcpStatus, 'failed');
  assert.match(formatIp(a.config.ip!), /^169\.254\./);
  cfg(r, LAN_CONFIG);
  b.setStatic({ ip: parseIp('192.168.1.11')!, prefix: 24 });
  const logs: string[] = [];
  r.onConsole((l) => logs.push(l));
  a.useDhcp();
  t.settle();
  assert.equal(formatIp(a.config.ip!), '192.168.1.12');
  assert.ok(logs.includes('%DHCPD-4-PING_CONFLICT: DHCP address conflict:  server pinged 192.168.1.11.'));
  assert.match(exec(r, 'show ip dhcp conflict').join('\n'), /192\.168\.1\.11\s+Ping/);
});

test('lease renewal at T1 and ipconfig /release /renew', () => {
  const { t, r, pcs } = lan();
  cfg(r, LAN_CONFIG.replace(' domain-name lab.local', ' domain-name lab.local\n lease 0 0 10'));
  const pc = pcs[0]!;
  pc.useDhcp();
  t.settle();
  const before = t.net.history.length;
  t.settle(6 * 60 * 1000);
  const renewals = t.net.history.slice(before).filter((e) => e.frame.ip?.udp?.dhcp?.options.messageType === 'REQUEST');
  assert.ok(renewals.length >= 1, 'client renews at half the lease');
  const rel = pcCommand(pc, 'ipconfig /release').join('\n');
  assert.match(rel, /IPv4 Address\.+: 0\.0\.0\.0/);
  assert.doesNotMatch(exec(r, 'show ip dhcp binding').join('\n'), /192\.168\.1\.11/);
  const ren = pcCommand(pc, 'ipconfig /renew').join('\n');
  assert.match(ren, /IPv4 Address\.+: 192\.168\.1\.11/);
});

test('topology round-trips through JSON', () => {
  const { t, r, pcs } = lan();
  cfg(r, LAN_CONFIG);
  pcs[0]!.useDhcp();
  pcs[1]!.setStatic({ ip: parseIp('192.168.1.200')!, prefix: 24, gateway: parseIp('192.168.1.1')! });
  t.settle();
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  const t2 = Topology.fromJSON(json);
  const r2 = t2.byLabel('Router0') as Router;
  assert.deepEqual(r2.runningConfig(), r.runningConfig());
  const p0 = t2.byLabel('PC0') as Pc;
  assert.equal(p0.dhcpStatus, 'ok');
  assert.equal(formatIp((t2.byLabel('PC1') as Pc).config.ip!), '192.168.1.200');
  assert.equal(t2.net.links.length, 3);
  assert.throws(() => Topology.fromJSON({ format: 'x' }), /no es un archivo/i);
  assert.throws(() => Topology.fromJSON({ format: 'netfix', version: 1, devices: [{ id: 1 }], links: [] }), /no válido/);
});

test('link state logs and show interfaces', () => {
  const t = new Topology();
  const r = t.add('router', 0, 0).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  const logs: string[] = [];
  r.onConsole((l) => logs.push(l));
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: pc.id, port: 'FastEthernet0' });
  cfg(r, 'interface GigabitEthernet0/0\n no shutdown');
  assert.ok(logs.includes('%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to up'));
  assert.ok(logs.includes('%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up'));
  assert.match(exec(r, 'show interfaces g0/0')[0] ?? '', /GigabitEthernet0\/0 is up, line protocol is up/);
  t.net.disconnect(t.net.links[0]!.id);
  assert.ok(logs.includes('%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to down'));
});
