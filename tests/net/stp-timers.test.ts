/**
 * Spanning tree timers once the network is running (the interface turns them on after loading): a port that starts
 * forwarding goes through Listening (15 s) and Learning (15 s), except portfast ports and rapid-pvst; BPDUs leave
 * the designated ports every 2 s and are shown as STP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import { frameProtocol } from '../../src/net/packets.ts';
import { stpTransition, LISTEN_MS } from '../../src/net/stp-timers.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { Pc } from '../../src/devices/pc.ts';

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'stp')!.build();
  t.net.startStp();
  const cli = (sw: Switch, ...lines: string[]): string[] => {
    const s = new Session(sw);
    return ['enable', ...lines].flatMap((l) => s.input(l));
  };
  const sw = (label: string) => t.byLabel(label) as Switch;
  return { t, cli, sw };
}

const state = (s: Switch, port: string): string | undefined => s.stpVlan(1)?.ports.get(port)?.state;

test('the states of a port that starts forwarding: Listening, Learning, then Forwarding', () => {
  assert.deepEqual([0, 14_999, 15_000, 29_999, 30_000].map((ms) => stpTransition(ms)), ['LIS', 'LIS', 'LRN', 'LRN', 'FWD']);
});

test('loading keeps the converged tree; a port that comes up later listens and learns for 30 s', () => {
  const { t, cli, sw } = lab();
  const a = sw('SW-A');
  assert.equal(state(a, 'GigabitEthernet0/1'), 'FWD', 'converged at load');
  const blocked = state(a, 'GigabitEthernet0/2') === 'BLK' ? a : sw('SW-B');
  cli(sw('SW-CORE'), 'configure terminal', 'interface GigabitEthernet0/1', 'shutdown');
  t.net.runFor(1000);
  if (blocked === a) assert.equal(state(a, 'GigabitEthernet0/2'), 'LIS', 'the blocked port takes over, listening first');
  t.net.runFor(LISTEN_MS);
  if (blocked === a) assert.equal(state(a, 'GigabitEthernet0/2'), 'LRN');
  t.net.runFor(LISTEN_MS);
  assert.equal(state(a, 'GigabitEthernet0/2'), 'FWD');
  assert.match(cli(a, 'show spanning-tree').join('\n'), /^Gi0\/2 {15}Root FWD/m);
});

test('during Listening the PC behind the port is cut off; afterwards it is reachable again', () => {
  const { t, cli, sw } = lab();
  const pc0 = t.byLabel('PC0') as Pc;
  cli(sw('SW-A'), 'configure terminal', 'interface FastEthernet0/1', 'shutdown', 'no shutdown');
  t.net.runFor(500);
  assert.equal(state(sw('SW-A'), 'FastEthernet0/1'), 'LIS');
  assert.ok(sw('SW-A').portBlocked('FastEthernet0/1'), 'amber light');
  assert.match(createShell(pc0, 'windows').run('ping -n 1 192.168.10.1').join('\n'), /Received = 0/);
  t.net.runFor(31_000);
  assert.match(createShell(pc0, 'windows').run('ping -n 1 192.168.10.1').join('\n'), /Received = 1/);
});

test('portfast and rapid-pvst forward at once', () => {
  const { t, cli, sw } = lab();
  cli(sw('SW-A'), 'configure terminal', 'interface FastEthernet0/1', 'spanning-tree portfast', 'shutdown', 'no shutdown');
  t.net.runFor(500);
  assert.equal(state(sw('SW-A'), 'FastEthernet0/1'), 'FWD');
  cli(sw('SW-B'), 'configure terminal', 'spanning-tree mode rapid-pvst', 'interface FastEthernet0/1', 'shutdown', 'no shutdown');
  t.net.runFor(500);
  assert.equal(state(sw('SW-B'), 'FastEthernet0/1'), 'FWD');
});

test('BPDUs leave the designated ports every 2 s, as STP frames, and do not reach the MAC tables', () => {
  const { t, sw } = lab();
  const before = t.net.history.length;
  t.net.runFor(4100);
  const bpdus = t.net.history.slice(before).filter((e) => frameProtocol(e.frame) === 'STP');
  const core = bpdus.filter((e) => e.from.device === sw('SW-CORE').id);
  assert.equal(core.length, 6, 'SW-CORE (root): Fa0/24, Gi0/1 and Gi0/2, twice');
  assert.ok(bpdus.every((e) => e.frame.dst === '01000ccccccd'));
  assert.ok(![...sw('SW-A').macTable.values()].some((m) => m.mac === sw('SW-CORE').baseMac), 'BPDUs are not learnt');
});

test('without startStp (tests, loading a file) there are no timers and no BPDUs', () => {
  const t = EXAMPLES.find((e) => e.id === 'stp')!.build();
  const before = t.net.history.length;
  t.net.runFor(5000);
  assert.equal(t.net.history.slice(before).filter((e) => frameProtocol(e.frame) === 'STP').length, 0);
});
