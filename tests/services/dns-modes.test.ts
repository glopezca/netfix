/**
 * bind9 by operating mode: recursive (recursion yes|no), iterative (from the root servers of the emulated Internet:
 * root → TLD → authoritative), forwarder (forward only|first), cache (max-cache-ttl) and authoritative (zones on/off).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internetExample } from '../../src/net/example-internet.ts';
import type { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import type { DnsSettings } from '../../src/services/config.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { parseIp, inSubnet } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;
const all = (l: string[]): string => l.join('\n');

function lab(dns: Partial<DnsSettings> = {}): { t: Topology; srv: Server; dig: (args: string) => string } {
  const t = internetExample.build();
  t.settle(5000);
  const placed = [...t.placed.values()];
  const srv = placed.find((p) => p.label === 'SRV-SEDE2')!.device as Server;
  const local = placed.map((p) => p.device).find((d): d is Pc => d.kind === 'pc' && d.config.ip !== undefined && inSubnet(d.config.ip, ip('192.168.1.0'), 24))!;
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, ...dns } });
  const sh = createShell(local, 'linux');
  return { t, srv, dig: (args) => all(sh.run(`dig @192.168.1.10 ${args}`)) };
}

const logOf = (srv: Server): string => srv.logs.filter((l) => l.unit === 'dns').map((l) => l.line).join('\n');

test('recursive without forwarders: bind iterates from the root servers (root → com → google.com)', () => {
  const { srv, dig } = lab({ recursion: true });
  const out = dig('www.google.com');
  assert.match(out, /status: NOERROR/);
  assert.match(out, /flags: qr rd ra;/);
  assert.match(out, /www\.google\.com\.\s+300\s+IN\tA\t142\.250\.184\.4/);
  const log = logOf(srv);
  assert.match(log, /→ iterative resolution/);
  assert.match(log, /starting at the root servers/);
  assert.match(log, /referral to com\. \(a\.gtld-servers\.net\)/);
  assert.match(log, /referral to google\.com\. \(ns1\.google\.com\)/);
  dig('smtp.google.com');
  assert.match(logOf(srv), /smtp\.google\.com\/A: iterative, starting at google\.com \(cached\)/, 'the delegation is cached');
});

test('iteration follows a CNAME into another zone and reports NXDOMAIN from the root', () => {
  const { dig } = lab({ recursion: true });
  assert.match(dig('+short es.wikipedia.org'), /dyna\.wikimedia\.org\.\n185\.15\.58\.224/);
  assert.match(dig('www.nohay.xyz'), /status: NXDOMAIN/);
});

test('iteration reaches domains registered at the ISP: with an address (registrar DNS)', () => {
  const { t, dig } = lab({ recursion: true });
  const isp = [...t.placed.values()].map((p) => p.device).find((d): d is Cloud => d.kind === 'cloud' && d.settings.isp === 'ISP-Sur')!;
  isp.setSettings({ ...isp.settings, domains: [...isp.settings.domains, { name: 'tienda.es', kind: 'a', ip: ip('81.33.3.2') }] });
  assert.match(dig('+short www.tienda.es'), /^81\.33\.3\.2$/m);
});

test('forward only never iterates; forward first iterates when the forwarders fail', () => {
  const dead = [ip('10.99.99.99')];
  assert.match(lab({ recursion: true, forwarders: dead, forwardOnly: true }).dig('github.com'), /status: SERVFAIL/);
  const { srv, dig } = lab({ recursion: true, forwarders: dead, forwardOnly: false });
  assert.match(dig('github.com'), /status: NOERROR[\s\S]*140\.82\.121\.4/);
  assert.match(logOf(srv), /forwarding to 10\.99\.99\.99 \(then iterative\)[\s\S]*starting at the root servers/);
});

test('recursion off: no forwarding and no iteration (REFUSED for names outside the zones)', () => {
  const { dig } = lab({ recursion: false, forwarders: [ip('8.8.8.8')] });
  assert.match(dig('www.google.com'), /status: REFUSED/);
  assert.match(dig('www.sede2.es'), /status: NOERROR/);
});

test('cache: answers kept for their TTL capped by max-cache-ttl; 0 keeps nothing', () => {
  const { srv, dig } = lab({ recursion: true, maxCacheTtl: 60 });
  dig('www.google.com');
  const entry = srv.dns.forwarder.entries().find((e) => e.name === 'www.google.com');
  assert.equal(entry?.type, 'A');
  assert.equal(entry?.what, 'A 142.250.184.4');
  assert.ok((entry?.ttl ?? 0) <= 60, 'capped by max-cache-ttl');
  assert.ok(srv.dns.forwarder.entries().some((e) => e.type === 'NS' && e.name === 'com'), 'delegations are cached too');
  const none = lab({ recursion: true, maxCacheTtl: 0 });
  none.dig('www.google.com');
  assert.equal(none.srv.dns.forwarder.cacheSize(), 0);
  none.dig('www.google.com');
  assert.equal(logOf(none.srv).match(/starting at the root servers/g)?.length, 2, 'without cache every query starts again');
});

test('authoritative off: the zones are kept but not served (named.conf.local says so)', () => {
  const { srv, dig } = lab({ authoritative: false });
  assert.match(dig('www.sede2.es'), /status: REFUSED/);
  assert.equal(srv.services.dns.zones.length, 1);
  assert.match(all(createShell(srv, 'linux', 'root').run('cat /etc/bind/named.conf.local')), /Modo autoritativo desactivado/);
});

test('named.conf.options carries every mode and edits come back to the settings', () => {
  const { srv } = lab({ recursion: true, maxCacheTtl: 3600, forwarders: [ip('8.8.8.8')], forwardOnly: false });
  const root = createShell(srv, 'linux', 'root');
  const conf = all(root.run('cat /etc/bind/named.conf.options'));
  assert.match(conf, /max-cache-ttl 3600;/);
  assert.match(conf, /forwarders \{\n\t\t8\.8\.8\.8;\n\t\};/);
  assert.match(conf, /forward first;/);
  assert.match(conf, /recursion yes;/);
  hostSystem(srv).fs.writeFile('/etc/bind/named.conf.options', conf.replace('recursion yes;', 'recursion no;').replace('max-cache-ttl 3600;', 'max-cache-ttl 0;').replace('forward first;', 'forward only;'));
  assert.equal(srv.services.dns.recursion, false);
  assert.equal(srv.services.dns.maxCacheTtl, 0);
  assert.equal(srv.services.dns.forwardOnly, true);
  assert.match(all(root.run('cat /etc/bind/named.conf.default-zones')), /zone "\." \{\n\ttype hint;\n\tfile "\/usr\/share\/dns\/root\.hints";/);
  assert.match(all(root.run('grep -c "IN\\|NS\\| A " /usr/share/dns/root.hints')), /^\d+$/);
  assert.match(all(root.run('cat /usr/share/dns/root.hints')), /A\.ROOT-SERVERS\.NET\.\s+3600000\s+A\s+198\.41\.0\.4/);
});

test('review: odd TLDs do not crash; forward first iterates on a refusing forwarder; stale delegations are retried from the root', () => {
  const { dig } = lab({ recursion: true });
  assert.match(dig('www.constructor'), /status: NXDOMAIN/);
  assert.match(dig('www.__proto__'), /status: NXDOMAIN/);
  // 8.8.8.8 answers; a forwarder that refuses (a non-recursive bind) must not stop forward first.
  const refusing = lab({ recursion: true, forwarders: [ip('192.168.1.10')], forwardOnly: false });
  assert.match(refusing.dig('github.com'), /status: NOERROR[\s\S]*140\.82\.121\.4/);
  const { srv, dig: dig2 } = lab({ recursion: true });
  dig2('www.google.com');
  srv.dns.forwarder.flush();
  srv.dns.forwarder.remember('google.com', [ip('10.99.99.99')], 3600);
  assert.match(dig2('smtp.google.com'), /status: NOERROR[\s\S]*142\.250\.153\.27/);
});
