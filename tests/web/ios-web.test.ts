/** Web management of Cisco routers and switches (`ip http server`) used from a PC browser. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { Pc } from '../../src/devices/pc.ts';
import { Session, applyConfig } from '../../src/ios/session.ts';
import type { IosDevice } from '../../src/ios/device.ts';
import { BrowserEngine } from '../../src/clients/browser.ts';
import type { BrowseResult } from '../../src/clients/browser.ts';
import { parseIp } from '../../src/core/ip.ts';
import { createShell } from '../../src/shells/factory.ts';

function config(d: IosDevice, ...lines: string[]): string[] {
  const s = new Session(d);
  s.mode = 'config';
  return lines.flatMap((l) => s.input(l));
}

function routerLab(): { t: Topology; r: Router; pc: Pc; web: BrowserEngine } {
  const t = new Topology();
  const r = t.add('router', 0, 0, { label: 'R1' }).device as Router;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: r.id, port: 'GigabitEthernet0/0' }, { device: pc.id, port: 'FastEthernet0' });
  config(r, 'hostname R1', 'interface GigabitEthernet0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shutdown', 'exit');
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24, gateway: parseIp('10.0.0.1')! });
  t.settle();
  return { t, r, pc, web: new BrowserEngine(pc) };
}

const body = (r: BrowseResult): string => (r.kind === 'page' ? r.response.body : r.kind);

test('ip http commands, local users and their running-config lines', () => {
  const { r } = routerLab();
  assert.deepEqual(config(r, 'ip http server', 'ip http port 8080', 'ip http authentication local', 'username admin privilege 15 secret cisco', 'username bob password clave'), []);
  const run = r.runningConfig();
  assert.ok(run.includes('ip http server') && run.includes('ip http port 8080') && run.includes('ip http authentication local'));
  assert.ok(run.some((l) => /^username admin privilege 15 secret 5 \$1\$/.test(l)));
  assert.ok(run.includes('username bob password 0 clave'));
  assert.equal(r.web.listeningPort(), 8080);
  config(r, 'no username bob', 'no ip http port', 'no ip http server');
  assert.equal(r.web.listeningPort(), undefined);
  assert.ok(!r.runningConfig().some((l) => /ip http (server|port)|username bob/.test(l)));
  // a saved configuration brings the server back (reload, load of a lab)
  const saved = [...run];
  r.resetConfig();
  applyConfig(r, saved);
  assert.equal(r.web.listeningPort(), 8080);
});

test('the router home page needs the enable secret (ip http authentication enable)', () => {
  const { r, web } = routerLab();
  assert.equal(web.open('http://10.0.0.1/').kind, 'error', 'no HTTP server yet');
  config(r, 'ip http server');
  const first = web.open('http://10.0.0.1/');
  assert.deepEqual(first.kind === 'auth' ? first.realm : first.kind, 'level_15_access');
  assert.equal(web.login('http://10.0.0.1/', 'x', 'class').kind, 'auth', 'without enable secret nobody gets in');
  config(r, 'enable secret class');
  const home = web.login('http://10.0.0.1/', 'cualquiera', 'class');
  assert.match(body(home), /Accessing Cisco CISCO2911\/K9 &quot;R1&quot;/);
  assert.match(body(home), /href="\/level\/15\/exec\/-\/show\/interfaces\/CR"/);
});

test('exec commands by URL and by the command form; configuration from the browser', () => {
  const { r, web } = routerLab();
  config(r, 'ip http server', 'ip http authentication local', 'username admin privilege 15 secret cisco');
  web.login('http://10.0.0.1/', 'admin', 'cisco');
  const brief = web.open('http://10.0.0.1/level/15/exec/-/show/ip/interface/brief/CR');
  assert.match(body(brief), /Command was: show ip interface brief/);
  assert.match(body(brief), /GigabitEthernet0\/0\s+10\.0\.0\.1\s+YES manual up/);
  const help = web.open('http://10.0.0.1/level/15/exec/-/show');
  assert.match(body(help), /href="\/level\/15\/exec\/-\/show\/version"/);
  const form = web.open('http://10.0.0.1/level/15/exec/-', { form: [['command', 'show version']] });
  assert.match(body(form), /Cisco IOS Software/);
  const conf = web.open('http://10.0.0.1/level/15/configure/-', { method: 'POST', form: [['command', 'hostname Sede-Norte\ninterface Loopback0\n ip address 1.1.1.1 255.255.255.255']] });
  assert.match(body(conf), /hostname comes from the device name[\s\S]*R1\(config-if\)#/, 'as in the CLI: the hostname is the device name');
  assert.equal(r.hostname, 'R1');
  assert.ok(r.iface('Loopback0'));
});

test('privilege levels: a level-1 user gets user EXEC only', () => {
  const { r, web } = routerLab();
  config(r, 'ip http server', 'ip http authentication local', 'username eva secret eva1');
  assert.equal(web.login('http://10.0.0.1/level/15/exec/-/show/running-config/CR', 'eva', 'eva1').kind, 'auth');
  const v = web.login('http://10.0.0.1/level/1/exec/-/show/version/CR', 'eva', 'eva1');
  assert.match(body(v), /Cisco IOS Software/);
  assert.match(body(web.open('http://10.0.0.1/level/1/exec/-/show/running-config/CR')), /Invalid input/);
});

test('a switch serves its Device Manager on the SVI and applies port settings', () => {
  const t = new Topology();
  const sw = t.add('switch', 0, 0, { label: 'SW1' }).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  t.connect({ device: sw.id, port: 'FastEthernet0/1' }, { device: pc.id, port: 'FastEthernet0' });
  config(sw, 'hostname SW1', 'interface Vlan1', 'ip address 10.0.0.2 255.255.255.0', 'no shutdown', 'exit', 'enable secret class', 'ip http server', 'ip http port 8080');
  pc.setStatic({ ip: parseIp('10.0.0.10')!, prefix: 24 });
  t.settle();
  const web = new BrowserEngine(pc);
  assert.equal(web.open('http://10.0.0.2/').kind, 'error', 'port 80 is closed');
  const dm = web.login('http://10.0.0.2:8080/level/15/dm', 'admin', 'class');
  assert.match(body(dm), /Device Manager - SW1/);
  assert.match(body(dm), /web-ios-port web-ios-up[^>]*>1</);
  const saved = web.open('http://10.0.0.2:8080/level/15/dm', { method: 'POST', form: [['iface', 'FastEthernet0/5'], ['description', 'Aula 2'], ['vlan', '20'], ['state', 'down']] });
  assert.match(body(saved), /interface FastEthernet0\/5/);
  assert.equal(sw.iface('FastEthernet0/5')?.accessVlan, 20);
  assert.equal(sw.iface('FastEthernet0/5')?.description, 'Aula 2');
  assert.equal(sw.iface('FastEthernet0/5')?.shutdown, true);
  const bad = web.open('http://10.0.0.2:8080/level/15/dm', { method: 'POST', form: [['iface', 'FastEthernet0/5'], ['vlan', '9999']] });
  assert.match(body(bad), /web-ios-error/);
  assert.match(createShell(pc, 'linux').run('curl -sI http://10.0.0.2:8080/ | head -1').join(''), /401 Unauthorized/);
});
