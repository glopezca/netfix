/**
 * Listen interfaces of the DHCP (Kea interfaces-config) and DNS (BIND listen-on) services, as on Ubuntu: a request
 * that comes in through an interface the service does not listen on gets no answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { servicesFromJson, servicesToJson } from '../../src/services/persist.ts';
import { listenChoices, setDhcpInterfaces, setDnsListen } from '../../src/services/listen.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

/** lan PC on eth1 (192.168.1.0/24), dmz PC on eth2 (172.16.0.0/24); the router serves DHCP and DNS on both. */
function lab(): { t: Topology; lr: LinuxRouter; lan: Pc; dmz: Pc; root: (c: string) => string } {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as LinuxRouter;
  const lan = t.add('pc', 0, 0).device as Pc;
  const dmz = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: lr.id, port: 'GigabitEthernet0/1' }, { device: lan.id, port: 'FastEthernet0' });
  t.connect({ device: lr.id, port: 'GigabitEthernet0/2' }, { device: dmz.id, port: 'FastEthernet0' });
  const sh = createShell(lr, 'linux', 'root');
  const root = (c: string): string => all(sh.run(c));
  root('ip addr add 192.168.1.1/24 dev eth1; ip addr add 172.16.0.1/24 dev eth2');
  const pool = (name: string, start: string, gw: string) => ({ name, start: ip(start), prefix: 24, maxUsers: 20, gateway: ip(gw), dns: ip(gw), leaseMinutes: 60, reservations: [] });
  lr.setServices({
    ...lr.services,
    dhcp: { enabled: true, pools: [pool('LAN', '192.168.1.100', '192.168.1.1'), pool('DMZ', '172.16.0.100', '172.16.0.1')] },
    dns: { enabled: true, zones: [{ ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [{ name: 'ns', type: 'A', value: '192.168.1.1', ttl: 60 }] }] },
  });
  t.settle();
  return { t, lr, lan, dmz, root };
}

const lease = (t: Topology, pc: Pc): number | undefined => {
  pc.useDhcp();
  t.settle(10_000);
  return pc.config.ip;
};

test('the choices are the NICs with their addresses, and lo for DNS', () => {
  const { lr } = lab();
  assert.deepEqual(listenChoices(lr, false).map((c) => `${c.name} ${c.address ?? '-'}`), ['eth0 -', 'eth1 192.168.1.1/24', 'eth2 172.16.0.1/24']);
  assert.deepEqual(listenChoices(lr, true).map((c) => c.name), ['eth0', 'eth1', 'eth2', 'lo']);
});

test('DHCP only answers on the interfaces of interfaces-config; the Kea file says which', () => {
  const { t, lr, lan, dmz, root } = lab();
  assert.match(root('cat /etc/kea/kea-dhcp4.conf'), /"interfaces": \[ "\*" \]/, 'by default, every interface');
  const next = setDhcpInterfaces(lr.services, ['eth1'], ['eth0', 'eth1', 'eth2']);
  assert.ok(!('error' in next));
  lr.setServices(next);
  assert.match(root('cat /etc/kea/kea-dhcp4.conf'), /"interfaces": \[ "eth1" \]/);
  assert.equal(lease(t, lan), ip('192.168.1.100'));
  assert.equal(lease(t, dmz), undefined, 'eth2 is not listened on');
  assert.match(root('ss -lun'), /192\.168\.1\.1:67/);
  assert.doesNotMatch(root('ss -lun'), /0\.0\.0\.0:67/);
  assert.ok('error' in setDhcpInterfaces(lr.services, [], ['eth0', 'eth1', 'eth2']), 'at least one interface');
  assert.ok('error' in setDhcpInterfaces(lr.services, ['eth9'], ['eth0', 'eth1', 'eth2']), 'only existing ones');
});

test('DNS only answers on the addresses of listen-on; editing named.conf.options comes back', () => {
  const { lr, lan, dmz, root } = lab();
  lan.setStatic({ ip: ip('192.168.1.10'), prefix: 24, gateway: ip('192.168.1.1') });
  dmz.setStatic({ ip: ip('172.16.0.10'), prefix: 24, gateway: ip('172.16.0.1') });
  assert.match(root('cat /etc/bind/named.conf.options'), /listen-on \{ any; \};/);
  const next = setDnsListen(lr.services.dns, ['eth1', 'lo'], ['eth0', 'eth1', 'eth2', 'lo']);
  assert.ok(!('error' in next));
  lr.setServices({ ...lr.services, dns: next });
  assert.match(root('cat /etc/bind/named.conf.options'), /listen-on \{ 192\.168\.1\.1; 127\.0\.0\.1; \};/);
  assert.match(all(createShell(lan, 'linux').run('dig +short @192.168.1.1 ns.aula.lab')), /^192\.168\.1\.1$/m);
  assert.match(all(createShell(dmz, 'linux').run('dig @172.16.0.1 ns.aula.lab')), /connection timed out|no servers could be reached/);
  assert.match(root('dig +short @127.0.0.1 ns.aula.lab'), /^192\.168\.1\.1$/m, 'lo: the router itself');
  assert.match(root('ss -lun'), /192\.168\.1\.1:53[\s\S]*127\.0\.0\.1:53/);
  hostSystem(lr).fs.writeFile('/etc/bind/named.conf.options', root('cat /etc/bind/named.conf.options').replace(/listen-on \{[^}]*\};/, 'listen-on { 172.16.0.1; };'));
  assert.deepEqual(lr.services.dns.listenOn, ['eth2']);
  hostSystem(lr).fs.writeFile('/etc/bind/named.conf.options', root('cat /etc/bind/named.conf.options').replace(/listen-on \{[^}]*\};/, 'listen-on { any; };'));
  assert.equal(lr.services.dns.listenOn, undefined);
});

test('both settings are saved with the topology and validated when loaded', () => {
  const { lr } = lab();
  const dhcp = setDhcpInterfaces(lr.services, ['eth2'], ['eth0', 'eth1', 'eth2']);
  assert.ok(!('error' in dhcp));
  const dns = setDnsListen(dhcp.dns, ['lo'], ['eth0', 'eth1', 'eth2', 'lo']);
  assert.ok(!('error' in dns));
  const back = servicesFromJson(JSON.parse(JSON.stringify(servicesToJson({ ...dhcp, dns }))));
  assert.deepEqual(back.dhcp.interfaces, ['eth2']);
  assert.deepEqual(back.dns.listenOn, ['lo']);
  assert.throws(() => servicesFromJson({ dhcp: { enabled: true, pools: [], interfaces: ['eth0; rm'] } }), /interfa/i);
  assert.throws(() => servicesFromJson({ dns: { enabled: true, zones: [], listenOn: 'eth0' } }), /interfa|lista/i);
});

test('127.0.0.0/8 is the host itself (lo): ping and services answer locally', () => {
  const { lan } = lab();
  lan.setStatic({ ip: ip('192.168.1.10'), prefix: 24 });
  assert.match(all(createShell(lan, 'linux').run('ping -c 1 127.0.0.1')), / 0% packet loss/);
});

test('review: an empty list in a topology file is refused, as in the panel', () => {
  assert.throws(() => servicesFromJson({ dhcp: { enabled: true, pools: [], interfaces: [] } }), /interfa/i);
  assert.throws(() => servicesFromJson({ dns: { enabled: true, zones: [], listenOn: [] } }), /interfa/i);
});

test('review: 127.x that comes in from the wire is dropped (martian), as Linux does', () => {
  const { t, lr, lan } = lab();
  lan.setStatic({ ip: ip('192.168.1.10'), prefix: 24 });
  const eth1 = lr.nics().find((n) => n.linux === 'eth1');
  assert.ok(eth1);
  const seen: unknown[] = [];
  t.net.onFrame((e) => { if (JSON.stringify(e).includes('echo-reply')) seen.push(e); });
  const echo = (dst: string) => lr.receive(eth1.port, { src: lan.mac, dst: eth1.mac, ip: { src: ip('192.168.1.10'), dst: ip(dst), ttl: 64, protocol: 'icmp', icmp: { type: 'echo-request', id: 7, seq: 1 } } });
  echo('127.0.0.1');
  t.settle();
  assert.equal(seen.length, 0, 'no reply to 127.0.0.1 from outside');
  echo('192.168.1.1');
  t.settle();
  assert.ok(seen.length > 0, 'the same request to its real address is answered');
});

test('review: listen-on port 53 { … } is understood', () => {
  const { lr, root } = lab();
  const file = root('cat /etc/bind/named.conf.options').replace(/listen-on \{[^}]*\};/, 'listen-on port 53 { 192.168.1.1; };');
  hostSystem(lr).fs.writeFile('/etc/bind/named.conf.options', file);
  assert.deepEqual(lr.services.dns.listenOn, ['eth1']);
});

test('review: an interface without an address stays chosen when the file is saved again', () => {
  const { lr, root } = lab();
  lr.setServices({ ...lr.services, dns: { ...lr.services.dns, listenOn: ['eth0', 'eth1'] } });
  hostSystem(lr).fs.writeFile('/etc/bind/named.conf.options', root('cat /etc/bind/named.conf.options').replace('max-cache-ttl', 'max-cache-ttl'));
  assert.deepEqual(lr.services.dns.listenOn, ['eth0', 'eth1']);
});
