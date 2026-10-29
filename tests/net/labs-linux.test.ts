/** GNU/Linux router DMZ lab and company DNS lab: what is allowed and what is blocked. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Server } from '../../src/devices/server.ts';
import type { LinuxRouter } from '../../src/devices/linux-router.ts';
import { createShell } from '../../src/shells/factory.ts';
import { formatIp } from '../../src/core/ip.ts';

const lab = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const all = (l: string[]): string => l.join('\n');

test('DMZ lab: web published, SSH filtered, DMZ cannot reach the LAN, LAN goes everywhere', () => {
  const t = lab('linux-dmz');
  const fw = t.byLabel('FW') as LinuxRouter;
  const ext = t.byLabel('CLIENTE-EXT') as Pc;
  const web = t.byLabel('WEB-DMZ') as Server;
  const lanPc = [...t.placed.values()].map((p) => p.device).find((d): d is Pc => d.kind === 'pc' && formatIp((d as Pc).config.ip ?? 0) === '192.168.1.10')!;
  const pub = formatIp(fw.config.ip ?? 0);
  const outside = createShell(ext, 'linux');
  assert.match(all(outside.run(`curl -s http://${pub}/`)), /Servidor web de Netfix/, 'dnat to the DMZ web server');
  assert.match(all(outside.run(`nc -zv -w 1 ${pub} 22 2>&1`)), /timed out/, 'SSH is not exposed');
  const lan = createShell(lanPc, 'linux');
  assert.match(all(lan.run('curl -s http://172.16.0.80/')), /Servidor web de Netfix/);
  assert.match(all(lan.run('ping -c 1 8.8.8.8')), / 0% packet loss/);
  const dmz = createShell(web, 'linux');
  assert.match(all(dmz.run('ping -c 1 -W 1 192.168.1.10')), /100% packet loss/, 'DMZ → LAN dropped');
  assert.match(all(dmz.run('ping -c 1 8.8.8.8')), / 0% packet loss/, 'DMZ → Internet allowed');
  assert.match(all(createShell(fw, 'linux', 'root').run('dmesg | tail -3')), /FW-DROP IN=eth2 OUT=eth1/);
});

test('DNS lab: local zone, forwarding with recursion for localnets only', () => {
  const t = lab('dns-reenvio');
  const pc = [...t.placed.values()].map((p) => p.device).find((d): d is Pc => d.kind === 'pc' && (d as Pc).os === 'linux' && (d as Pc).config.mode === 'dhcp')!;
  const guest = t.byLabel('INVITADO') as Pc;
  const sh = createShell(pc, 'linux');
  assert.equal(formatIp(pc.config.ip ?? 0), '192.168.50.50', 'DHCP reservation of the server');
  assert.match(all(sh.run('dig www.empresa.lan')), /flags: qr aa rd ra;[\s\S]*intranet\.empresa\.lan\.\s+\d+\s+IN\s+A\s+192\.168\.50\.2/);
  const g = all(sh.run('dig www.google.com'));
  assert.match(g, /status: NOERROR[\s\S]*flags: qr rd ra;[\s\S]*www\.google\.com\.\s+\d+\s+IN\s+A\s+142\.250\.184\.4/);
  assert.match(all(sh.run('ping -c 1 example.com')), / 0% packet loss/);
  const gsh = createShell(guest, 'linux');
  assert.match(all(gsh.run('dig www.empresa.lan')), /status: NOERROR/);
  assert.match(all(gsh.run('dig www.google.com')), /status: REFUSED/, 'no recursion for other networks');
});
