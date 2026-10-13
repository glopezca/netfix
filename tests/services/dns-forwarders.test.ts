/** bind9 recursion: forwarders through the ISP cloud to Google's emulated DNS, cache, allow-recursion, no loops. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internetExample } from '../../src/net/example-internet.ts';
import type { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { Topology as Topo } from '../../src/net/topology.ts';
import { parseIp, inSubnet } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

function lab(): { t: Topology; srv: Server; local: Pc; remote: Pc } {
  const t = internetExample.build();
  t.settle(5000);
  const placed = [...t.placed.values()];
  const srv = placed.find((p) => p.label === 'SRV-SEDE2')!.device as Server;
  const pcs = placed.map((p) => p.device).filter((d): d is Pc => d.kind === 'pc');
  const local = pcs.find((p) => p.config.ip !== undefined && inSubnet(p.config.ip, ip('192.168.1.0'), 24))!;
  const remote = pcs.find((p) => p.config.ip !== undefined && inSubnet(p.config.ip, ip('192.168.10.0'), 24))!;
  return { t, srv, local, remote };
}

function withForwarders(srv: Server, forwarders: string[], allow: 'localnets' | 'any' = 'localnets'): void {
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, forwarders: forwarders.map(ip), forwardOnly: true, allowRecursion: allow } });
}

test('without forwarders bind only answers its zones (REFUSED, no ra)', () => {
  const { local } = lab();
  const sh = createShell(local, 'linux');
  const out = all(sh.run('dig @192.168.1.10 www.google.com'));
  assert.match(out, /status: REFUSED/);
  assert.match(out, /flags: qr rd; .*\n;; WARNING: recursion requested but not available/);
  assert.match(all(sh.run('dig @192.168.1.10 www.sede2.es')), /flags: qr aa rd; QUERY: 1, ANSWER: 2/);
});

test('with forwarders bind resolves public names through the ISP cloud and caches them', () => {
  const { srv, local } = lab();
  withForwarders(srv, ['8.8.8.8', '8.8.4.4']);
  const sh = createShell(local, 'linux');
  const out = all(sh.run('dig @192.168.1.10 www.google.com'));
  assert.match(out, /status: NOERROR/);
  assert.match(out, /flags: qr rd ra; QUERY: 1, ANSWER: 1/);
  assert.match(out, /www\.google\.com\.\s+300\s+IN\tA\t142\.250\.184\.4/);
  assert.equal(srv.dns.forwarder.cacheSize(), 1);
  assert.match(all(sh.run('dig +short @192.168.1.10 es.wikipedia.org')), /dyna\.wikimedia\.org\.\n185\.15\.58\.224/);
  assert.match(all(createShell(srv, 'linux', 'root').run('journalctl -u named')), /query: www\.google\.com IN A \+ \(192\.168\.1\.10\) → forwarding to 8\.8\.8\.8, 8\.8\.4\.4/);
  // Second query: from the cache (no new forwarding line).
  const before = srv.logs.filter((l) => /forwarding/.test(l.line)).length;
  sh.run('dig @192.168.1.10 www.google.com');
  assert.equal(srv.logs.filter((l) => /forwarding/.test(l.line)).length, before + 1, 'the query is logged');
  assert.equal(srv.dns.forwarder.cacheSize(), 2);
  assert.match(all(sh.run('nslookup example.com 192.168.1.10')), /Non-authoritative answer:\nName:\texample\.com\nAddress: 93\.184\.215\.14/);
  assert.match(all(sh.run('dig @192.168.1.10 nohay.example.org')), /status: NXDOMAIN/);
  // The local zone stays authoritative.
  assert.match(all(sh.run('dig @192.168.1.10 www.sede2.es')), /flags: qr aa rd ra;/);
});

test('allow-recursion localnets refuses outside clients; any is an open resolver', () => {
  const { srv, remote } = lab();
  withForwarders(srv, ['8.8.8.8']);
  const sh = createShell(remote, 'linux');
  assert.match(all(sh.run('dig @81.33.3.2 www.google.com')), /status: REFUSED/);
  assert.match(all(sh.run('dig @81.33.3.2 www.sede2.es')), /status: NOERROR/);
  withForwarders(srv, ['8.8.8.8'], 'any');
  assert.match(all(sh.run('dig @81.33.3.2 www.google.com')), /status: NOERROR/);
});

test('a dead forwarder fails over to the next one; all dead gives SERVFAIL', () => {
  const { srv, local } = lab();
  withForwarders(srv, ['10.99.99.99', '8.8.8.8']);
  const sh = createShell(local, 'linux');
  assert.match(all(sh.run('dig @192.168.1.10 github.com')), /status: NOERROR[\s\S]*140\.82\.121\.4/);
  withForwarders(srv, ['10.99.99.99']);
  srv.dns.forwarder.flush();
  assert.match(all(sh.run('dig @192.168.1.10 github.com')), /status: SERVFAIL/);
});

test('no loop when a domain is delegated to a server that does not have its zone', () => {
  const { t, srv, remote } = lab();
  withForwarders(srv, ['8.8.8.8']);
  const isp = [...t.placed.values()].map((p) => p.device).find((d): d is Cloud => d.kind === 'cloud' && d.settings.isp === 'ISP-Sur')!;
  isp.setSettings({ ...isp.settings, domains: [...isp.settings.domains, { name: 'otra.es', kind: 'ns', ip: ip('81.33.3.2') }] });
  const out = all(createShell(remote, 'linux').run('dig www.otra.es'));
  assert.match(out, /status: REFUSED/);
  const queries = srv.logs.filter((l) => /otra\.es/.test(l.line));
  assert.ok(queries.length <= 2, `bind saw the query ${queries.length} times`);
  assert.ok(queries.every((l) => / - \(/.test(l.line)), 'iterative (RD=0) queries are not forwarded');
});

test('named.conf.options shows and changes the recursion; settings survive save and open', () => {
  const { t, srv, local } = lab();
  const root = createShell(srv, 'linux', 'root');
  assert.match(all(root.run('cat /etc/bind/named.conf.options')), /recursion no;/);
  hostSystem(srv).fs.writeFile('/etc/bind/named.conf.options', 'options {\n  forwarders { 8.8.4.4; };\n  forward first;\n  allow-recursion { any; };\n};\n');
  assert.deepEqual(srv.services.dns.forwarders, [ip('8.8.4.4')]);
  assert.equal(srv.services.dns.forwardOnly, false);
  assert.equal(srv.services.dns.allowRecursion, 'any');
  assert.match(all(root.run('cat /etc/bind/named.conf.options')), /forwarders \{\n\t\t8\.8\.4\.4;\n\t\};\n\tforward first;\n\n\trecursion yes;\n\tallow-recursion \{ any; \};/);
  assert.match(all(createShell(local, 'linux').run('dig +short @192.168.1.10 ubuntu.com')), /185\.125\.190\.20/);
  assert.match(all(root.run('rndc status')), /forwarders: 8\.8\.4\.4\ncache entries: 1/);
  root.run('rndc flush');
  assert.equal(srv.dns.forwarder.cacheSize(), 0);
  const copy = Topo.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const again = [...copy.placed.values()].find((p) => p.label === 'SRV-SEDE2')!.device as Server;
  assert.deepEqual(again.services.dns.forwarders, [ip('8.8.4.4')]);
  assert.equal(again.services.dns.allowRecursion, 'any');
});

test('ISP DNS relay: the line gateway is the DNS and relays to Google', () => {
  const { t, local } = lab();
  const isp = [...t.placed.values()].map((p) => p.device).find((d): d is Cloud => d.kind === 'cloud' && d.settings.isp === 'ISP-Sur')!;
  isp.setSettings({ ...isp.settings, ports: { ...isp.settings.ports, DSL0: { ...isp.settings.ports.DSL0, dnsRelay: true } } });
  local.useDhcp();
  t.settle(5000);
  assert.equal(local.config.dns, ip('192.168.1.1'));
  const sh = createShell(local, 'linux');
  assert.match(all(sh.run('nslookup www.debian.org')), /Server:\t\t192\.168\.1\.1[\s\S]*Non-authoritative answer:\nName:\twww\.debian\.org\nAddress: 151\.101\.2\.132/);
  assert.equal(isp.lines.get('DSL0')?.relay.cacheSize(), 1);
  const saved = Topo.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const again = [...saved.placed.values()].map((p) => p.device).find((d): d is Cloud => d.kind === 'cloud' && d.settings.isp === 'ISP-Sur')!;
  assert.equal(again.settings.ports.DSL0.dnsRelay, true);
});
