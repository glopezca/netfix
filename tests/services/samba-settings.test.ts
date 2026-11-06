/**
 * Samba in the settings: the lab feature Samba of PCs, servers and GNU/Linux routers (on by default, kept only when off),
 * the Samba box of a device's Configuración tab (installs or removes samba as apt does), the Samba page of the web
 * GUI of a Server or GNU/Linux router, and «Parámetros (sysctl)» among the configuration files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { FEATURES_BY_KIND, featureOn, setFeature } from '../../src/net/lab-features.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { createShell } from '../../src/shells/factory.ts';
import { hostPanels, sambaOffered } from '../../src/net/pkg-units.ts';
import { hasPackage, isPackageAuto } from '../../src/net/host-packages.ts';
import { setSambaInstalled } from '../../src/shells/samba-install.ts';
import { addSambaShare, removeSambaShare, sambaView } from '../../src/shells/samba-admin.ts';
import { configSources } from '../../src/services/config-files.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import type { Host } from '../../src/devices/host.ts';
import type { Server } from '../../src/devices/server.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { pagesOf, pageOff } from '../../src/web/admin-layout.ts';

const SAMBA_KINDS = ['pc', 'server', 'linuxrouter'] as const;
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const run = (h: Host, cmd: string): string => plain(createShell(h, 'linux', 'root').run(cmd).join('\n'));

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'samba')!.build();
  return { t, srv: t.byLabel('SRV') as Server, pc0: t.byLabel('PC0') as Host, pc1: t.byLabel('PC1') as Host };
}

test('Samba is a lab feature of PCs, servers and GNU/Linux routers, on by default; off, apt cannot find samba and its box and panel go', () => {
  const { t, srv, pc1 } = lab();
  for (const kind of SAMBA_KINDS) {
    assert.ok(FEATURES_BY_KIND[kind].includes('samba'), kind);
    assert.ok(featureOn(t.features, kind, 'samba'), `${kind}: on by default`);
  }
  assert.deepEqual(t.toJSON().features ?? {}, {}, 'the default is not written');
  assert.ok(sambaOffered(pc1));
  t.features = setFeature(setFeature(t.features, 'pc', 'samba', false), 'server', 'samba', false);
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(featureOn(again.features, 'pc', 'samba'), false, 'kept with the lab');
  assert.equal(featureOn(again.features, 'linuxrouter', 'samba'), true, 'each kind on its own');
  assert.equal(sambaOffered(pc1), false);
  assert.match(run(pc1, 'apt install -y samba; echo "status $?"'), /Error: Unable to locate package samba\nstatus 100$/);
  assert.equal(hasPackage(pc1, 'samba'), false);
  assert.match(run(pc1, 'apt install -y smbclient; echo "status $?"'), /status 0$/, 'the client tools are still there');
  assert.ok(!hostPanels(srv).includes('samba'), 'what is installed stays, without its panel');
  assert.equal(run(srv, 'systemctl is-active smbd'), 'active');
  t.features = setFeature(t.features, 'server', 'samba', true);
  assert.ok(hostPanels(srv).includes('samba'));
});

test('a file of v0.34 with «sambaOff» turns the Samba feature off for every kind', () => {
  const { t } = lab();
  const old = { ...t.toJSON(), sambaOff: true };
  const topo = Topology.fromJSON(JSON.parse(JSON.stringify(old)));
  for (const kind of SAMBA_KINDS) assert.equal(featureOn(topo.features, kind, 'samba'), false, kind);
  assert.equal('sambaOff' in topo.toJSON(), false, 'written as features from now on');
});

test('the Samba box of a device installs samba as apt does, and removing it stops smbd and nmbd', () => {
  const { pc0, pc1 } = lab();
  assert.equal(sambaOffered(pc0), false, 'a Windows PC without its Linux terminal has no Samba');
  setSambaInstalled(pc1, true);
  assert.ok(hasPackage(pc1, 'samba'));
  assert.ok(isPackageAuto(pc1, 'samba-common-bin'), 'its dependencies are automatic');
  assert.equal(run(pc1, 'systemctl is-active smbd; systemctl is-active nmbd'), 'active\nactive');
  assert.match(run(pc1, 'testparm -s 2>&1'), /Loaded services file OK\./);
  assert.ok(hostPanels(pc1).includes('samba'));
  setSambaInstalled(pc1, false);
  assert.equal(hasPackage(pc1, 'samba'), false);
  assert.match(run(pc1, 'systemctl is-active smbd 2>&1; true'), /inactive|not found/, 'smbd stops (and its unit goes with the package)');
  assert.ok(!hostPanels(pc1).includes('samba'));
});

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);
const URL = 'http://172.20.0.10:10000/';

function web() {
  const l = lab();
  const a = l.srv.services.webapps.admin;
  l.srv.setServices({ ...l.srv.services, webapps: { ...l.srv.services.webapps, admin: { ...a, enabled: true } } });
  l.t.settle();
  const engine = new BrowserEngine(l.pc1 as Pc);
  engine.login(URL, a.user, a.password);
  const post = (form: [string, string][]): string => body(engine.open(`${URL}?page=samba`, { method: 'POST', form }));
  return { ...l, engine, post };
}

test('the web GUI: Servicios → Samba lists the shares and accounts and changes them as the panel does', () => {
  const { srv, engine, post } = web();
  assert.ok(pagesOf(srv).some((p) => p.id === 'samba' && p.tab === 'services'));
  const page = body(engine.open(`${URL}?page=samba`));
  assert.match(page, /publico[\s\S]*\/srv\/samba\/publico[\s\S]*profes/);
  assert.match(page, /ana/);
  assert.match(post([['action', 'smb-share-add'], ['name', 'docs'], ['path', '/srv/samba/docs'], ['comment', 'Docs'], ['guestOk', '1']]), /docs/);
  assert.match(run(srv, 'testparm -s 2>&1'), /\[docs\]\n\tbrowseable = Yes\n\tcomment = Docs\n\tguest ok = Yes\n\tpath = \/srv\/samba\/docs/);
  assert.match(post([['action', 'smb-share-add'], ['name', ''], ['path', 'x']]), /web-adm-error/);
  post([['action', 'smb-share-del'], ['name', 'docs']]);
  assert.doesNotMatch(run(srv, 'testparm -s 2>&1'), /\[docs\]/);
  post([['action', 'smb-passwd'], ['user', 'luis'], ['password', 'luis1']]);
  assert.match(run(srv, 'pdbedit -L'), /luis:/);
  post([['action', 'smb-acct-toggle'], ['user', 'luis']]);
  assert.equal(sambaView(srv).accounts.find((a) => a.name === 'luis')?.disabled, true);
  post([['action', 'smb-acct-toggle'], ['user', 'luis']]);
  assert.equal(sambaView(srv).accounts.find((a) => a.name === 'luis')?.disabled, false);
  post([['action', 'smb-acct-del'], ['user', 'luis']]);
  assert.doesNotMatch(run(srv, 'pdbedit -L'), /luis:/);
  post([['action', 'smb-service']]);
  assert.match(run(srv, 'systemctl is-active smbd; true'), /inactive/);
  post([['action', 'smb-service'], ['enabled', '1']]);
  assert.equal(run(srv, 'systemctl is-active smbd'), 'active');
});

test('a share path through a file is refused, and only an existing share can be removed', () => {
  const { srv } = lab();
  const share = { name: 'y', path: '/etc/hostname/sub', comment: '', readOnly: false, guestOk: true };
  assert.equal(addSambaShare(srv, share), 'smb.err.path');
  const before = run(srv, 'cat /etc/samba/smb.conf');
  removeSambaShare(srv, 'global');
  removeSambaShare(srv, 'nada');
  assert.equal(run(srv, 'cat /etc/samba/smb.conf'), before, '[global] is not a share');
});

test('the web Samba page is off without samba (or when the lab does not allow it)', () => {
  const { t, srv } = web();
  assert.equal(pageOff(srv, 'samba'), false);
  t.features = setFeature(t.features, 'server', 'samba', false);
  assert.equal(pageOff(srv, 'samba'), true);
  t.features = setFeature(t.features, 'server', 'samba', true);
  run(srv, 'apt remove -y samba');
  assert.equal(pageOff(srv, 'samba'), true, 'apt remove takes the page away');
  assert.ok(!hostPanels(srv).includes('samba'), 'and the panel of Servicios');
  run(srv, 'apt install -y samba');
  assert.equal(pageOff(srv, 'samba'), false, 'apt install brings them back');
  assert.ok(hostPanels(srv).includes('samba'));
});

test('Servicios → Configuración has «Parámetros (sysctl)» on every GNU/Linux terminal with Parámetros', () => {
  const { srv, pc1 } = lab();
  assert.equal(configSources(srv)[0]?.id, 'sysctl');
  assert.equal(configSources(srv)[0]?.label, 'files.sysctl');
  assert.deepEqual(hostPanels(pc1), ['sysctl', 'files'], 'a GNU/Linux PC always has its files');
  assert.deepEqual(configSources(pc1).map((s) => s.id), ['sysctl']);
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0).device as Server;
  assert.equal(configSources(lr)[0]?.id, 'sysctl');
  t.features = { linuxrouter: ['ip', 'firewall', 'files'] };
  assert.ok(!configSources(lr).some((s) => s.id === 'sysctl'), 'the lab took Parámetros away');
});

test('a list saved before v0.35 never names Samba: it stays on, and a v0.35 list keeps it off when unticked', () => {
  const { t } = lab();
  t.features = setFeature(t.features, 'pc', 'windows', false);
  const { featuresV: _v, ...old } = t.toJSON() as { featuresV?: unknown; features?: Record<string, string[]> };
  const legacy = { ...old, features: { pc: (old.features?.pc ?? []).filter((f) => f !== 'samba') } };
  const before = Topology.fromJSON(JSON.parse(JSON.stringify(legacy)));
  assert.equal(featureOn(before.features, 'pc', 'samba'), true, 'Samba did not exist when it was saved');
  assert.equal(featureOn(before.features, 'pc', 'windows'), false, 'the rest of the list is kept');
  t.features = setFeature(t.features, 'pc', 'samba', false);
  const now = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(featureOn(now.features, 'pc', 'samba'), false);
});
