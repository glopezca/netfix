/**
 * The management GUI of a Server or GNU/Linux router mirrors its window: the apt catalogue (Administración →
 * Paquetes), the kernel parameters and the firewall (Seguridad, a Server too), mDNS and winbind when installed, and
 * Windows sharing when the device has Windows. Each form does what the panel or box does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { parseIp } from '../../src/core/ip.ts';
import { appAvailable, deviceApps, setDeviceApps } from '../../src/net/device-apps.ts';
import { hasPackage } from '../../src/net/host-packages.ts';
import { avahiSettings, unitOn } from '../../src/shells/link-services.ts';
import { findWinShare, winShareOn } from '../../src/net/win-shares.ts';

const URL = 'http://10.0.0.2:10000/';

function lab(): { srv: Server; web: BrowserEngine } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  const web = new BrowserEngine(pc);
  web.login(URL, 'admin', 'netfix');
  return { srv, web };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const post = (web: BrowserEngine, page: string, form: [string, string][]): string => body(web.open(`${URL}?page=${page}`, { method: 'POST', form }));

test('the menu: Paquetes, Parámetros del kernel and the firewall on a Server; mDNS and winbind greyed until installed', () => {
  const { web } = lab();
  const menu = body(web.open(`${URL}?page=status`));
  for (const id of ['packages', 'sysctl', 'firewall']) assert.match(menu, new RegExp(`web-adm-nav-${id}`), id);
  assert.match(menu, /web-adm-nav-mdns web-adm-off/);
  assert.match(menu, /web-adm-nav-winbind web-adm-off/);
  assert.doesNotMatch(menu, /web-adm-nav-winshare/, 'no Windows: no sharing page');
  assert.doesNotMatch(menu, /web-adm-nav-routing|web-adm-nav-vpn/, 'routes and VPN: the router only');
});

test('Paquetes installs and removes as the package box does: bind9 brings the DNS box and avahi-daemon its page', () => {
  const { srv, web } = lab();
  setDeviceApps(srv, deviceApps(srv).filter((id) => id !== 'dns'));
  assert.match(body(web.open(`${URL}?page=packages`)), /bind9[\s\S]*No instalado/);
  post(web, 'packages', [['action', 'pkg'], ['name', 'bind9'], ['on', '1']]);
  assert.equal(appAvailable(srv, 'dns'), true);
  post(web, 'packages', [['action', 'pkg'], ['name', 'avahi-daemon'], ['on', '1']]);
  assert.equal(hasPackage(srv, 'avahi-daemon'), true);
  assert.doesNotMatch(body(web.open(`${URL}?page=status`)), /web-adm-nav-mdns web-adm-off/);
  post(web, 'packages', [['action', 'pkg'], ['name', 'nada'], ['on', '1']]);
  assert.equal(hasPackage(srv, 'nada'), false, 'only what the page lists');
});

test('mDNS and winbind pages: the daemon on or off, the published name, wins in nsswitch.conf', () => {
  const { srv, web } = lab();
  for (const name of ['avahi-daemon', 'winbind', 'libnss-winbind']) post(web, 'packages', [['action', 'pkg'], ['name', name], ['on', '1']]);
  post(web, 'mdns', [['action', 'mdns'], ['enabled', '1'], ['hostName', 'srv-aula'], ['publish', '1']]);
  assert.deepEqual(avahiSettings(srv), { hostName: 'srv-aula', publish: true });
  assert.match(post(web, 'mdns', [['action', 'mdns'], ['enabled', '1'], ['hostName', 'no válido'], ['publish', '1']]), /Nombre no válido/);
  post(web, 'winbind', [['action', 'winbind'], ['wins', '1']]);
  assert.equal(unitOn(srv, 'winbind'), false, 'unticked: stopped');
  assert.match(body(web.open(`${URL}?page=winbind`)), /name="wins" value="1" checked/);
});

test('Windows sharing: there once the server has Windows; shares added and removed, the remark escaped', () => {
  const { srv, web } = lab();
  setDeviceApps(srv, [...deviceApps(srv), 'windows']);
  assert.match(body(web.open(`${URL}?page=status`)), /web-adm-nav-winshare/);
  post(web, 'winshare', [['action', 'wsh-service'], ['enabled', '1']]);
  assert.equal(winShareOn(srv), true);
  post(web, 'winshare', [['action', 'wsh-add'], ['name', 'docs'], ['path', 'C:\\home'], ['remark', '<b>x</b>'], ['access', 'read']]);
  assert.ok(findWinShare(srv, 'docs'));
  const page = body(web.open(`${URL}?page=winshare`));
  assert.match(page, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(page, /<b>x<\/b>/);
  post(web, 'winshare', [['action', 'wsh-del'], ['name', 'docs']]);
  assert.equal(findWinShare(srv, 'docs'), undefined);
});

test('Parámetros del kernel: a value set from the page is the kernel\'s', () => {
  const { srv, web } = lab();
  post(web, 'sysctl', [['action', 'sysctl'], ['key', 'net.ipv4.ip_forward'], ['value', '1']]);
  assert.equal(srv.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
});

test('review: a form runs only on its own page — the lab\'s kernel switch, routes from Firewall, DHCP from Paquetes', () => {
  const { srv, web } = lab();
  post(web, 'firewall', [['action', 'route-add'], ['to', '192.168.9.0/24'], ['via', '10.0.0.10']]);
  assert.equal(srv.staticRoutes.length, 0, 'routes are the router\'s page');
  const before = srv.services.dhcp.enabled;
  post(web, 'packages', [['action', 'dhcp'], ['enabled', before ? '' : '1']]);
  assert.equal(srv.services.dhcp.enabled, before, 'the DHCP form only from its page');
  assert.match(post(web, 'sysctl', [['action', 'sysctl'], ['key', 'kernel.hostname'], ['value', 'a\nb']]), /una sola línea|single line/);
});

test('review: with the lab\'s kernel parameters off, their page is off and its form runs nothing', async () => {
  const { setFeature } = await import('../../src/net/lab-features.ts');
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.features = setFeature({}, 'server', 'sysctl', false);
  t.settle();
  const web = new BrowserEngine(pc);
  web.login(URL, 'admin', 'netfix');
  post(web, 'sysctl', [['action', 'sysctl'], ['key', 'net.ipv4.ip_forward'], ['value', '1']]);
  assert.equal(srv.kernel.sysctl.get('net.ipv4.ip_forward'), '0');
});
