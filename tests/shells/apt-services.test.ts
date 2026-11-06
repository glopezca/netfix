/**
 * Every service package of a Server, Samba included, follows the same rule: apt install ticks its box in the device's
 * Configuración tab and brings its panel to Servicios and its page to the web GUI; apt remove unticks it and takes them away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { Switch } from '../../src/devices/switch.ts';
import { createShell } from '../../src/shells/factory.ts';
import { appAvailable, freshApps, setDeviceApps } from '../../src/net/device-apps.ts';
import { hostPanels } from '../../src/net/pkg-units.ts';
import { hasPackage } from '../../src/net/host-packages.ts';
import { pageOff } from '../../src/web/admin-layout.ts';
import type { Server } from '../../src/devices/server.ts';

const run = (h: Server, cmd: string): string => createShell(h, 'linux', 'root').run(cmd).join('\n');

/** [package, device box (feature), web page]. */
const SERVICES: readonly (readonly [string, string, string])[] = [
  ['openssh-server', 'ssh', 'ssh'], ['kea-dhcp4-server', 'dhcp', 'dhcp'], ['bind9', 'dns', 'dns'], ['apache2', 'http', 'web'],
  ['postfix', 'mail', 'mail'], ['nftables', 'firewall', 'firewall'],
];

/**
 * A server placed from the palette (ui/os-dialog.ts afterPlaced: no service, Apache stopped) in the Samba lab, whose
 * GW gives it the way out to the Ubuntu archive.
 */
function placedServer(): Server {
  const t = EXAMPLES.find((e) => e.id === 'samba')!.build();
  const srv = t.add('server', 900, 400, { label: 'NUEVO' }).device as Server;
  t.connect({ device: srv.id, port: 'FastEthernet0' }, { device: (t.byLabel('Switch0') as Switch).id, port: 'FastEthernet0/23' });
  srv.setStatic({ ip: parseIp('172.20.0.11') ?? 0, prefix: 24, gateway: parseIp('172.20.0.1') ?? 0, dns: parseIp('8.8.8.8') ?? 0 });
  t.settle();
  srv.setServices({ ...srv.services, http: { ...srv.services.http, enabled: false } });
  setDeviceApps(srv, freshApps(srv));
  return srv;
}

test('apt install and apt remove of each service: the box, the Servicios panel and the web page follow', () => {
  const srv = placedServer();
  for (const [pkg, feature, page] of SERVICES) {
    assert.equal(appAvailable(srv, feature as never), false, `${pkg}: not there on a server placed from the palette`);
    assert.equal(pageOff(srv, page), true);
    assert.match(run(srv, `apt install -y ${pkg}; echo "status $?"`), /status 0$/, `${pkg}: apt reaches the archive`);
    assert.equal(appAvailable(srv, feature as never), true, `${pkg}: installed, the box is ticked`);
    assert.equal(pageOff(srv, page), false, `${pkg}: and the web page is on`);
    run(srv, `apt remove -y ${pkg}`);
    assert.equal(appAvailable(srv, feature as never), false, `${pkg}: removed, the box is unticked`);
    assert.equal(pageOff(srv, page), true);
  }
});

test('samba on a server placed from the palette: off at first, then the same as the other services', () => {
  const srv = placedServer();
  assert.equal(hasPackage(srv, 'samba'), false, 'the Samba box starts unticked');
  assert.ok(!hostPanels(srv).includes('samba'));
  assert.equal(pageOff(srv, 'samba'), true);
  run(srv, 'apt install -y samba');
  assert.ok(hostPanels(srv).includes('samba'));
  assert.equal(pageOff(srv, 'samba'), false);
  run(srv, 'apt remove -y samba');
  assert.ok(!hostPanels(srv).includes('samba'));
  assert.equal(pageOff(srv, 'samba'), true);
});
