/**
 * Servicios → Configuración and Registros list only what is installed: a service whose box is off in the device's
 * Configuración tab (or that apt removed) brings neither its files nor its journal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Server } from '../../src/devices/server.ts';
import { deviceApps, freshApps, setDeviceApps } from '../../src/net/device-apps.ts';
import type { FeatureId } from '../../src/net/lab-features.ts';
import { configSources } from '../../src/services/config-files.ts';
import { setFeature } from '../../src/net/lab-features.ts';
import { installedLogUnits } from '../../src/services/installed-units.ts';

/** As the palette leaves it: no service (ui/os-dialog.ts afterPlaced). */
function placed(kind: 'server' | 'linuxrouter'): Server {
  const d = new Topology().add(kind, 0, 0).device as Server;
  setDeviceApps(d, freshApps(d));
  return d;
}

const tick = (d: Server, ...ids: FeatureId[]): void => setDeviceApps(d, [...deviceApps(d), ...ids]);
const sources = (d: Server): string[] => configSources(d).map((s) => s.id);
const units = (d: Server): string[] => installedLogUnits(d).map((u) => u.linux);

test('a server placed from the palette: only the kernel parameters in Configuración, nothing in Registros', () => {
  const srv = placed('server');
  assert.deepEqual(sources(srv), ['sysctl']);
  assert.deepEqual(units(srv), []);
});

test('ticking a service brings its files and its unit; unticking takes them away', () => {
  const srv = placed('server');
  tick(srv, 'dns', 'ssh');
  assert.deepEqual(sources(srv), ['sysctl', 'ssh', 'dns']);
  assert.deepEqual(units(srv), ['ssh', 'named']);
  setDeviceApps(srv, deviceApps(srv).filter((id) => id !== 'dns'));
  assert.deepEqual(sources(srv), ['sysctl', 'ssh']);
  assert.deepEqual(units(srv), ['ssh']);
});

test('mail: postfix and dovecot go with the mail box, and a stopped one stays listed', () => {
  const srv = placed('server');
  tick(srv, 'mail');
  srv.setServices({ ...srv.services, mail: { ...srv.services.mail, smtp: false, imap: false, pop3: false } });
  assert.deepEqual(units(srv), ['postfix', 'dovecot']);
});

test('a lab with nothing to show: no source at all (the panel says so instead of showing SSH)', () => {
  const t = new Topology();
  t.features = setFeature(t.features, 'server', 'sysctl', false);
  const srv = t.add('server', 0, 0).device as Server;
  setDeviceApps(srv, freshApps(srv));
  assert.deepEqual(sources(srv), []);
});

test('a GNU/Linux router: the firewall and the VPN only when their box is on', () => {
  const r = placed('linuxrouter');
  assert.deepEqual(sources(r).filter((id) => id === 'firewall' || id === 'vpn'), []);
  assert.deepEqual(units(r), []);
  tick(r, 'firewall', 'vpn');
  assert.deepEqual(sources(r).filter((id) => id === 'firewall' || id === 'vpn'), ['firewall', 'vpn']);
  assert.deepEqual(units(r), ['nftables']);
});

test('the servers of the recorded labs keep everything they run', () => {
  const srv = new Topology().add('server', 0, 0).device as Server;
  assert.deepEqual(sources(srv), ['sysctl', 'ssh', 'dhcp', 'dns', 'http', 'mail']);
});
