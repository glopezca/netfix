/** Management GUI → Seguridad of the Linux router: firewall and routing pages (same model as the CLI and the Services tab). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';

function lab(): { srv: Server; web: BrowserEngine } {
  const t = new Topology();
  const srv = t.add('linuxrouter', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'GigabitEthernet0/0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  return { srv, web: new BrowserEngine(pc) };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const post = (web: BrowserEngine, page: string, form: [string, string][]): BrowseResult => web.open(`http://10.0.0.2:10000/?page=${page}`, { method: 'POST', form });

test('Seguridad → Firewall needs the login and applies templates and rules', () => {
  const { srv, web } = lab();
  assert.equal(web.open('http://10.0.0.2:10000/?page=firewall').kind, 'auth');
  web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  assert.match(body(web.open('http://10.0.0.2:10000/?page=firewall')), /Firewall[\s\S]*Plantilla/);
  post(web, 'firewall', [['action', 'fw-template'], ['template', 'hardening']]);
  assert.equal(srv.services.firewall.enabled, true);
  const page = body(web.open('http://10.0.0.2:10000/?page=firewall'));
  assert.match(page, /tcp dport 10000 accept comment &quot;gestion web&quot;/, 'the template keeps the GUI reachable');
  // Deleting that rule would lock us out: refused.
  const handle = /fw-rule-del[\s\S]*?name="key" value="inet filter input (\d+)"/.exec(page)?.[1] ?? '';
  assert.match(body(post(web, 'firewall', [['action', 'fw-rule-del'], ['key', `inet filter input ${handle}`]])), /te dejaría sin acceso/);
  post(web, 'firewall', [['action', 'fw-rule-add'], ['target', 'inet filter input'], ['ruleAction', 'accept'], ['proto', 'tcp'], ['dport', '80'], ['comment', '<script>alert(1)</script>']]);
  const after = body(web.open('http://10.0.0.2:10000/?page=firewall'));
  assert.doesNotMatch(after, /<script>alert/, 'user text is escaped');
  assert.match(after, /tcp dport 80 accept comment &quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;/);
  assert.doesNotMatch(after, /podrías perder el acceso/);
  const injected = body(post(web, 'firewall', [['action', 'fw-rule-add'], ['target', 'inet filter input'], ['ruleAction', 'accept'], ['iif', 'eth0" accept\nflush ruleset']]));
  assert.match(injected, /Revisa el campo «iif»/);
  assert.match(createShell(srv, 'linux', 'root').run('cat /etc/nftables.conf').join('\n'), /tcp dport 80 accept comment/);
});

test('Seguridad → Enrutamiento changes sysctl (saved) and static routes', () => {
  const { srv, web } = lab();
  web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  post(web, 'routing', [['action', 'sysctl-set'], ['key', 'net.ipv4.ip_forward'], ['value', '1']]);
  assert.equal(srv.kernel.sysctl.get('net.ipv4.ip_forward'), '1');
  assert.match(createShell(srv, 'linux', 'root').run('cat /etc/sysctl.d/99-netfix.conf').join('\n'), /^# Netfix[\s\S]*net\.ipv4\.ip_forward = 1$/);
  assert.match(body(post(web, 'routing', [['action', 'sysctl-set'], ['key', 'net.ipv4.ip_forward'], ['value', '7']])), /Invalid argument/);
  post(web, 'routing', [['action', 'route-add'], ['to', '172.16.0.0/16'], ['via', '10.0.0.10']]);
  assert.equal(srv.staticRoutes.length, 1);
  assert.match(body(post(web, 'routing', [['action', 'route-add'], ['to', '172.16.0.0/16'], ['via', '8.8.8.8']])), /Ruta no válida/);
  post(web, 'routing', [['action', 'route-del'], ['key', '172.16.0.0/16']]);
  assert.equal(srv.staticRoutes.length, 0);
});

test('a Server has no Seguridad tab in its management GUI (it belongs to the Linux router)', () => {
  const t = new Topology();
  const srv = t.add('server', 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: pc.id, port: 'FastEthernet0' });
  srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  const web = new BrowserEngine(pc);
  web.login('http://10.0.0.2:10000/', 'admin', 'admin');
  const page = body(web.open('http://10.0.0.2:10000/?page=firewall'));
  assert.doesNotMatch(page, /Plantilla|page=firewall/);
  assert.match(body(post(web, 'firewall', [['action', 'fw-template'], ['template', 'hardening']])), /.+/);
  assert.equal(srv.services.firewall.enabled, false);
});
