/** `switchport trunk allowed vlan` and `show interfaces trunk` on the 2960 (router-on-a-stick lab). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { Pc } from '../../src/devices/pc.ts';

function lab() {
  const ex = EXAMPLES.find((e) => e.id === 'vlans');
  assert.ok(ex);
  const t = ex.build();
  const sw = t.byLabel('SW-ACCESO') as Switch;
  const cli = (...lines: string[]): string[] => {
    const s = new Session(sw);
    return ['enable', ...lines].flatMap((l) => s.input(l));
  };
  const pcs = [...t.placed.values()].map((p) => p.device).filter((d) => d.kind === 'pc') as Pc[];
  const ping = (pc: Pc, gw: string): string => createShell(pc, 'windows').run(`ping -n 1 ${gw}`).join('\n');
  return { t, sw, cli, pcs, ping };
}

test('a trunk restricted to VLAN 10 no longer carries VLAN 20; add puts it back', () => {
  const { cli, pcs, ping } = lab();
  const [ventas, , soporte] = pcs as [Pc, Pc, Pc];
  assert.match(ping(soporte, '172.16.20.1'), /Received = 1/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan 10');
  assert.match(ping(ventas, '172.16.10.1'), /Received = 1/);
  assert.match(ping(soporte, '172.16.20.1'), /Received = 0/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan add 20');
  assert.match(ping(soporte, '172.16.20.1'), /Received = 1/);
});

test('the list goes to the running-config as IOS writes it; all removes the line', () => {
  const { sw, cli } = lab();
  const rc = (): string => sw.runningConfig().join('\n');
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan 10,20,30-32');
  assert.match(rc(), /interface GigabitEthernet0\/1\n switchport trunk allowed vlan 10,20,30-32\n switchport mode trunk/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan remove 31');
  assert.match(rc(), / switchport trunk allowed vlan 10,20,30,32\n/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan except 1-9');
  assert.match(rc(), / switchport trunk allowed vlan 10-4094\n/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan none');
  assert.match(rc(), / switchport trunk allowed vlan none\n/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan all');
  assert.doesNotMatch(rc(), /allowed vlan/);
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan 10', 'no switchport trunk allowed vlan');
  assert.doesNotMatch(rc(), /allowed vlan/);
});

test('show interfaces trunk: mode, encapsulation, native VLAN and the three VLAN lists', () => {
  const { cli } = lab();
  cli('configure terminal', 'interface GigabitEthernet0/1', 'switchport trunk allowed vlan 1,10');
  const out = cli('show interfaces trunk').join('\n');
  assert.equal(out, [
    'Port        Mode             Encapsulation  Status        Native vlan',
    'Gi0/1       on               802.1q         trunking      1',
    '',
    'Port        Vlans allowed on trunk',
    'Gi0/1       1,10',
    '',
    'Port        Vlans allowed and active in management domain',
    'Gi0/1       1,10',
    '',
    'Port        Vlans in spanning tree forwarding state and not pruned',
    'Gi0/1       1,10',
  ].join('\n'));
});
