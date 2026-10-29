/**
 * Management GUI of a Server: what the device (Configuración tab) or its lab turns off is greyed out in the menu, its
 * page has no forms and a POST changes nothing; with «Ocultar en la gestión web…» it is left out altogether.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { parseIp } from '../../src/core/ip.ts';
import { deviceApps, setDeviceApps } from '../../src/net/device-apps.ts';
import { setFeature } from '../../src/net/lab-features.ts';

const URL = 'http://10.0.0.2:10000/';

function lab(): { t: Topology; srv: Server; web: BrowserEngine } {
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
  return { t, srv, web };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);

test('a service switched off in the device: greyed in the menu, a notice instead of its forms, a POST changes nothing', () => {
  const { srv, web } = lab();
  setDeviceApps(srv, deviceApps(srv).filter((a) => a !== 'dhcp'));
  const menu = body(web.open(`${URL}?page=status`));
  assert.match(menu, /<span class="web-adm-nav web-adm-nav-dhcp web-adm-off" aria-disabled="true" title="Desactivado en este equipo">DHCP<\/span>/);
  assert.match(menu, /<a href="\/\?page=dns" class="web-adm-nav web-adm-nav-dns">/, 'the others stay links');
  const page = body(web.open(`${URL}?page=dhcp`));
  assert.match(page, /Esta opción está desactivada en este equipo/);
  assert.doesNotMatch(page, /<form[^>]*page=dhcp/);
  const before = srv.services.dhcp.enabled;
  body(web.open(`${URL}?page=dhcp`, { method: 'POST', form: [['action', 'dhcp'], ['enabled', before ? '' : '1']] }));
  assert.equal(srv.services.dhcp.enabled, before, 'nothing ran');
});

test('what the lab turns off is off in the GUI as well; with the lab option it is not shown at all', () => {
  const { t, web } = lab();
  t.features = setFeature(t.features, 'server', 'mail', false);
  assert.match(body(web.open(`${URL}?page=status`)), /web-adm-nav-mail web-adm-off/);
  t.webHideOff = true;
  const menu = body(web.open(`${URL}?page=status`));
  assert.doesNotMatch(menu, /web-adm-nav-mail/);
  assert.match(body(web.open(`${URL}?page=mail`)), /web-adm-page-setup/, 'an unknown page: the first one');
});
