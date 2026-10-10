import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../src/devices/router.ts';
import { Session, applyConfig } from '../../src/ios/session.ts';
import { openConsole, runAll } from '../helpers.ts';

test('prompts follow IOS modes', () => {
  const r = new Router();
  const c = openConsole(r, 'user');
  assert.equal(c.session.prompt(), 'Router>');
  c.run('en');
  assert.equal(c.session.prompt(), 'Router#');
  const out = c.run('conf t');
  assert.deepEqual(out, ['Enter configuration commands, one per line.  End with CNTL/Z.']);
  assert.equal(c.session.prompt(), 'Router(config)#');
  c.run('hostname R1', 'int g0/0');
  assert.equal(c.session.prompt(), 'R1(config-if)#');
  c.run('exit');
  assert.equal(c.session.prompt(), 'R1(config)#');
  c.run('int g0/0.10');
  assert.equal(c.session.prompt(), 'R1(config-subif)#');
  c.run('end');
  assert.equal(c.session.prompt(), 'R1#');
  assert.ok(c.logs.includes('%SYS-5-CONFIG_I: Configured from console by console'));
});

test('invalid input shows caret under the offending token', () => {
  const c = openConsole(new Router(), 'config');
  const out = c.run('ip routing xx');
  assert.equal(out[0], `${' '.repeat('Router(config)#'.length + 11)}^`);
  assert.equal(out[1], "% Invalid input detected at '^' marker.");
});

test('incomplete and ambiguous commands', () => {
  const c = openConsole(new Router(), 'config');
  assert.deepEqual(c.run('ip route'), ['% Incomplete command.', '']);
  assert.deepEqual(c.run('ip d'), ['% Ambiguous command:  "ip d"']);
});

test('unknown exec word triggers domain lookup message', () => {
  const r = new Router();
  const c = openConsole(r);
  assert.deepEqual(c.run('foo'), [
    'Translating "foo"...domain server (255.255.255.255)',
    '% Unknown command or computer name, or unable to find computer address',
  ]);
  c.run('conf t', 'no ip domain-lookup', 'end');
  assert.deepEqual(c.run('foo'), ['% Unknown command or computer name, or unable to find computer address']);
});

test('help with ? and tab completion', () => {
  const s = new Session(new Router());
  s.mode = 'config';
  const help = s.help('hostn');
  assert.deepEqual(help, ['hostname']);
  assert.ok(s.help('').some((l) => l.includes('interface') && l.includes('Select an interface to configure')));
  assert.equal(s.complete('host'), 'hostname ');
  assert.equal(s.complete('no ip domain-l'), 'no ip domain-lookup ');
  assert.ok(s.help('no ').some((l) => l.includes('hostname')));
});

test('enable secret requires a password and is stored hashed', () => {
  const r = new Router();
  const c = openConsole(r, 'config');
  c.run('enable secret cisco', 'end', 'disable');
  c.run('enable');
  assert.equal(c.session.prompt(), 'Password: ');
  assert.equal(c.session.isSecretInput(), true);
  c.run('wrong');
  assert.equal(c.session.prompt(), 'Password: ');
  c.run('cisco');
  assert.equal(c.session.prompt(), 'Router#');
  const run = c.run('show running-config').join('\n');
  assert.match(run, /enable secret 5 \$1\$/);
  assert.doesNotMatch(run, /cisco/);
});

test('three wrong passwords give % Bad secrets', () => {
  const r = new Router();
  r.enablePassword = 'x';
  const c = openConsole(r, 'user');
  c.run('enable', 'a', 'b');
  assert.deepEqual(c.run('c'), ['% Bad secrets', '']);
  assert.equal(c.session.prompt(), 'Router>');
});

test('interface addressing validation', () => {
  const c = openConsole(new Router(), 'config');
  c.run('int g0/0', 'ip address 192.168.1.1 255.255.255.0');
  assert.deepEqual(c.run('int g0/1', 'ip address 192.168.1.2 255.255.255.0'), ['% 192.168.1.0 overlaps with GigabitEthernet0/0']);
  assert.deepEqual(c.run('ip address 10.0.0.0 255.255.255.0'), ['Bad mask 0xFFFFFF00 for address 10.0.0.0']);
  assert.deepEqual(c.run('int g9/9'), ['%Invalid interface type and number']);
});

test('show ip interface brief lists interfaces with status', () => {
  const c = openConsole(new Router(), 'config');
  c.run('int g0/0', 'ip add 192.168.1.1 255.255.255.0', 'no shut', 'end');
  const out = c.run('show ip int br');
  assert.match(out[0] ?? '', /^Interface\s+IP-Address\s+OK\? Method Status\s+Protocol/);
  const g00 = out.find((l) => l.startsWith('GigabitEthernet0/0 ')) ?? '';
  assert.match(g00, /192\.168\.1\.1\s+YES manual down\s+down/);
  assert.match(out.find((l) => l.startsWith('GigabitEthernet0/1')) ?? '', /unassigned\s+YES unset  administratively down down/);
});

test('do runs exec commands from config modes', () => {
  const c = openConsole(new Router(), 'config');
  c.run('int g0/0');
  const out = c.run('do show ip int brief');
  assert.match(out[0] ?? '', /^Interface/);
  assert.equal(c.session.prompt(), 'Router(config-if)#');
});

test('config sub-modes fall back to global commands', () => {
  const c = openConsole(new Router(), 'config');
  c.run('int g0/0', 'hostname EDGE');
  assert.equal(c.session.prompt(), 'EDGE(config)#');
});

test('static routes and show ip route', () => {
  const c = openConsole(new Router(), 'config');
  c.run('int lo0', 'ip address 10.0.0.1 255.255.255.0', 'exit');
  assert.deepEqual(c.run('ip route 10.9.0.1 255.255.0.0 10.0.0.2'), ['%Inconsistent address and mask']);
  c.run('ip route 0.0.0.0 0.0.0.0 10.0.0.2', 'end');
  const out = c.run('show ip route').join('\n');
  assert.match(out, /Gateway of last resort is 10\.0\.0\.2 to network 0\.0\.0\.0/);
  assert.match(out, /C\s+10\.0\.0\.0\/24 is directly connected, Loopback0/);
  assert.match(out, /L\s+10\.0\.0\.1\/32 is directly connected, Loopback0/);
  assert.match(out, /S\*\s+0\.0\.0\.0\/0 \[1\/0\] via 10\.0\.0\.2/);
});

test('running-config round-trips through applyConfig', () => {
  const r = new Router();
  const c = openConsole(r, 'config');
  runAll(c, ['hostname HQ', 'banner motd #Solo personal autorizado#', 'int g0/0', 'description LAN', 'ip address 192.168.10.1 255.255.255.0',
    'ip helper-address 10.1.1.1', 'no shutdown', 'int g0/0.20', 'encapsulation dot1Q 20', 'ip add 192.168.20.1 255.255.255.0',
    'int g0/1', 'ip address dhcp client-id g0/1 hostname EDGE', 'exit', 'ip route 0.0.0.0 0.0.0.0 192.168.10.254 5', 'line vty 0 4', 'password x', 'login']);
  const cfg = r.runningConfig();
  const r2 = new Router();
  const errors = applyConfig(r2, cfg);
  assert.deepEqual(errors, []);
  assert.deepEqual(r2.runningConfig(), cfg);
  assert.ok(cfg.includes(' ip address dhcp client-id GigabitEthernet0/1 hostname EDGE'));
  assert.ok(cfg.includes('banner motd ^CSolo personal autorizado^C'));
});

test('copy run start, show startup-config and reload', () => {
  const r = new Router();
  const c = openConsole(r);
  assert.deepEqual(c.run('show startup-config'), ['startup-config is not present']);
  c.run('conf t', 'hostname SAVED', 'end', 'copy running-config startup-config', 'conf t', 'hostname UNSAVED', 'end');
  assert.match(c.run('show startup-config')[0] ?? '', /^Using \d+ bytes/);
  c.run('reload');
  assert.equal(r.hostname, 'SAVED');
  assert.equal(c.session.prompt(), 'SAVED>');
  c.run('en', 'write erase');
  assert.equal(r.startupConfig, null);
});

test('clock set changes show clock', () => {
  const c = openConsole(new Router());
  c.run('clock set 10:20:30 5 March 2026');
  assert.match(c.run('show clock')[0] ?? '', /^\*10:20:30\.\d{3} UTC Thu Mar 5 2026$/);
});

test('initial configuration dialog', () => {
  const s = new Session(new Router(), { initialDialog: true });
  assert.match(s.banner().join('\n'), /System Configuration Dialog/);
  assert.equal(s.prompt(), 'Continue with configuration dialog? [yes/no]: ');
  assert.ok(s.input('no').includes('Press RETURN to get started!'));
  assert.equal(s.prompt(), 'Router>');
});

test('interface range and ctrl-z', () => {
  const c = openConsole(new Router(), 'config');
  c.run('interface range g0/0 - 2');
  assert.equal(c.session.prompt(), 'Router(config-if-range)#');
  c.run('no shutdown');
  c.session.ctrlZ();
  assert.equal(c.session.prompt(), 'Router#');
  const brief = c.run('sh ip int b').join('\n');
  assert.doesNotMatch(brief, /GigabitEthernet0\/\d.*administratively/);
});
