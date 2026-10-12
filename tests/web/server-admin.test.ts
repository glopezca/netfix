/** Server management GUI (WRT300N style) used from a PC browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp, formatIp } from '../../src/core/ip.ts';

function lab(): { t: Topology; srv: Server; pc: Pc; web: BrowserEngine } {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  return { t, srv, pc, web: new BrowserEngine(pc) };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const post = (web: BrowserEngine, page: string, form: [string, string][]): BrowseResult => web.open(`http://10.0.0.2:10000/?page=${page}`, { method: 'POST', form });

test('asks for credentials (HTTP Basic) on port 10000 and shows the Setup page', () => {
  const { web } = lab();
  const first = web.open('http://10.0.0.2:10000/');
  assert.deepEqual(first.kind === 'auth' ? [first.realm, first.failed] : first.kind, ['Server', false]);
  const wrong = web.login('http://10.0.0.2:10000/', 'admin', 'x');
  assert.equal(wrong.kind === 'auth' && wrong.failed, true);
  const ok = web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  assert.match(body(ok), /<title>Server · Configuración básica<\/title>/);
  assert.match(body(ok), /class="web-wrt-tab web-wrt-on"><a href="\/\?page=setup">Configuración/);
  assert.match(body(ok), /name="hostname" value="server0"/i);
});

test('changes made in the GUI apply to the server: hostname, DNS records, mail users, SSH', () => {
  const { srv, web } = lab();
  web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  const saved = post(web, 'setup', [['action', 'setup'], ['hostname', 'srv-web'], ['mode', 'static'], ['ip', '10.0.0.2'], ['mask', '255.255.255.0'], ['gateway', '10.0.0.1'], ['dns', '10.0.0.2']]);
  assert.match(body(saved), /Los cambios se han guardado correctamente/);
  assert.equal(srv.name, 'srv-web');
  assert.equal(srv.config.gateway, parseIp('10.0.0.1'));
  post(web, 'dns', [['action', 'dns'], ['enabled', '1'], ['origin', 'aula.lab']]);
  post(web, 'dns', [['action', 'record-add'], ['name', 'www'], ['type', 'A'], ['value', '10.0.0.2']]);
  const bad = post(web, 'dns', [['action', 'record-add'], ['name', 'mal nombre'], ['type', 'A'], ['value', '10.0.0.2']]);
  assert.match(body(bad), /web-wrt-error/);
  assert.deepEqual(srv.services.dns.records.map((r) => r.name), ['www']);
  assert.equal(srv.services.dns.enabled, true);
  post(web, 'mail', [['action', 'user-add'], ['name', 'eva'], ['password', 'eva1']]);
  assert.deepEqual(srv.services.mail.users.map((u) => u.name), ['eva']);
  post(web, 'ssh', [['action', 'ssh'], ['enabled', '1']]);
  post(web, 'ssh', [['action', 'user-add'], ['name', 'root2'], ['password', 'x']]);
  assert.equal(srv.services.ssh.enabled, true);
  assert.match(createShell(srv, 'linux', 'root').run('journalctl -u apache2').join('\n'), /netfix-webui: admin desde 10\.0\.0\.10 → ssh: guardado/);
});

test('moving the GUI to an alias on Apache redirects the browser there', () => {
  const { srv, web, pc } = lab();
  web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  const moved = post(web, 'admin', [['action', 'admin'], ['user', 'admin'], ['password', 'nueva'], ['mode', 'alias'], ['alias', '/gestion'], ['port', '10000']]);
  assert.equal(moved.kind, 'auth', 'new location, new credentials');
  assert.equal(moved.url, 'http://10.0.0.2/gestion/?page=admin&saved=1');
  assert.equal(srv.services.webapps.admin.password, 'nueva');
  assert.match(body(web.login(moved.url, 'admin', 'nueva')), /Los cambios se han guardado/);
  assert.equal(new BrowserEngine(pc).open('http://10.0.0.2:10000/').kind, 'error', 'port 10000 is closed now');
  assert.match(createShell(srv, 'linux', 'root').run('cat /etc/apache2/conf-enabled/netfix-admin.conf').join('\n'), /^Alias \/gestion \/usr\/share\/netfix-admin$/m);
});

test('status and log pages, and curl with -u', () => {
  const { pc } = lab();
  const sh = createShell(pc, 'linux');
  assert.match(sh.run('curl -s -o /dev/null -w "%{http_code}" http://10.0.0.2:10000/; curl -si http://10.0.0.2:10000/ | head -1').join('\n'), /HTTP\/1\.1 401 Unauthorized/);
  assert.match(sh.run('curl -s -u admin:admin "http://10.0.0.2:10000/?page=status"').join('\n'), /Ubuntu 26\.04 LTS[\s\S]*kea-dhcp4-server/);
});

test('DHCP page: reservations by MAC, hexadecimal and ASCII client-id, and from the lease table', () => {
  const { srv, pc, web, t } = lab();
  web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  post(web, 'dhcp', [['action', 'dhcp'], ['enabled', '1']]);
  post(web, 'dhcp', [['action', 'pool-add'], ['name', 'LAN'], ['start', '10.0.0.100'], ['mask', '255.255.255.0'], ['max', '20'], ['gateway', '10.0.0.1'], ['dns', '10.0.0.2'], ['domain', '']]);
  const byMac = post(web, 'dhcp', [['action', 'res-add'], ['pool', 'LAN'], ['ip', '10.0.0.50'], ['kind', 'mac'], ['id', '0001.42ab.cdef'], ['name', 'impresora']]);
  assert.match(body(byMac), /Los cambios se han guardado/);
  post(web, 'dhcp', [['action', 'res-add'], ['pool', 'LAN'], ['ip', '10.0.0.51'], ['kind', 'hex'], ['id', '0100.0142.abcd.e0'], ['name', '']]);
  post(web, 'dhcp', [['action', 'res-add'], ['pool', 'LAN'], ['ip', '10.0.0.52'], ['kind', 'ascii'], ['id', 'aula-pc-01'], ['name', '']]);
  const bad = post(web, 'dhcp', [['action', 'res-add'], ['pool', 'LAN'], ['ip', '10.0.1.9'], ['kind', 'mac'], ['id', '0001.42ab.0000'], ['name', '']]);
  assert.match(body(bad), /web-wrt-error/);
  const pool = () => srv.services.dhcp.pools.find((p) => p.name === 'LAN')!;
  assert.deepEqual(pool().reservations.map((r) => [r.ip, r.mac ?? r.clientId]), [[parseIp('10.0.0.50'), '000142abcdef'], [parseIp('10.0.0.51'), '01000142abcde0'], [parseIp('10.0.0.52'), '61756c612d70632d3031']]);
  const page = body(web.open('http://10.0.0.2:10000/?page=dhcp'));
  assert.match(page, /MAC 0001\.42ab\.cdef[\s\S]*impresora/i);
  assert.match(page, /Client-ID 0100\.0142\.abcd\.e0/i);
  // a PC that obtained an automatic lease is reserved from the lease table
  pc.useDhcp();
  t.settle();
  const leased = pc.config.ip!;
  assert.match(body(web.open('http://10.0.0.2:10000/?page=dhcp')), /Reservar por MAC/);
  post(web, 'dhcp', [['action', 'lease-reserve'], ['ip', formatIp(leased)], ['by', 'mac']]);
  assert.ok(pool().reservations.some((r) => r.ip === leased && r.mac === pc.mac));
  post(web, 'dhcp', [['action', 'res-del'], ['key', `LAN|${formatIp(parseIp('10.0.0.50')!)}`]]);
  assert.equal(pool().reservations.length, 3);
});
