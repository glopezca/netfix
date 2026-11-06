/**
 * avahi-daemon (mDNS) and winbind are services, not tools: in the catalogue as service packages, units of systemd,
 * a panel of their own in Servicios, their files in Configuración and their journal in Registros. What they do lasts
 * while they run. network-manager stays a tool (nmcli): its information is already in Interfaces and TCP/IP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Host } from '../../src/devices/host.ts';
import { SERVICE_PACKAGES, TOOL_PACKAGES } from '../../src/net/lab-packages.ts';
import { setAptInstalled } from '../../src/shells/apt-install.ts';
import { hostPanels, journalUnits } from '../../src/net/pkg-units.ts';
import { configSources } from '../../src/services/config-files.ts';
import { avahiSettings, setAvahiSettings, setUnitRunning, setWinsLookup, winsLookupOn } from '../../src/shells/link-services.ts';
import { DEFAULT_AVAHI_CONF, parseAvahiConf, withAvahiSettings } from '../../src/shells/avahi-conf.ts';

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const sh = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));
const win = (h: Host, cmd: string): string => createShell(h, 'windows').run(cmd).join('\n');
const lab = () => EXAMPLES.find((e) => e.id === 'basico')!.build();

test('the catalogue: avahi-daemon and winbind are service packages; network-manager is a tool', () => {
  for (const name of ['avahi-daemon', 'winbind']) {
    assert.ok((SERVICE_PACKAGES as readonly string[]).includes(name), name);
    assert.ok(!(TOOL_PACKAGES as readonly string[]).includes(name), name);
  }
  assert.ok((TOOL_PACKAGES as readonly string[]).includes('network-manager'));
});

test('avahi-daemon: a running unit with its panel, its file and its journal', () => {
  const pc1 = lab().byLabel('PC1') as Host;
  setAptInstalled(pc1, 'avahi-daemon', true);
  assert.equal(sh(pc1, 'systemctl is-active avahi-daemon'), 'active');
  assert.match(sh(pc1, 'grep -E "^use-ipv4|^\\[publish\\]" /etc/avahi/avahi-daemon.conf'), /^use-ipv4=yes\n\[publish\]$/);
  assert.ok(hostPanels(pc1).includes('mdns'));
  assert.ok(journalUnits(pc1).includes('avahi-daemon'));
  assert.ok(configSources(pc1).some((s) => s.id === 'mdns'));
  setAptInstalled(pc1, 'avahi-daemon', false);
  assert.ok(!hostPanels(pc1).includes('mdns'));
});

test('mDNS lasts while avahi-daemon runs, answers to the name it publishes, and not when publishing is off', () => {
  const t = lab();
  const [pc0, pc1] = [t.byLabel('PC0') as Host, t.byLabel('PC1') as Host];
  setAptInstalled(pc1, 'avahi-daemon', true);
  assert.match(win(pc0, 'ping -n 1 pc1.local'), /Reply from /);
  assert.match(sh(pc1, 'ping -c 1 pc0.local'), /1 received/, 'nss-mdns asks through avahi');
  setUnitRunning(pc1, 'avahi-daemon', false);
  assert.match(win(pc0, 'ping -n 1 pc1.local'), /could not find host/, 'stopped: nobody answers for pc1');
  assert.match(sh(pc1, 'ping -c 1 pc0.local 2>&1; echo "status $?"'), /status 2$/, 'nor does nss-mdns find anything');
  setUnitRunning(pc1, 'avahi-daemon', true);
  setAvahiSettings(pc1, { hostName: 'aula1', publish: true });
  assert.deepEqual(avahiSettings(pc1), { hostName: 'aula1', publish: true });
  assert.match(sh(pc1, 'grep ^host-name /etc/avahi/avahi-daemon.conf'), /^host-name=aula1$/);
  assert.match(win(pc0, 'ping -n 1 aula1.local'), /Reply from /, 'restarted with the new name');
  assert.match(win(pc0, 'ping -n 1 pc1.local'), /could not find host/);
  setAvahiSettings(pc1, { hostName: '', publish: false });
  assert.match(win(pc0, 'ping -n 1 pc1.local'), /could not find host/, 'publishing off');
  assert.match(sh(pc1, 'grep ^disable-publishing /etc/avahi/avahi-daemon.conf'), /^disable-publishing=yes$/);
});

test('winbind: «wins» in nsswitch.conf from its panel; NetBIOS names resolve while winbind runs', () => {
  const t = lab();
  const pc1 = t.byLabel('PC1') as Host;
  setAptInstalled(pc1, 'winbind', true);
  setAptInstalled(pc1, 'libnss-winbind', true);
  assert.ok(hostPanels(pc1).includes('winbind'));
  assert.equal(sh(pc1, 'systemctl is-active winbind'), 'active');
  assert.equal(winsLookupOn(pc1), false);
  setWinsLookup(pc1, true);
  assert.match(sh(pc1, 'grep ^hosts: /etc/nsswitch.conf'), /^hosts: .* wins$/);
  assert.match(sh(pc1, 'ping -c 1 pc0'), /1 received/);
  setUnitRunning(pc1, 'winbind', false);
  assert.match(sh(pc1, 'ping -c 1 pc2 2>&1; echo "status $?"'), /status 2$/, 'winbind stopped: wins finds nothing');
  setWinsLookup(pc1, false);
  assert.doesNotMatch(sh(pc1, 'grep ^hosts: /etc/nsswitch.conf'), /wins/);
});

test('review: the file as an administrator left it — a host-name line above the default is cleared too; is_yes', () => {
  const text = DEFAULT_AVAHI_CONF.replace('[server]\n', '[server]\nhost-name=lab\n');
  assert.equal(parseAvahiConf(text).hostName, 'lab');
  const cleared = withAvahiSettings(text, { hostName: '', publish: true });
  assert.equal(parseAvahiConf(cleared).hostName, '');
  assert.ok(cleared.endsWith('\n'));
  assert.equal(parseAvahiConf(withAvahiSettings('[server]\n', { hostName: '', publish: false })).publish, false, 'a [publish] section added');
  assert.equal(parseAvahiConf(DEFAULT_AVAHI_CONF.replace('#disable-publishing=no', 'disable-publishing=True')).publish, false);
});

test('review: applying the mDNS settings restarts avahi-daemon without enabling it', () => {
  const pc1 = lab().byLabel('PC1') as Host;
  setAptInstalled(pc1, 'avahi-daemon', true);
  sh(pc1, 'systemctl disable avahi-daemon');
  setAvahiSettings(pc1, { hostName: 'x1', publish: true });
  assert.equal(sh(pc1, 'systemctl is-enabled avahi-daemon'), 'disabled');
  assert.equal(sh(pc1, 'systemctl is-active avahi-daemon'), 'active');
});
