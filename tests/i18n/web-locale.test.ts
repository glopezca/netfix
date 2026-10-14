/** Simulated web pages answer in the visitor's language (Accept-Language), Spanish by default. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { createShell } from '../../src/shells/factory.ts';
import { setLocale, getLocale } from '../../src/i18n/locale.ts';
import { parseIp } from '../../src/core/ip.ts';

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);

test('the web admin follows the browser language; curl without Accept-Language gets Spanish', () => {
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
  assert.match(body(web.open('http://10.0.0.2:10000/?page=dhcp')), /<html lang="es">[\s\S]*Guardar cambios/);
  setLocale('en-GB');
  try {
    const page = body(web.open('http://10.0.0.2:10000/?page=dhcp'));
    assert.match(page, /<html lang="en">[\s\S]*DHCP server[\s\S]*Save settings/);
    assert.doesNotMatch(page, /Guardar cambios/);
    pc.os = 'linux';
    const curl = createShell(pc, 'linux').run("curl -s -u admin:admin 'http://10.0.0.2:10000/?page=dhcp'").join('\n');
    assert.match(curl, /Guardar cambios/, 'no Accept-Language → Spanish');
    const en = createShell(pc, 'linux').run("curl -s -u admin:admin -H 'Accept-Language: en-GB,en;q=0.9' 'http://10.0.0.2:10000/?page=dhcp'").join('\n');
    assert.match(en, /Save settings/);
  } finally {
    setLocale('es-ES');
  }
  assert.equal(getLocale(), 'es-ES', 'rendering in another language never leaks into the app');
});
