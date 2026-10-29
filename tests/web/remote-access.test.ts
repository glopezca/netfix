/**
 * Remote management (web GUI) and Roundcube on a Server and on a GNU/Linux router, reached from a PC browser both on a port
 * of their own and as an alias of Apache: login, navigation inside the app, the files Apache shows, ss, persistence,
 * Apache on other ports, Apache stopped and changing the access at runtime.
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

type Kind = 'server' | 'linuxrouter';
type App = 'admin' | 'roundcube';
type Mode = 'port' | 'alias';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);

function lab(kind: Kind): { t: Topology; srv: Server; pc: Pc; root: (cmd: string) => string } {
  const t = new Topology();
  const srv = t.add(kind, 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  const root = (cmd: string): string => plain(createShell(srv, 'linux', 'root').run(cmd).join('\n'));
  if (kind === 'server') srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  else root('ip addr add 10.0.0.2/24 dev eth0');
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  srv.setServices({ ...srv.services, mail: { ...srv.services.mail, smtp: true, imap: true, domain: 'aula.lab', users: [{ name: 'ana', password: 'ana1' }] } });
  t.settle();
  return { t, srv, pc, root };
}

function enable(srv: Server, app: App, mode: Mode, over: Partial<{ alias: string; port: number }> = {}): void {
  const w = srv.services.webapps;
  srv.setServices({ ...srv.services, webapps: { ...w, [app]: { ...w[app], enabled: true, mode, ...over } } });
}

const urlOf = (srv: Server, app: App): string => {
  const a = srv.services.webapps[app];
  return a.mode === 'port' ? `http://10.0.0.2:${a.port}/` : `http://10.0.0.2${a.alias}/`;
};

/** Signs in and follows one link inside the app: the whole session stays under its port or alias. */
function useApp(srv: Server, pc: Pc, app: App): string[] {
  const web = new BrowserEngine(pc);
  const url = urlOf(srv, app);
  const prefix = srv.services.webapps[app].mode === 'alias' ? srv.services.webapps[app].alias : '';
  if (app === 'admin') {
    assert.equal(web.open(url).kind, 'auth', `${url} asks for credentials`);
    const home = body(web.login(url, 'admin', 'netfix'));
    assert.match(home, /Configuración básica/, url);
    assert.match(home, new RegExp(`href="${prefix}/\\?page=dhcp"`), 'links keep the prefix');
    const dns = body(web.open(`${url}?page=dns`));
    assert.match(dns, /DNS/);
    return [home, dns];
  }
  const login = body(web.open(url));
  assert.match(login, new RegExp(`action="${prefix}/\\?_task=login"`), url);
  const inbox = body(web.open(`${url}?_task=login`, { method: 'POST', form: [['_user', 'ana'], ['_pass', 'ana1']] }));
  assert.match(inbox, /Bandeja de entrada|Entrada|Inbox/i, `${url} inbox`);
  return [login, inbox];
}

for (const kind of ['server', 'linuxrouter'] as const) {
  for (const app of ['admin', 'roundcube'] as const) {
    for (const mode of ['port', 'alias'] as const) {
      test(`${kind}: ${app} by ${mode} — sign in and navigate from a PC; Apache's view and ss agree`, () => {
        const { srv, pc, root } = lab(kind);
        enable(srv, app, mode);
        useApp(srv, pc, app);
        const a = srv.services.webapps[app];
        const ss = root('ss -tln');
        if (mode === 'port') assert.match(ss, new RegExp(`\\*:${a.port}\\b`), `listening on ${a.port}`);
        const conf = root(`cat /etc/apache2/conf-enabled/${app === 'admin' ? 'netfix-admin' : 'roundcube'}.conf 2>&1`);
        if (mode === 'alias') assert.match(conf, new RegExp(`Alias ${a.alias} `), 'the alias is in Apache\'s configuration');
      });
    }
  }

  test(`${kind}: the access survives saving and loading the topology`, () => {
    const { t, srv } = lab(kind);
    enable(srv, 'roundcube', 'port', { port: 8081 });
    enable(srv, 'admin', 'alias', { alias: '/gestion' });
    const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
    const srv2 = [...again.placed.values()].find((p) => p.device.kind === kind)!.device as Server;
    const pc2 = [...again.placed.values()].find((p) => p.device.kind === 'pc')!.device as Pc;
    useApp(srv2, pc2, 'roundcube');
    useApp(srv2, pc2, 'admin');
  });

  test(`${kind}: an alias also answers on the other ports Apache listens on`, () => {
    const { srv, pc, root } = lab(kind);
    enable(srv, 'roundcube', 'alias');
    root("echo 'Listen 8888' >> /etc/apache2/ports.conf && systemctl reload apache2");
    assert.match(body(new BrowserEngine(pc).open('http://10.0.0.2:8888/roundcube/')), /_task=login/);
  });

  test(`${kind}: with Apache stopped, the GUI on its own port still answers; aliases and Roundcube do not`, () => {
    const { srv, pc, root } = lab(kind);
    enable(srv, 'admin', 'port');
    enable(srv, 'roundcube', 'alias');
    root('systemctl stop apache2');
    assert.equal(new BrowserEngine(pc).open('http://10.0.0.2:10000/').kind, 'auth');
    assert.notEqual(new BrowserEngine(pc).open('http://10.0.0.2/roundcube/').kind, 'page');
  });

  test(`${kind}: moving an app from a port to an alias closes the old port`, () => {
    const { srv, pc, root } = lab(kind);
    enable(srv, 'roundcube', 'port', { port: 8082 });
    useApp(srv, pc, 'roundcube');
    enable(srv, 'roundcube', 'alias', { alias: '/correo' });
    useApp(srv, pc, 'roundcube');
    assert.doesNotMatch(root('ss -tln'), /\*:8082\b/);
    assert.notEqual(new BrowserEngine(pc).open('http://10.0.0.2:8082/').kind, 'page');
  });
}

for (const kind of ['server', 'linuxrouter'] as const) {
  for (const mode of ['port', 'alias'] as const) {
    test(`${kind}: by ${mode}, every GUI page, a saved form and Roundcube's whole round (send, read, log out) stay inside the app`, () => {
      const { t, srv, pc } = lab(kind);
      enable(srv, 'admin', mode);
      enable(srv, 'roundcube', mode);
      const prefix = (app: App): string => (mode === 'alias' ? srv.services.webapps[app].alias : '');
      const admin = new BrowserEngine(pc);
      const a = urlOf(srv, 'admin');
      admin.login(a, 'admin', 'netfix');
      for (const page of ['setup', 'dhcp', 'dns', 'web', 'mail', 'ssh', 'admin', 'status', 'log', ...(kind === 'linuxrouter' ? ['firewall', 'routing', 'vpn'] : [])]) {
        const html = body(admin.open(`${a}?page=${page}`));
        assert.match(html, /<html/, `${page}`);
        const outside = (html.match(/(?:href|action)="\/[^"]*"/g) ?? []).filter((l) => !l.includes(`"${prefix('admin')}/`));
        assert.deepEqual(outside, [], `${page}: every link under ${prefix('admin') || '/'}`);
      }
      admin.open(`${a}?page=dns`, { method: 'POST', form: [['action', 'zone-add'], ['z_name', 'aula.lab'], ['z_ns', 'ns.aula.lab'], ['z_kind', 'forward']] });
      admin.open(`${a}?page=dns`, { method: 'POST', form: [['action', 'zone-record-add'], ['zone', 'aula.lab'], ['name', 'www'], ['type', 'A'], ['value', '10.0.0.2'], ['ttl', '3600']] });
      assert.ok(srv.services.dns.zones.some((z) => z.records.some((r) => r.name === 'www')), 'the form was saved');
      const rc = new BrowserEngine(pc);
      const r = urlOf(srv, 'roundcube');
      rc.open(`${r}?_task=login`, { method: 'POST', form: [['_action', 'login'], ['_user', 'ana'], ['_pass', 'ana1']] });
      assert.match(body(rc.open(`${r}?_task=mail&_action=compose`)), new RegExp(`action="${prefix('roundcube')}/\\?_task=mail&amp;_action=send"|action="${prefix('roundcube')}/\\?_task=mail&_action=send"`));
      rc.open(`${r}?_task=mail&_action=send`, { method: 'POST', form: [['_to', 'ana@aula.lab'], ['_subject', 'Prueba remota'], ['_message', 'Hola desde el aula']] });
      t.settle(5000);
      const inbox = body(rc.open(`${r}?_task=mail&_mbox=INBOX`));
      const show = /href="([^"]*_action=show[^"]*)"/.exec(inbox)?.[1]?.replace(/&amp;/g, '&');
      assert.ok(show?.startsWith(`${prefix('roundcube')}/`), `message link under the app: ${show}`);
      assert.match(body(rc.open(`http://10.0.0.2${mode === 'port' ? `:${srv.services.webapps.roundcube.port}` : ''}${show}`)), /Hola desde el aula/);
      assert.match(body(rc.open(`${r}?_task=logout`)), /_task=login/);
      assert.doesNotMatch(body(rc.open(`${r}?_task=mail&_mbox=INBOX`)), /Prueba remota/, 'signed out');
    });
  }
}

test('from a terminal: curl -I gives the real Content-Length, curl -w prints the status, wget -qO- prints the page', () => {
  const { srv, pc } = lab('server');
  enable(srv, 'roundcube', 'port');
  enable(srv, 'admin', 'alias');
  const sh = createShell(pc, 'linux');
  const run = (c: string): string => plain(sh.run(c).join('\n'));
  const bytes = run('curl -s http://10.0.0.2:8080/ | wc -c').trim();
  assert.match(run('curl -sI http://10.0.0.2:8080/'), new RegExp(`Content-Length: ${bytes}\\b`));
  assert.equal(run("curl -s -o /dev/null -w '%{http_code}' http://10.0.0.2:8080/"), '200');
  assert.equal(run("curl -s -o /dev/null -w '%{http_code}\\n' http://10.0.0.2/admin/"), '401');
  assert.equal(run("curl -s -o /dev/null -w '%{http_code}' -u admin:netfix http://10.0.0.2/admin/"), '200');
  assert.match(run('wget -qO- http://10.0.0.2:8080/'), /^<!doctype html>/);
  assert.doesNotMatch(run('ls'), /index\.html/, 'wget -O- writes no file');
});

test('ss shows Apache listening on every address, as on Ubuntu', () => {
  const { srv, root } = lab('server');
  enable(srv, 'roundcube', 'port');
  assert.match(root('ss -tlnp'), /LISTEN\s+0\s+511\s+\*:80\s+\*:\*\s+users:\(\("apache2"/);
  assert.match(root('ss -tln'), /\*:8080\s+\*:\*/);
});

test('curl -w also reports failed transfers (000, and the status with -f); wget -O- and -O/path split like getopt', () => {
  const { srv, pc } = lab('server');
  enable(srv, 'roundcube', 'port');
  const sh = createShell(pc, 'linux');
  const run = (c: string): string => plain(sh.run(c).join('\n'));
  assert.equal(run("curl -s -o /dev/null -w '%{http_code}' http://10.0.0.99/"), '000');
  assert.equal(run("curl -sf -o /dev/null -w '%{http_code}' http://10.0.0.2/no-such-page"), '404');
  assert.match(run('curl -fsSL http://10.0.0.2:8080/'), /^<!doctype html>/, 'the -fsSL cluster');
  assert.equal(run("curl -s -o /dev/null -w '100%%\\r' http://10.0.0.2:8080/"), '100%\r');
  assert.match(run('wget -O- http://10.0.0.2:8080/ 2>/dev/null'), /^<!doctype html>/);
  assert.match(run('wget -T10 -qO- http://10.0.0.2:8080/'), /^<!doctype html>/);
  run('wget -q -O/tmp/rc.html http://10.0.0.2:8080/');
  assert.match(run('head -c 15 /tmp/rc.html'), /^<!doctype html>/);
  assert.doesNotMatch(run('ls'), /index\.html/, 'no stray index.html');
  const bytes = run('curl -s http://10.0.0.2:8080/ | wc -c').trim();
  assert.match(run('wget -O /tmp/b.html http://10.0.0.2:8080/ 2>&1'), new RegExp(`Length: ${bytes} .*saved \\[${bytes}/${bytes}\\]`, 's'));
});
