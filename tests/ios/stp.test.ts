/** PVST+ on the 2960: a triangle of switches has no storm, re-elects when a link fails, and IOS shows and changes it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { parseIp } from '../../src/core/ip.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { Pc } from '../../src/devices/pc.ts';

const ip = (x: string): number => parseIp(x) ?? 0;

function triangle() {
  const t = new Topology();
  const s = [1, 2, 3].map((i) => t.add('switch', i * 100, 0).device as Switch);
  const [s1, s2, s3] = s as [Switch, Switch, Switch];
  const c = (a: Switch, ap: string, b: Switch, bp: string) => t.connect({ device: a.id, port: ap }, { device: b.id, port: bp });
  c(s1, 'GigabitEthernet0/1', s2, 'GigabitEthernet0/1');
  c(s1, 'GigabitEthernet0/2', s3, 'GigabitEthernet0/1');
  c(s2, 'GigabitEthernet0/2', s3, 'GigabitEthernet0/2');
  const pcs = [s1, s3].map((sw, i) => {
    const pc = t.add('pc', 0, 100).device as Pc;
    t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: sw.id, port: 'FastEthernet0/1' });
    pc.os = 'linux';
    pc.setStatic({ ip: ip(`192.168.1.${10 + i}`), prefix: 24 });
    return pc;
  });
  t.settle();
  /** The switch with the lowest MAC is the root (all priorities equal). */
  const root = [...s].sort((a, b) => (a.baseMac < b.baseMac ? -1 : 1))[0] as Switch;
  return { t, s, pcs, root };
}

const cli = (sw: Switch, ...lines: string[]): string[] => {
  const session = new Session(sw);
  return ['enable', ...lines].flatMap((l) => session.input(l));
};

test('a triangle of switches: one port blocks and a ping goes through without a storm', () => {
  const { t, s, pcs } = triangle();
  const blocked = s.flatMap((sw) => [...(sw.stpVlan(1)?.ports.values() ?? [])].filter((p) => !p.forwarding));
  assert.equal(blocked.length, 1, 'exactly one blocked port');
  const before = t.net.history.length;
  const out = createShell(pcs[0] as Pc, 'linux').run('ping -c 2 192.168.1.11').join('\n');
  assert.match(out, /2 packets transmitted, 2 received/);
  assert.ok(t.net.history.length - before < 60, `few frames, not a storm (${t.net.history.length - before})`);
});

test('show spanning-tree: the root says so, the others show the root port and the blocked one', () => {
  const { s, root } = triangle();
  const rootOut = cli(root, 'show spanning-tree').join('\n');
  assert.match(rootOut, /^VLAN0001\n {2}Spanning tree enabled protocol ieee\n {2}Root ID {4}Priority {4}32769\n {13}Address {5}[0-9a-f.]{14}\n {13}This bridge is the root/);
  assert.match(rootOut, /^Gi0\/1 {15}Desg FWD 4 {9}128\.25 {3}P2p$/m);
  const other = s.find((x) => x !== root) as Switch;
  assert.match(cli(other, 'show spanning-tree').join('\n'), /Cost {8}4\n {13}Port {8}2[56] \(GigabitEthernet0\/[12]\)/);
  const all = s.map((x) => cli(x, 'show spanning-tree').join('\n')).join('\n');
  assert.match(all, /Altn BLK 4/);
  assert.match(cli(root, 'show spanning-tree summary').join('\n'), /Switch is in pvst mode\nRoot bridge for: VLAN0001\n[\s\S]*VLAN0001 {22}0 {9}0 {8}0 +\d+ +\d+\n/);
  assert.match(cli(root, 'show spanning-tree interface GigabitEthernet0/1').join('\n'), /^VLAN0001 {12}Desg FWD 4 {9}128\.25 {3}P2p$/m);
  assert.deepEqual(cli(root, 'show spanning-tree vlan 20'), ['Spanning tree instance(s) for vlan 20 does not exist.']);
});

test('priority and root primary choose the root; a bad priority shows the allowed values', () => {
  const { s, root } = triangle();
  const other = s.find((x) => x !== root) as Switch;
  assert.match(cli(other, 'configure terminal', 'spanning-tree vlan 1 priority 1000').join('\n'), /% Bridge Priority must be in increments of 4096\./);
  cli(other, 'configure terminal', 'spanning-tree vlan 1 root primary');
  assert.equal(other.stpVlan(1)?.rootPort, undefined, 'now the root');
  assert.equal(other.stpVlan(1)?.bridge.priority, 24577);
  assert.ok(other.runningConfig().includes('spanning-tree vlan 1 priority 24576'));
  cli(root, 'configure terminal', 'spanning-tree vlan 1 priority 4096');
  assert.equal(root.stpVlan(1)?.rootPort, undefined, 'a lower priority takes it back');
});

test('when the root port fails, the blocked port takes over and the ping still works', () => {
  const { s, pcs } = triangle();
  const holder = s.find((sw) => [...(sw.stpVlan(1)?.ports.values() ?? [])].some((p) => !p.forwarding)) as Switch;
  const rootPort = holder.stpVlan(1)?.rootPort ?? '';
  cli(holder, 'configure terminal', `interface ${rootPort}`, 'shutdown');
  assert.ok([...(holder.stpVlan(1)?.ports.values() ?? [])].every((p) => p.forwarding), 'nothing blocks any more');
  assert.match(createShell(pcs[0] as Pc, 'linux').run('ping -c 1 192.168.1.11').join('\n'), /1 received/);
});

test('portfast warns as IOS; the interface settings and no spanning-tree vlan go to the running-config', () => {
  const { s } = triangle();
  const root = s[0] as Switch;
  const out = cli(root, 'configure terminal', 'interface FastEthernet0/1', 'spanning-tree portfast', 'spanning-tree cost 100', 'spanning-tree port-priority 64', 'spanning-tree port-priority 10');
  assert.match(out.join('\n'), /^%Warning: portfast should only be enabled on ports connected to a single$/m);
  assert.match(out.join('\n'), /% Port Priority in increments of 16 is required/);
  const rc = root.runningConfig().join('\n');
  assert.match(rc, /interface FastEthernet0\/1\n spanning-tree port-priority 64\n spanning-tree cost 100\n spanning-tree portfast\n/);
  assert.match(cli(root, 'show spanning-tree').join('\n'), /^Fa0\/1 {15}Desg FWD 100 {7}64\.1 {5}P2p Edge$/m);
  cli(root, 'configure terminal', 'no spanning-tree vlan 1');
  assert.match(root.runningConfig().join('\n'), /^spanning-tree mode pvst\nspanning-tree extend system-id\nno spanning-tree vlan 1$/m);
  assert.equal(root.stpVlan(1), undefined);
});

test('the configuration survives saving and loading the topology', () => {
  const { t, root } = triangle();
  cli(root, 'configure terminal', 'spanning-tree mode rapid-pvst', 'spanning-tree vlan 1 priority 8192');
  const again = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const twin = again.get(root.id)?.device as Switch;
  assert.equal(twin.stp.mode, 'rapid-pvst');
  assert.equal(twin.stpVlan(1)?.bridge.priority, 8193);
  assert.match(cli(twin, 'show spanning-tree').join('\n'), /protocol rstp/);
});
