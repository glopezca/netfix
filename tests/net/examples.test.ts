import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Pc } from '../../src/devices/pc.ts';
import { Router } from '../../src/devices/router.ts';
import { formatIp } from '../../src/core/ip.ts';

function pcs(t: ReturnType<(typeof EXAMPLES)[number]['build']>): Pc[] {
  return [...t.placed.values()].map((p) => p.device).filter((d): d is Pc => d instanceof Pc);
}

test('every example builds and its PCs obtain addresses', () => {
  for (const ex of EXAMPLES) {
    const t = ex.build();
    for (const pc of pcs(t).filter((p) => p.config.mode === 'dhcp')) assert.equal(pc.dhcpStatus, 'ok', `${ex.id}: ${pc.name}`);
    assert.ok(JSON.stringify(t.toJSON()).length > 0);
  }
});

test('reservations example hands out the configured addresses', () => {
  const t = EXAMPLES.find((e) => e.id === 'reservas')!.build();
  const ips = pcs(t).map((p) => formatIp(p.config.ip!));
  assert.deepEqual(ips, ['192.168.10.100', '192.168.10.101', '192.168.10.150']);
});

test('snooping example ignores the rogue gateway', () => {
  const t = EXAMPLES.find((e) => e.id === 'snooping')!.build();
  for (const pc of pcs(t)) assert.equal(formatIp(pc.config.gateway!), '192.168.10.1');
});

test('client example gives the CPE its fixed WAN address', () => {
  const t = EXAMPLES.find((e) => e.id === 'cliente')!.build();
  const cpe = t.byLabel('Router1') as Router;
  assert.equal(formatIp(cpe.dhcpLearned('GigabitEthernet0/1')!.ip), '100.64.0.77');
});
