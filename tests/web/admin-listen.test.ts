/**
 * «Interfaces de escucha» in the management GUI: a box per interface (and lo for DNS) on the DHCP and DNS pages, as
 * Kea interfaces-config and BIND listen-on; «Todas» means * / any.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

const URL = 'http://10.0.0.2:10000/';

function lab(): { srv: Server; web: BrowserEngine } {
  const t = new Topology();
  const srv = t.add('linuxrouter', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  createShell(srv, 'linux', 'root').run('ip addr add 10.0.0.2/24 dev eth0; ip addr add 192.168.1.1/24 dev eth1');
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  const web = new BrowserEngine(pc);
  web.login(URL, 'admin', 'netfix');
  return { srv, web };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const post = (web: BrowserEngine, page: string, form: [string, string][]): string => body(web.open(`${URL}?page=${page}`, { method: 'POST', form }));

test('DHCP page: «Todas» by default, a box per NIC with its address; choosing one writes interfaces-config', () => {
  const { srv, web } = lab();
  const page = body(web.open(`${URL}?page=dhcp`));
  assert.match(page, /name="action" value="dhcp-listen"[\s\S]*name="all" value="1" checked/);
  assert.match(page, /name="if_eth1" value="1"[^>]*>[\s\S]*?192\.168\.1\.1\/24/);
  assert.doesNotMatch(page, /name="if_lo"/, 'Kea does not serve on lo');
  post(web, 'dhcp', [['action', 'dhcp-listen'], ['if_eth1', '1']]);
  assert.deepEqual(srv.services.dhcp.interfaces, ['eth1']);
  assert.match(body(web.open(`${URL}?page=dhcp`)), /name="if_eth1" value="1" checked/);
  assert.match(post(web, 'dhcp', [['action', 'dhcp-listen']]), /web-adm-error[\s\S]*al menos una interfaz/i);
  post(web, 'dhcp', [['action', 'dhcp-listen'], ['all', '1'], ['if_eth2', '1']]);
  assert.equal(srv.services.dhcp.interfaces, undefined);
});

test('DNS page: lo is offered; the choice becomes listen-on and is shown in the generated configuration', () => {
  const { srv, web } = lab();
  assert.match(body(web.open(`${URL}?page=dns`)), /name="action" value="dns-listen"[\s\S]*name="if_lo"/);
  const page = post(web, 'dns', [['action', 'dns-listen'], ['if_eth1', '1'], ['if_lo', '1']]);
  assert.deepEqual(srv.services.dns.listenOn, ['eth1', 'lo']);
  assert.match(page, /listen-on \{ 192\.168\.1\.1; 127\.0\.0\.1; \};/);
  assert.match(post(web, 'dns', [['action', 'dns-listen'], ['if_eth9', '1']]), /web-adm-error/);
});

test('Services lists SSH first; Estado → Ficheros shows each service\'s files as they are, escaped', () => {
  const { srv, web } = lab();
  const menu = body(web.open(`${URL}?page=ssh`));
  const ids = [...menu.matchAll(/\?page=(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id) => ['ssh', 'dhcp', 'dns', 'web', 'mail'].includes(id ?? '')).slice(0, 5), ['ssh', 'dhcp', 'dns', 'web', 'mail']);
  const files = body(web.open(`${URL}?page=files`));
  assert.match(files, /web-adm-on"><a href="\/\?page=files&amp;svc=sysctl"/, 'the router\'s first service by default');
  srv.setServices({ ...srv.services, dns: { ...srv.services.dns, listenOn: ['lo'] } });
  const dns = body(web.open(`${URL}?page=files&svc=dns`));
  assert.match(dns, /\/etc\/bind\/named\.conf\.options[\s\S]*listen-on \{ 127\.0\.0\.1; \};/);
  createShell(srv, 'linux', 'root').run('echo "<b>hola</b>" > /etc/bind/db.prueba');
  assert.match(body(web.open(`${URL}?page=files&svc=dns`)), /&lt;b&gt;hola&lt;\/b&gt;/);
  assert.match(body(web.open(`${URL}?page=files&svc=<x>`)), /\/etc\/nftables\.conf|\/etc\/sysctl/, 'an unknown service falls back to the first');
});

test('DNS page: «Nombres públicos» switches the policy zone, takes an edited list and restores the initial one', () => {
  const { srv, web } = lab();
  const page = body(web.open(`${URL}?page=dns`));
  assert.match(page, /name="action" value="dns-rpz"[\s\S]*<textarea name="list"[^>]*>[\s\S]*google\.es\s+A 142\.250\.200\.67/);
  post(web, 'dns', [['action', 'dns-rpz'], ['enabled', '1'], ['list', 'aula.lab A 10.0.0.9\n<b>x</b> A 1.1.1.1\n']]);
  assert.notEqual(srv.services.dns.publicNames?.enabled, true, 'a bad list changes nothing');
  assert.match(post(web, 'dns', [['action', 'dns-rpz'], ['enabled', '1'], ['list', '<b>x</b> A 1.1.1.1\n']]), /web-adm-error[^<]*bad owner name/);
  assert.doesNotMatch(post(web, 'dns', [['action', 'dns-rpz'], ['enabled', '1'], ['list', '<b>x</b> A 1.1.1.1\n']]), /<b>x<\/b>/, 'escaped');
  post(web, 'dns', [['action', 'dns-rpz'], ['enabled', '1'], ['list', 'aula.lab A 10.0.0.9\n']]);
  assert.equal(srv.services.dns.publicNames?.enabled, true);
  assert.equal(srv.services.dns.publicNames?.entries?.length, 1);
  post(web, 'dns', [['action', 'dns-rpz-initial'], ['enabled', '1']]);
  assert.equal(srv.services.dns.publicNames?.entries, undefined);
  assert.equal(srv.services.dns.publicNames?.enabled, true);
});
