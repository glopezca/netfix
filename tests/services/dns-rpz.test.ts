/**
 * «Nombres públicos» of the DNS service: a response policy zone (RPZ) with local data, /etc/bind/db.rpz.publicos,
 * one «name A address» per line. With it on, the server answers those names in recursive queries without asking
 * anybody (a lab with no Internet can ping google.es by name); root may edit the file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostSystem } from '../../src/shells/host-system.ts';
import { servicesFromJson, servicesToJson } from '../../src/services/persist.ts';
import { RPZ_FILE, parseRpz, rpzEntries, setPublicNames } from '../../src/services/dns-rpz.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (s: string): number => parseIp(s) ?? 0;

function lab(recursion = true): { srv: Server; pc: Pc; root: (c: string) => string; sh: (c: string) => string } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: ip('10.0.0.2'), prefix: 24 });
  pc.setStatic({ ip: ip('10.0.0.10'), prefix: 24, gateway: ip('10.0.0.1'), dns: ip('10.0.0.2') });
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, enabled: true, recursion } });
  t.settle();
  const r = createShell(srv, 'linux', 'root');
  const p = createShell(pc, 'linux');
  return { srv, pc, root: (c) => r.run(c).join('\n'), sh: (c) => p.run(c).join('\n') };
}

const on = (srv: Server): void => {
  const next = setPublicNames(srv.services.dns, true);
  assert.ok(!('error' in next));
  srv.setServices({ ...srv.services, dns: next });
};

test('off by default; the file is there with the list (google.es, educa.jcyl.es, juandecolonia.es…)', () => {
  const { srv, root, sh } = lab();
  assert.notEqual(srv.services.dns.publicNames?.enabled, true);
  const file = root(`cat ${RPZ_FILE}`);
  assert.match(file, /^\$TTL 300$/m);
  assert.match(file, /^google\.es\s+A\s+142\.250\.200\.67$/m);
  assert.match(file, /^educa\.jcyl\.es\s+A\s+/m);
  assert.match(file, /^juandecolonia\.es\s+A\s+/m);
  assert.doesNotMatch(root('cat /etc/bind/named.conf.options'), /response-policy/);
  assert.match(sh('dig google.es'), /status: (SERVFAIL|NXDOMAIN)|connection timed out/, 'no Internet and no list: no answer');
});

test('on: dig, nslookup and ping resolve the names with no Internet; named.conf has the policy zone', () => {
  const { srv, root, sh } = lab();
  on(srv);
  assert.match(root('cat /etc/bind/named.conf.options'), /response-policy \{ zone "rpz\.publicos"; \};/);
  assert.match(root('cat /etc/bind/named.conf.local'), /zone "rpz\.publicos" \{\n\ttype master;\n\tfile "\/etc\/bind\/db\.rpz\.publicos";/);
  assert.equal(sh('dig +short google.es').trim(), '142.250.200.67');
  assert.match(sh('dig www.youtube.com'), /status: NOERROR[\s\S]*flags: qr rd ra;[\s\S]*www\.youtube\.com\.\s+300\s+IN\s+A\s+142\.250\.185\.14/);
  assert.match(sh('nslookup educa.jcyl.es'), /Non-authoritative answer:\nName:\s+educa\.jcyl\.es\nAddress: 217\.71\.19\.5/);
  assert.match(sh('ping -c 1 juandecolonia.es'), /^PING juandecolonia\.es \(\d+\.\d+\.\d+\.\d+\)/m);
  assert.match(root('journalctl -u bind9 -n 5'), /rpz QNAME Local-Data rewrite google\.es\/A\/IN via google\.es\.rpz\.publicos/);
});

test('like BIND, the policy applies to recursive queries: without the Recursive mode the answer is REFUSED', () => {
  const { srv, sh } = lab(false);
  on(srv);
  assert.match(sh('dig google.es'), /status: REFUSED/);
});

test('root edits the file: entries, wildcards and named-checkzone errors', () => {
  const { srv, root, sh } = lab();
  on(srv);
  const fs = hostSystem(srv).fs;
  fs.writeFile(RPZ_FILE, `$TTL 300\n@ IN SOA localhost. root.localhost. ( 2 3600 900 604800 300 )\n  IN NS localhost.\naula.ejemplo 60 IN A 10.0.0.50\n*.ejemplo.org A 10.0.0.60\n`);
  assert.deepEqual(rpzEntries(srv.services.dns).map((e) => e.name), ['aula.ejemplo', '*.ejemplo.org']);
  assert.equal(sh('dig +short aula.ejemplo').trim(), '10.0.0.50');
  assert.equal(sh('dig +short www.ejemplo.org').trim(), '10.0.0.60');
  assert.doesNotMatch(sh('dig +short ejemplo.org'), /10\.0\.0\.60/, 'a wildcard covers the names below, not the domain');
  assert.match(sh('dig google.es'), /status: (SERVFAIL|NXDOMAIN)|timed out/, 'google.es is no longer in the list');
  fs.writeFile(RPZ_FILE, 'aula.ejemplo A 999.1.1.1\n');
  assert.equal(rpzEntries(srv.services.dns).length, 2, 'a bad file is refused');
  assert.match(root('journalctl -u bind9 -n 3'), /db\.rpz\.publicos:1: near '999\.1\.1\.1': bad dotted quad/);
});

test('restore, persistence and validation', () => {
  const { srv } = lab();
  const custom = setPublicNames(srv.services.dns, true, 'uno.lab A 10.0.0.1\n');
  assert.ok(!('error' in custom));
  const back = servicesFromJson(JSON.parse(JSON.stringify(servicesToJson({ ...srv.services, dns: custom }))));
  assert.equal(back.dns.publicNames?.enabled, true);
  assert.deepEqual(rpzEntries(back.dns), [{ name: 'uno.lab', ip: ip('10.0.0.1'), ttl: 300 }]);
  const restored = setPublicNames(custom, true, 'initial');
  assert.ok(!('error' in restored));
  assert.ok(rpzEntries(restored).length > 100, 'undefined = the initial list');
  assert.ok('error' in parseRpz('<script> A 1.2.3.4\n'));
  assert.ok('error' in parseRpz(Array.from({ length: 3000 }, (_, i) => `x${i}.lab A 10.0.0.1`).join('\n')), 'too many entries');
  assert.throws(() => servicesFromJson({ dns: { enabled: true, zones: [], publicNames: { enabled: true, entries: [{ name: 'a b', ip: 1, ttl: 300 }] } } }));
});

test('review: repeated records count once; messages are short and without control characters; a TTL must be a number', () => {
  const twice = parseRpz('a.lab A 10.0.0.1\na.lab A 10.0.0.1\na.lab A 10.0.0.2\n');
  assert.ok(!('error' in twice) && twice.length === 2);
  const bad = parseRpz(`a.lab ${'X'.repeat(500)}\u001b[31m 1.2.3.4\n`);
  assert.ok('error' in bad && bad.error.length < 200 && !bad.error.includes('\u001b'));
  assert.throws(() => servicesFromJson({ dns: { enabled: true, zones: [], publicNames: { enabled: true, entries: [{ name: 'a.lab', ip: '10.0.0.1', ttl: true }] } } }));
});
