/**
 * resolvectl (systemd-resolved) in the GNU/Linux terminals: status per link, queries through the same resolver as ping
 * and dig (/etc/hosts, search list, the device's DNS server), and runtime changes of the DNS server and domains that
 * netplan does not keep (revert, or a new IP configuration, drops them).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import { newZone } from '../../src/services/dns-zones.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

function lab(): { t: Topology; pc: Pc; srv: Server; sh: (c: string) => string; root: (c: string) => string } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, gateway: ip('10.0.0.1'), dns: ip('10.0.0.2') });
  pc.dnsSearch = ['aula.lab'];
  srv.setServices({ ...srv.services, dns: { enabled: true, zones: [{ ...newZone('aula.lab', 'forward', ['ns.aula.lab']), records: [
    { name: 'ns', type: 'A', value: '10.0.0.2', ttl: 60 }, { name: 'www', type: 'A', value: '10.0.0.20', ttl: 60 },
    { name: 'web', type: 'CNAME', value: 'www', ttl: 60 }, { name: '@', type: 'MX', value: 'ns', priority: 10, ttl: 60 },
  ] }] } });
  t.settle();
  const user = createShell(pc, 'linux');
  const r = createShell(pc, 'linux', 'root');
  return { t, pc, srv, sh: (c) => all(user.run(c)), root: (c) => all(r.run(c)) };
}

test('status: Global and one block per link, as systemd 257 prints them', () => {
  const { sh } = lab();
  assert.equal(sh('resolvectl status'), [
    'Global',
    '         Protocols: -LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported',
    '  resolv.conf mode: foreign',
    '',
    'Link 2 (eth0)',
    '    Current Scopes: DNS',
    '         Protocols: +DefaultRoute -LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported',
    'Current DNS Server: 10.0.0.2',
    '       DNS Servers: 10.0.0.2',
    '        DNS Domain: aula.lab',
  ].join('\n'));
  assert.equal(sh('resolvectl'), sh('resolvectl status'), 'status is the default verb');
  assert.match(sh('resolvectl status eth0'), /^Link 2 \(eth0\)$/m);
  assert.doesNotMatch(sh('resolvectl status eth0'), /^Global$/m);
  assert.match(sh('resolvectl status eth9'), /Failed to resolve interface "eth9": No such device/);
});

test('a GNU/Linux router: the links without DNS have no scope', () => {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as Server;
  const out = all(createShell(lr, 'linux').run('resolvectl status'));
  assert.match(out, /Link 3 \(eth1\)\n    Current Scopes: none\n         Protocols: -DefaultRoute -LLMNR -mDNS -DNSOverTLS DNSSEC=no\/unsupported/);
  assert.match(out, /Link 4 \(eth2\)/);
});

test('query: addresses, CNAME, search list, reverse, -t, /etc/hosts and the legend', () => {
  const { sh } = lab();
  const lines = sh('resolvectl query www.aula.lab').split('\n');
  assert.deepEqual([lines[0], lines[1], lines[3], lines[4]], [
    'www.aula.lab: 10.0.0.20                      -- link: eth0',
    '',
    '-- Data is authenticated: no; Data was acquired via local or encrypted transport: no',
    '-- Data from: network',
  ]);
  assert.match(sh('resolvectl query www.aula.lab'), /^-- Information acquired via protocol DNS in \d+\.\dms\.$/m);
  assert.match(sh('resolvectl query web.aula.lab'), /^web\.aula\.lab: 10\.0\.0\.20 +-- link: eth0\n {14}\(www\.aula\.lab\)$/m);
  assert.match(sh('resolvectl query www'), /^www: 10\.0\.0\.20 +-- link: eth0$/m, 'single label: the search domain');
  assert.match(sh('resolvectl query -t MX aula.lab'), /^aula\.lab IN MX 10 ns\.aula\.lab +-- link: eth0$/m);
  assert.match(sh('resolvectl query --type=MX aula.lab'), /IN MX 10 ns\.aula\.lab/);
  assert.equal(sh('resolvectl query --legend=no www.aula.lab').split('\n').length, 1);
  assert.match(sh('resolvectl query localhost'), /^localhost: 127\.0\.0\.1 +-- link: lo\n\n[\s\S]*-- Data from: synthetic$/m);
  assert.match(sh('resolvectl query pc0'), /^pc0: 10\.0\.0\.10 +-- link: eth0[\s\S]*Data from: synthetic/m, 'its own name');
});

test('query errors, as resolved words them', () => {
  const { sh, pc } = lab();
  assert.equal(sh('resolvectl query nada.aula.lab; echo $?'), "nada.aula.lab: resolve call failed: 'nada.aula.lab' not found\n1");
  assert.equal(sh('resolvectl query -t TXT www.aula.lab'), "www.aula.lab: resolve call failed: 'www.aula.lab' does not have any RR of the requested type");
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, gateway: ip('10.0.0.1'), dns: ip('10.0.0.99') });
  assert.equal(sh('resolvectl query www.aula.lab'), 'www.aula.lab: resolve call failed: All attempts to contact name servers or networks failed');
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, gateway: ip('10.0.0.1') });
  assert.equal(sh('resolvectl query www.aula.lab'), 'www.aula.lab: resolve call failed: No appropriate name servers or networks for name found');
  assert.equal(sh('resolvectl query'), 'Too few arguments.');
});

test('dns and domain: shown per link; root changes them at run time; revert and a new IP setting drop them', () => {
  const { pc, sh, root } = lab();
  assert.equal(sh('resolvectl dns'), 'Global:\nLink 2 (eth0): 10.0.0.2');
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0): aula.lab');
  assert.match(sh('resolvectl dns eth0 10.0.0.9'), /Failed to set DNS configuration: Interactive authentication required\./);
  assert.equal(root('resolvectl dns eth0 8.8.8.8 1.1.1.1; echo $?'), 'resolvectl: Netfix usa un servidor DNS por equipo: se queda el primero, 8.8.8.8\n0');
  assert.equal(sh('resolvectl dns eth0'), 'Link 2 (eth0): 8.8.8.8');
  assert.match(sh('dig www.aula.lab'), /8\.8\.8\.8#53/, 'the resolver uses it (no Internet here: it times out)');
  assert.match(root('cat /etc/netplan/50-cloud-init.yaml'), /10\.0\.0\.2/, 'netplan keeps the configured server');
  root('resolvectl domain eth0 empresa.lan ~.');
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0): empresa.lan ~.');
  root('resolvectl revert eth0');
  assert.equal(sh('resolvectl dns eth0'), 'Link 2 (eth0): 10.0.0.2');
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0): aula.lab');
  root('resolvectl dns eth0 8.8.4.4');
  pc.setStatic({ ip: ip('10.0.0.11'), prefix: 24, gateway: ip('10.0.0.1'), dns: ip('10.0.0.2') });
  assert.equal(sh('resolvectl dns eth0'), 'Link 2 (eth0): 10.0.0.2', 'a new IP configuration of the link drops it');
  assert.match(root('resolvectl dns eth0 nada'), /Failed to parse DNS server address: nada/);
});

test('flush-caches, reset-server-features, statistics and help', () => {
  const { sh, root } = lab();
  sh('resolvectl query www.aula.lab');
  assert.equal(root('resolvectl flush-caches; resolvectl reset-server-features; echo $?'), '0');
  assert.match(sh('resolvectl statistics'), /^Transactions\nCurrent Transactions: 0\n  Total Transactions: [1-9]\d*$/m);
  assert.match(sh('resolvectl -h'), /^resolvectl \[OPTIONS\.\.\.\] COMMAND \.\.\.$/m);
  assert.match(sh('resolvectl nada'), /Unknown command verb 'nada'/);
});

test('review: options before the verb and with values; unknown options; too few arguments', () => {
  const { sh } = lab();
  assert.match(sh('resolvectl -t MX query aula.lab'), /aula\.lab IN MX 10 ns\.aula\.lab/);
  assert.match(sh('resolvectl --type MX query aula.lab'), /aula\.lab IN MX 10 ns\.aula\.lab/);
  assert.equal(sh('resolvectl query -i eth0 --legend no www.aula.lab').split('\n').length, 1, '-i and --legend take a value');
  assert.match(sh('resolvectl query --nada x'), /^resolvectl: unrecognized option '--nada'$/m);
  assert.equal(sh('resolvectl query'), 'Too few arguments.');
  assert.match(sh('resolvectl query -t'), /option requires an argument -- 't'/);
  assert.equal(sh('resolvectl query -t AAAA www.aula.lab'), "www.aula.lab: resolve call failed: 'www.aula.lab' does not have any RR of the requested type");
});

test('review: the runtime DNS survives a DHCP renewal and an unchanged netplan apply, not a real change', () => {
  const { t, pc, srv, sh, root } = lab();
  srv.setServices({ ...srv.services, dhcp: { enabled: true, pools: [{ name: 'p', start: ip('10.0.0.100'), prefix: 24, maxUsers: 10, gateway: ip('10.0.0.1'), dns: ip('10.0.0.2'), leaseMinutes: 2, reservations: [] }] } });
  pc.useDhcp();
  t.settle(10_000);
  root('resolvectl dns eth0 10.0.0.2; resolvectl domain eth0 empresa.lan');
  t.settle(5 * 60_000);
  assert.equal(sh('resolvectl dns eth0'), 'Link 2 (eth0): 10.0.0.2');
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0): empresa.lan', 'renewals do not drop it');
  assert.doesNotMatch(root('cat /etc/resolv.conf'), /empresa\.lan/, 'resolv.conf (foreign) is not resolved’s');
  root('netplan apply');
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0): empresa.lan', 'nothing changed');
  pc.setStatic({ ip: ip('10.0.0.12'), prefix: 24, gateway: ip('10.0.0.1'), dns: ip('10.0.0.2') });
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0): aula.lab', 'a new configuration drops it');
});

test('review: synthetic data is authenticated; empty values clear; messages as systemd; caps', () => {
  const { sh, root } = lab();
  assert.match(sh('resolvectl query localhost'), /-- Data is authenticated: yes; Data was acquired via local or encrypted transport: yes\n-- Data from: synthetic/);
  root('resolvectl dns eth0 ""');
  assert.equal(sh('resolvectl dns eth0'), 'Link 2 (eth0):');
  assert.match(sh('resolvectl query www.aula.lab'), /No appropriate name servers/);
  root('resolvectl revert eth0');
  root('resolvectl domain eth0 ""');
  assert.equal(sh('resolvectl domain eth0'), 'Link 2 (eth0):');
  assert.equal(sh('resolvectl dns eth0 1.1.1.1'), 'Failed to set DNS configuration: Interactive authentication required.');
  assert.match(root(`resolvectl domain eth0 ${'a.'.repeat(200)}lab`), /Failed to parse domain name/);
  assert.doesNotMatch(sh("resolvectl status $'\\e[2J'"), /\x1b/);
  assert.match(sh('resolvectl query www.aula.lab'), /in (\d+us|\d+\.\dms|\d+\.\ds)\./);
});
