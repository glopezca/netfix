import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilter, splitPipe } from '../../src/ios/pipe.ts';
import { Router } from '../../src/devices/router.ts';
import { applyConfig, Session } from '../../src/ios/session.ts';

const RUN = ['!', 'hostname GW', '!', 'ip dhcp excluded-address 10.0.0.1 10.0.0.9', '!', 'ip dhcp pool LAN', ' network 10.0.0.0 255.255.255.0', ' default-router 10.0.0.1', '!', 'interface GigabitEthernet0/0', ' ip address 10.0.0.1 255.255.255.0', ' ip helper-address 10.9.9.9', '!', 'interface GigabitEthernet0/1', ' ip address dhcp', '!', 'end'];

test('splitPipe separates the command from the filter and accepts abbreviations', () => {
  assert.equal(splitPipe('show ip route'), null);
  assert.deepEqual(splitPipe('sh run | sec dhcp'), { command: 'sh run', filter: 'section', regex: 'dhcp', offset: 9 });
  assert.deepEqual(splitPipe('show run | i  pool LAN'), { command: 'show run', filter: 'include', regex: 'pool LAN', offset: 11 });
  assert.equal(splitPipe('show run | e x')?.filter, 'exclude');
  assert.equal(splitPipe('show run | b interface')?.filter, 'begin');
  assert.equal(splitPipe('show run | zzz x')?.filter, undefined);
  assert.deepEqual(splitPipe('show run | include'), { command: 'show run', filter: 'include', regex: '', offset: 11 });
});

test('include, exclude and begin work line by line with regular expressions', () => {
  assert.deepEqual(applyFilter(RUN, 'include', 'dhcp'), ['ip dhcp excluded-address 10.0.0.1 10.0.0.9', 'ip dhcp pool LAN', ' ip address dhcp']);
  assert.deepEqual(applyFilter(RUN, 'include', '^interface'), ['interface GigabitEthernet0/0', 'interface GigabitEthernet0/1']);
  assert.equal(applyFilter(RUN, 'exclude', '!').length, RUN.filter((l) => !l.includes('!')).length);
  assert.deepEqual(applyFilter(RUN, 'begin', 'interface GigabitEthernet0/1'), ['interface GigabitEthernet0/1', ' ip address dhcp', '!', 'end']);
});

test('section prints whole blocks whose header or children match', () => {
  assert.deepEqual(applyFilter(RUN, 'section', 'dhcp'), [
    'ip dhcp excluded-address 10.0.0.1 10.0.0.9',
    'ip dhcp pool LAN', ' network 10.0.0.0 255.255.255.0', ' default-router 10.0.0.1',
    'interface GigabitEthernet0/1', ' ip address dhcp',
  ]);
  assert.deepEqual(applyFilter(RUN, 'section', 'helper'), ['interface GigabitEthernet0/0', ' ip address 10.0.0.1 255.255.255.0', ' ip helper-address 10.9.9.9']);
});

test('an invalid regular expression is matched literally', () => {
  assert.deepEqual(applyFilter(['a(b', 'c'], 'include', 'a('), ['a(b']);
});

function router(): Router {
  const r = new Router({ id: 'd1', seed: 1 });
  assert.deepEqual(applyConfig(r, ['hostname Mordor', 'ip dhcp excluded-address 192.168.10.1 192.168.10.10', 'ip dhcp pool HOMBRES', ' network 192.168.10.0 255.255.255.0', ' default-router 192.168.10.254', 'interface GigabitEthernet0/0', ' ip address 192.168.10.254 255.255.255.0']), []);
  return r;
}

test('show running-config | section dhcp from exec and with do (UT2 practice 2)', () => {
  const s = new Session(router());
  s.mode = 'exec';
  const out = s.input('show running-config | section dhcp');
  assert.deepEqual(out, ['ip dhcp excluded-address 192.168.10.1 192.168.10.10', 'ip dhcp pool HOMBRES', ' network 192.168.10.0 255.255.255.0', ' default-router 192.168.10.254']);
  s.input('configure terminal');
  assert.deepEqual(s.input('do sh run | i pool'), ['ip dhcp pool HOMBRES']);
});

test('pipe errors mirror IOS', () => {
  const s = new Session(router());
  s.mode = 'exec';
  assert.deepEqual(s.input('show running-config | include'), ['% Incomplete command.', '']);
  const bad = s.input('show running-config | zzz dhcp');
  assert.equal(bad[1], "% Invalid input detected at '^' marker.");
  assert.equal(bad[0]?.indexOf('^'), 'Mordor#'.length + 'show running-config | '.length);
  assert.equal(s.input('ping 1.1.1.1 | include x')[1], "% Invalid input detected at '^' marker.");
});

test('? lists the output modifiers like IOS', () => {
  const s = new Session(router());
  s.mode = 'exec';
  const help = s.help('show running-config ');
  assert.deepEqual(help.slice(-2), ['  |  Output modifiers', '  <cr>']);
  assert.deepEqual(s.help('show running-config | '), [
    '  begin    Begin with the line that matches',
    '  exclude  Exclude lines that match',
    '  include  Include lines that match',
    '  section  Filter a section of output',
  ]);
  assert.deepEqual(s.help('sh run | sec'), ['  section  Filter a section of output']);
  assert.deepEqual(s.help('sh run | section '), ['  LINE  Regular Expression']);
  assert.ok(!s.help('ping ').some((l) => l.includes('Output modifiers')));
});

test('_ matches IOS delimiters and nested quantifiers cannot hang the simulator', () => {
  const lines = ['GigabitEthernet0/0 is up, line protocol is up', 'Vlan1 is administratively down', 'setup done'];
  assert.deepEqual(applyFilter(lines, 'include', '_up_'), [lines[0]]);
  assert.deepEqual(applyFilter(lines, 'include', 'up$'), [lines[0]]);
  assert.deepEqual(applyFilter(['a_b', 'a b'], 'include', 'a\\_b'), ['a_b']);
  const start = Date.now();
  assert.deepEqual(applyFilter([`${'a'.repeat(40)}!`], 'include', '(a+)+$'), []);
  assert.ok(Date.now() - start < 1000);
});
