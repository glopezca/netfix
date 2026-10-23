/**
 * Public names of the emulated Internet: the ones it already knew, google.es, educa.jcyl.es, juandecolonia.es and the
 * world top 100 (without adult or gambling sites). Each resolves through 8.8.8.8 and by iteration from the root, and
 * each address answers ping and HTTP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { createShell } from '../../src/shells/factory.ts';
import { PUBLIC_SITES } from '../../src/net/public-names.ts';
import { ZONES, publicRecords } from '../../src/net/internet-zones.ts';
import { ROOT_IPS } from '../../src/net/dns-roots.ts';
import { parseIp } from '../../src/core/ip.ts';

const ip = (t: string): number => parseIp(t) ?? 0;

function home(): Pc {
  const t = new Topology();
  const cloud = t.add('cloud', 0, 0).device as Cloud;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: cloud.id, port: 'Fibra0' }, { device: pc.id, port: 'FastEthernet0' });
  pc.useDhcp();
  t.settle();
  return pc;
}

test('the list: the three named domains, at least 100 more, no adult or gambling site, every address unique', () => {
  const names = PUBLIC_SITES.map((s) => s.domain);
  for (const d of ['google.es', 'educa.jcyl.es', 'juandecolonia.es', 'youtube.com', 'facebook.com', 'claude.ai']) assert.ok(names.includes(d), d);
  assert.ok(names.length >= 100, String(names.length));
  assert.ok(!names.some((n) => /porn|xvideos|xhamster|stripchat|bet\.br/.test(n)));
  const ips = PUBLIC_SITES.map((s) => s.ip);
  assert.equal(new Set(ips).size, ips.length, 'one site per address');
  const cloudBlocks = (a: number): boolean => a >= ip('81.32.0.0') && a < ip('82.232.0.0');
  assert.ok(!ips.some((a) => cloudBlocks(ip(a)) || ROOT_IPS.includes(ip(a))), 'no clash with ISP clouds or root servers');
  const records = publicRecords();
  for (const n of ['www.google.es', 'www.google.com', 'wikipedia.org', 'www.wikipedia.org', 'github.com', 'pool.ntp.org']) assert.ok(records.some((r) => r.name === n), `${n}: www and the names it already knew`);
  assert.ok(ZONES.some((z) => z.origin === 'jcyl.es'), 'the hierarchy knows the zone');
});

test('ping, nslookup and dig resolve them through 8.8.8.8 and from the root', () => {
  const pc = home();
  const sh = createShell(pc, 'linux');
  assert.match(sh.run('ping -c 1 google.es').join('\n'), /^64 bytes from google\.es \(142\.250\.200\.67\)/m);
  assert.match(sh.run('nslookup educa.jcyl.es').join('\n'), /Name:\s+educa\.jcyl\.es\nAddress: 217\.71\.19\.5/);
  assert.match(sh.run('dig +short juandecolonia.es').join('\n'), /^\d+\.\d+\.\d+\.\d+$/m);
  assert.match(sh.run('ping -c 1 www.youtube.com').join('\n'), / 0% packet loss/);
  assert.match(sh.run('curl -s http://www.wikipedia.org/').join('\n'), /wikipedia|Wikipedia|Internet emulada/);
  assert.match(createShell(pc, 'windows').run('ping -n 1 news.yahoo.co.jp').join('\n'), /Reply from /);
});
