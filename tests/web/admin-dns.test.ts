/**
 * DNS page of the management GUI (Server and Linux router): mode cards in order, per-mode settings, the zone wizard
 * (SOA → NS → kind → records), the automatic reverse zone and the generated BIND configuration next to them.
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

function lab(kind: 'server' | 'linuxrouter' = 'server'): { srv: Server; pc: Pc; web: BrowserEngine } {
  const t = new Topology();
  const srv = t.add(kind, 0, 0).device as Server;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: srv.id, port: srv.portNames()[0]! }, { device: pc.id, port: 'FastEthernet0' });
  if (kind === 'server') srv.setStatic({ ip: parseIp('10.0.0.2')!, prefix: 24 });
  else createShell(srv, 'linux', 'root').run('ip addr add 10.0.0.2/24 dev eth0');
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, dns: parseIp('10.0.0.2')! });
  srv.setServices({ ...srv.services, webapps: { ...srv.services.webapps, admin: { ...srv.services.webapps.admin, enabled: true } } });
  t.settle();
  const web = new BrowserEngine(pc);
  web.login(URL, 'admin', 'netfix');
  return { srv, pc, web };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const open = (web: BrowserEngine, q: string): string => body(web.open(`${URL}?page=dns${q}`));
const post = (web: BrowserEngine, form: [string, string][]): string => body(web.open(`${URL}?page=dns`, { method: 'POST', form }));

for (const kind of ['server', 'linuxrouter'] as const) {
  test(`${kind}: five mode cards in order, per-mode tabs and the generated configuration explained`, () => {
    const { web } = lab(kind);
    const page = open(web, '');
    const cards = [...page.matchAll(/class="web-adm-mode web-adm-mode-(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(cards, ['cache', 'forwarder', 'authoritative', 'iterative', 'recursive']);
    const tabs = [...page.matchAll(/class="web-adm-tab web-adm-tab-(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, ['cache', 'forwarder', 'authoritative', 'iterative', 'recursive']);
    assert.match(page, /Configuración generada[\s\S]*<span class="web-adm-line">options \{<\/span>/);
    assert.match(page, /Explicación de la configuración[\s\S]*recursion no: solo responde por sus zonas/);
    assert.match(page, /Necesita el modo Recursivo/, 'the iterative card says why it is locked');
  });
}

test('the mode cards apply together: recursion with Google forwarders, forward first through the iterative switch', () => {
  const { srv, web } = lab();
  post(web, [['action', 'dns-modes'], ['enabled', '1'], ['cache', '1'], ['forwarder', '1'], ['authoritative', '1'], ['recursive', '1']]);
  const s = srv.services.dns;
  assert.equal(s.enabled, true);
  assert.equal(s.recursion, true);
  assert.deepEqual(s.forwarders?.length, 2);
  assert.equal(s.forwardOnly, true);
  post(web, [['action', 'dns-modes'], ['enabled', '1'], ['cache', '1'], ['forwarder', '1'], ['authoritative', '1'], ['iterative', '1'], ['recursive', '1']]);
  assert.equal(srv.services.dns.forwardOnly, false, 'iterative on = forward first');
  assert.match(open(web, '&mode=cache'), /max-cache-ttl 604800;/);
  post(web, [['action', 'dns-cache'], ['ttl', '0'], ['mode', 'cache']]);
  assert.equal(srv.services.dns.maxCacheTtl, 0);
  assert.match(post(web, [['action', 'dns-cache'], ['ttl', 'mucho'], ['mode', 'cache']]), /web-adm-error[\s\S]*max-cache-ttl es un número/);
  post(web, [['action', 'dns-recursive'], ['allow', 'any']]);
  assert.equal(srv.services.dns.recursion, false, 'an unticked recursion box turns it off');
  assert.equal(srv.services.dns.allowRecursion, 'any');
});

test('the zone wizard: SOA, then NS, then kind; a bad step comes back with its error and what was typed', () => {
  const { web } = lab();
  assert.match(open(web, '&mode=authoritative'), /Nueva zona…/);
  const step1 = open(web, '&mode=authoritative&wiz=1');
  assert.match(step1, /<li class="web-adm-on">Paso 1 · Registro SOA/);
  assert.match(step1, /<form method="get" action="\/"><input type="hidden" name="page" value="dns">/);
  const step2 = open(web, '&mode=authoritative&wiz=2&z_name=aula.lab');
  assert.match(step2, /<li class="web-adm-on">Paso 2 · Servidores de nombres/);
  assert.match(step2, /name="z_mname" value="ns\.aula\.lab"/, 'the SOA travels hidden, with its defaults');
  assert.match(step2, /name="z_ns" value="ns\.aula\.lab"/, 'the primary server is the first NS by default');
  const back = open(web, '&mode=authoritative&wiz=2&z_name=mal..zona');
  assert.match(back, /<li class="web-adm-on">Paso 1 · Registro SOA[\s\S]*web-adm-error/);
  assert.match(back, /name="z_name" value="mal\.\.zona"/);
  const step3 = open(web, '&mode=authoritative&wiz=3&z_name=aula.lab&z_ns=');
  assert.match(step3, /<li class="web-adm-on">Paso 2[\s\S]*al menos un servidor de nombres/, 'no NS: back to step 2');
});

test('a forward zone gets its records and its automatic reverse zone; dig answers both from a PC', () => {
  const { srv, pc, web } = lab();
  post(web, [['action', 'dns-modes'], ['enabled', '1'], ['cache', '1'], ['authoritative', '1']]);
  const created = web.open(`${URL}?page=dns`, { method: 'POST', form: [['action', 'zone-add'], ['mode', 'authoritative'], ['z_name', 'aula.lab'], ['z_mname', 'ns.aula.lab'], ['z_email', 'admin@aula.lab'], ['z_ns', 'ns.aula.lab'], ['z_kind', 'forward']] });
  assert.ok(created.kind === 'page' && created.url.includes('zone=aula.lab'), 'back on the new zone');
  const editor = body(created);
  assert.match(editor, /Paso 4 · Registros — Zona aula\.lab/);
  assert.match(editor, /<select name="type"><option value="A" selected>A<\/option><option value="CNAME">CNAME[\s\S]*<option value="TXT">TXT<\/option><\/select>/);
  assert.match(editor, /ns\.aula\.lab está dentro de la zona y no tiene registro A/);
  post(web, [['action', 'zone-record-add'], ['zone', 'aula.lab'], ['type', 'A'], ['name', 'ns'], ['value', '10.0.0.2']]);
  post(web, [['action', 'zone-record-add'], ['zone', 'aula.lab'], ['type', 'A'], ['name', 'www'], ['value', '10.0.0.20']]);
  const list = open(web, '&mode=authoritative');
  assert.match(list, /0\.0\.10\.in-addr\.arpa<\/a><\/td><td>Inversa[\s\S]*web-adm-badge-auto">Automática/);
  assert.match(list, /genera automáticamente la zona inversa/);
  const reverse = open(web, '&mode=authoritative&zone=0.0.10.in-addr.arpa');
  assert.match(reverse, /20<\/td><td>PTR<\/td><td class="web-adm-mono">www\.aula\.lab\./);
  assert.doesNotMatch(reverse, /name="action" value="zone-record-add"/, 'automatic zones are not edited');
  const sh = createShell(pc, 'linux');
  assert.match(sh.run('dig +short www.aula.lab').join('\n'), /^10\.0\.0\.20$/m);
  assert.match(sh.run('dig +short -x 10.0.0.20').join('\n'), /^www\.aula\.lab\.$/m);
  assert.match(open(web, '&mode=authoritative&file=local'), /zone &quot;0\.0\.10\.in-addr\.arpa&quot;/);
  assert.equal(srv.services.dns.zones.length, 1, 'the reverse zone is generated, not stored');
});

test('a reverse zone only admits PTR; names and values are escaped in the page', () => {
  const { srv, web } = lab();
  post(web, [['action', 'zone-add'], ['z_name', '192.168.1'], ['z_ns', 'ns.aula.lab'], ['z_kind', 'reverse']]);
  assert.equal(srv.services.dns.zones[0]?.name, '1.168.192.in-addr.arpa');
  assert.match(post(web, [['action', 'zone-record-add'], ['zone', '1.168.192.in-addr.arpa'], ['type', 'A'], ['name', '5'], ['value', '192.168.1.5']]), /no admite registros A/);
  post(web, [['action', 'zone-record-add'], ['zone', '1.168.192.in-addr.arpa'], ['type', 'PTR'], ['name', '5'], ['value', 'pc5.aula.lab.']]);
  assert.equal(srv.services.dns.zones[0]?.records[0]?.type, 'PTR');
  post(web, [['action', 'zone-add'], ['z_name', 'aula.lab'], ['z_ns', 'ns.aula.lab'], ['z_kind', 'forward']]);
  post(web, [['action', 'zone-record-add'], ['zone', 'aula.lab'], ['type', 'TXT'], ['name', 'x'], ['value', '<script>alert(1)</script>']]);
  const page = open(web, '&mode=authoritative&zone=aula.lab&file=zones');
  assert.doesNotMatch(page, /<script>/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(post(web, [['action', 'zone-add'], ['z_name', '<b>x</b>'], ['z_ns', 'ns.x'], ['z_kind', 'forward']]), /Nombre de zona no válido: «&lt;b&gt;x&lt;\/b&gt;»/);
});

test('cache, forwarder and iterative tabs: their forms, the flush and the root servers', () => {
  const { srv, web } = lab();
  const cache = open(web, '&mode=cache');
  assert.match(cache, /<li class="web-adm-on"><a href="\/\?page=dns&amp;mode=cache" class="web-adm-tab web-adm-tab-cache">Caché/);
  assert.match(cache, /name="action" value="dns-cache"[\s\S]*name="ttl" value="604800"/);
  assert.match(cache, /La caché está vacía/);
  const flushed = web.open(`${URL}?page=dns`, { method: 'POST', form: [['action', 'dns-flush'], ['mode', 'cache']] });
  assert.ok(flushed.kind === 'page' && flushed.url.includes('mode=cache'));
  post(web, [['action', 'dns-forwarders'], ['forwarders', '8.8.8.8'], ['mode', 'forwarder']]);
  assert.match(open(web, '&mode=forwarder'), /name="forwarders" value="8\.8\.8\.8"/);
  assert.match(open(web, '&mode=iterative'), /a\.root-servers\.net<\/td><td class="web-adm-mono">198\.41\.0\.4/);
  assert.match(open(web, '&mode=iterative'), /Necesita el modo Recursivo/, 'no recursion: no forward first/only form');
  post(web, [['action', 'dns-recursive'], ['recursion', '1'], ['allow', 'localnets']]);
  assert.match(open(web, '&mode=iterative'), /name="action" value="dns-iterative"[\s\S]*forward only: SERVFAIL/);
  post(web, [['action', 'dns-iterative'], ['forward', 'first'], ['mode', 'iterative']]);
  assert.equal(srv.services.dns.forwardOnly, false);
  assert.match(open(web, '&mode=recursive'), /name="recursion" value="1" checked/);
});
