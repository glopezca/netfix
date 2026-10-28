/** BPDU guard on the 2960: a guarded port facing a switch goes err-disabled; shutdown + no shutdown recovers it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Session } from '../../src/ios/session.ts';
import { createShell } from '../../src/shells/factory.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { Pc } from '../../src/devices/pc.ts';

function lab() {
  const t = EXAMPLES.find((e) => e.id === 'stp')!.build();
  const a = t.byLabel('SW-A') as Switch;
  const b = t.byLabel('SW-B') as Switch;
  const logs: string[] = [];
  a.onConsole((l) => logs.push(l));
  const cli = (sw: Switch, ...lines: string[]): string[] => {
    const s = new Session(sw);
    return ['enable', ...lines].flatMap((l) => s.input(l));
  };
  const pc0 = t.byLabel('PC0') as Pc;
  return { t, a, b, logs, cli, pc0 };
}

test('bpduguard on a port facing a switch: err-disabled with the IOS messages, and the link goes down', () => {
  const { a, b, logs, cli, pc0 } = lab();
  cli(a, 'configure terminal', 'interface GigabitEthernet0/2', 'spanning-tree bpduguard enable');
  assert.ok(a.errDisabled.has('GigabitEthernet0/2'));
  assert.deepEqual(logs.filter((l) => /SPANTREE|ERR_DISABLE|UPDOWN/.test(l)), [
    '%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port GigabitEthernet0/2 with BPDU Guard enabled. Disabling port.',
    '%PM-4-ERR_DISABLE: bpduguard error detected on Gi0/2, putting Gi0/2 in err-disable state',
    '%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/2, changed state to down',
    '%LINK-3-UPDOWN: Interface GigabitEthernet0/2, changed state to down',
  ]);
  assert.equal(b.ifaceRuntime('GigabitEthernet0/2').linkUp, false, 'the far end sees the link down');
  assert.match(cli(a, 'show interfaces status err-disabled').join('\n'), /^Gi0\/2 {24}err-disabled 1 {12}auto {3}auto 10\/100\/1000BaseTX$/m);
  assert.match(cli(a, 'show interfaces GigabitEthernet0/2').join('\n'), /^GigabitEthernet0\/2 is down, line protocol is down \(err-disabled\)$/m);
  assert.match(createShell(pc0, 'windows').run('ping -n 1 192.168.10.1').join('\n'), /Received = 1/, 'still reachable through SW-CORE');
});

test('shutdown and no shutdown bring it back; with the guard still on and a switch there, it trips again', () => {
  const { a, cli } = lab();
  cli(a, 'configure terminal', 'interface GigabitEthernet0/2', 'spanning-tree bpduguard enable');
  cli(a, 'configure terminal', 'interface GigabitEthernet0/2', 'shutdown');
  assert.equal(a.errDisabled.has('GigabitEthernet0/2'), false);
  cli(a, 'configure terminal', 'interface GigabitEthernet0/2', 'no shutdown');
  assert.ok(a.errDisabled.has('GigabitEthernet0/2'), 'the BPDUs are still there');
  cli(a, 'configure terminal', 'interface GigabitEthernet0/2', 'spanning-tree bpduguard disable', 'shutdown', 'no shutdown');
  assert.equal(a.errDisabled.has('GigabitEthernet0/2'), false);
  assert.ok(a.ifaceRuntime('GigabitEthernet0/2').linkUp);
});

test('portfast bpduguard default guards portfast ports only, and a PC sends no BPDUs', () => {
  const { a, cli } = lab();
  const out = cli(a, 'configure terminal', 'spanning-tree portfast bpduguard default', 'interface FastEthernet0/1', 'spanning-tree portfast', 'interface GigabitEthernet0/2', 'spanning-tree portfast');
  assert.ok(out.join('\n').includes('%Warning: portfast'));
  assert.equal(a.errDisabled.has('FastEthernet0/1'), false, 'the PC port stays up');
  assert.ok(a.errDisabled.has('GigabitEthernet0/2'), 'the portfast port facing SW-B trips');
  assert.match(a.runningConfig().join('\n'), /^spanning-tree mode pvst\nspanning-tree portfast bpduguard default\nspanning-tree extend system-id$/m);
});

test('bpduguard disable exempts a portfast port from the default', () => {
  const { a, cli } = lab();
  cli(a, 'configure terminal', 'spanning-tree portfast bpduguard default', 'interface GigabitEthernet0/2', 'spanning-tree bpduguard disable', 'spanning-tree portfast');
  assert.equal(a.errDisabled.has('GigabitEthernet0/2'), false);
  assert.match(a.runningConfig().join('\n'), /interface GigabitEthernet0\/2\n spanning-tree portfast\n spanning-tree bpduguard disable\n/);
});
