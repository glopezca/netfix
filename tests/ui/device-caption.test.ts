/** Caption under a device in the diagram: its name and, for hosts, the address of each configured NIC (IP/CIDR). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Server } from '../../src/devices/server.ts';
import { createShell } from '../../src/shells/factory.ts';
import { deviceCaption } from '../../src/ui/device-caption.ts';
import { parseIp } from '../../src/core/ip.ts';

test('a PC: the name, then IP/CIDR; no host name repeated', () => {
  const t = new Topology();
  const p = t.add('pc', 0, 0);
  assert.deepEqual(deviceCaption(p), { name: 'PC0', extra: [] });
  (p.device as Pc).setStatic({ ip: parseIp('192.168.1.10')!, prefix: 24 });
  assert.deepEqual(deviceCaption(p), { name: 'PC0', extra: ['192.168.1.10/24'] });
});

test('a Linux router: one line per NIC with an address; an IOS router keeps its hostname; a cloud its ISP', () => {
  const t = new Topology();
  const lr = t.add('linuxrouter', 0, 0);
  createShell(lr.device as Server, 'linux', 'root').run('ip addr add 10.0.0.1/8 dev eth0; ip addr add 192.168.1.1/24 dev eth2');
  assert.deepEqual(deviceCaption(lr).extra, ['10.0.0.1/8', '192.168.1.1/24']);
  const r = t.add('router', 0, 0);
  assert.deepEqual(deviceCaption(r).extra, [], 'hostname Router: nothing to add');
  (r.device as Router).hostname = 'R1';
  assert.deepEqual(deviceCaption(r).extra, ['R1']);
  assert.deepEqual(deviceCaption(t.add('cloud', 0, 0)), { name: 'Cloud0', extra: ['81.32.0.0/16'] }, 'a cloud: its public block, like a device its IP/CIDR');
});
