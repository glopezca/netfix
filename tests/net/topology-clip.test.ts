/**
 * Copy, paste and duplicate on the workspace: devices with their configuration, the cables between them and the
 * drawings, with new names (and derived host names), a free public block for clouds, an offset, and one undo step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import type { Pc } from '../../src/devices/pc.ts';
import type { Router } from '../../src/devices/router.ts';
import type { Cloud } from '../../src/devices/cloud.ts';
import { applyConfig } from '../../src/ios/session.ts';
import { copyClip, pasteClip } from '../../src/net/topology-clip.ts';
import { historyFor } from '../../src/net/edit-history.ts';
import { parseIp } from '../../src/core/ip.ts';

function lab() {
  const t = new Topology();
  const r = t.add('router', 100, 100);
  const pc = t.add('pc', 100, 300);
  const other = t.add('pc', 400, 300);
  applyConfig(r.device as Router, ['hostname R-AULA', 'interface GigabitEthernet0/0', ' ip address 192.168.1.1 255.255.255.0', ' no shutdown']);
  (pc.device as Pc).setStatic({ ip: parseIp('192.168.1.10')!, prefix: 24, gateway: parseIp('192.168.1.1')! });
  t.connect({ device: r.device.id, port: 'GigabitEthernet0/0' }, { device: pc.device.id, port: 'FastEthernet0' });
  t.connect({ device: other.device.id, port: 'FastEthernet0' }, { device: r.device.id, port: 'GigabitEthernet0/1' });
  const area = t.addAnnotation({ kind: 'rect', points: [{ x: 50, y: 50 }, { x: 200, y: 380 }], color: '#388e3c', fill: true, width: 2, text: 'LAN', size: 14 });
  return { t, r, pc, other, area };
}

test('copy takes the devices, only the cables between them and the drawings; paste gives new names and an offset', () => {
  const { t, r, pc, area } = lab();
  const clip = copyClip(t, [r.device.id, pc.device.id], [area!.id]);
  assert.equal(clip.devices.length, 2);
  assert.equal(clip.links.length, 1, 'the cable to the other PC is not copied');
  const out = pasteClip(t, clip, 40);
  assert.deepEqual(out.devices.map((p) => p.label), ['Router1', 'PC2']);
  assert.deepEqual(out.devices.map((p) => [p.x, p.y]), [[140, 140], [140, 340]]);
  const [r2, pc2] = out.devices;
  assert.equal((r2!.device as Router).hostname, 'R-AULA', 'the configuration comes along (running-config)');
  assert.equal((pc2!.device as Pc).config.ip, parseIp('192.168.1.10'));
  assert.equal((pc2!.device as Pc).name, 'pc2', 'host name derived from the new name');
  assert.notEqual((pc2!.device as Pc).mac, (pc.device as Pc).mac, 'a new MAC');
  assert.ok(t.net.linkAt({ device: r2!.device.id, port: 'GigabitEthernet0/0' }), 'the cable between the copies');
  assert.equal(t.net.linkAt({ device: r2!.device.id, port: 'GigabitEthernet0/1' }), undefined);
  assert.equal(out.drawings.length, 1);
  assert.deepEqual(out.drawings[0]?.points, [{ x: 90, y: 90 }, { x: 240, y: 420 }]);
  assert.equal(out.drawings[0]?.text, 'LAN');
});

test('a pasted cloud gets a free public block; an empty selection copies nothing', () => {
  const t = new Topology();
  const c = t.add('cloud', 100, 100);
  const out = pasteClip(t, copyClip(t, [c.device.id], []), 40);
  assert.notEqual((out.devices[0]!.device as Cloud).settings.block, (c.device as Cloud).settings.block);
  assert.equal(copyClip(t, [], []).devices.length, 0);
});

test('paste is one undo step: undo takes everything away, redo brings it back with its cables', () => {
  const { t, r, pc } = lab();
  const h = historyFor(t);
  const before = t.placed.size;
  const out = h.paste(copyClip(t, [r.device.id, pc.device.id], []), 40);
  assert.equal(t.placed.size, before + 2);
  h.undo();
  assert.equal(t.placed.size, before);
  h.redo();
  assert.equal(t.placed.size, before + 2);
  assert.ok(t.net.linkAt({ device: out.devices[0]!.device.id, port: 'GigabitEthernet0/0' }));
});

test('a group of devices moved or deleted together is one undo step too', () => {
  const { t, r, pc, area } = lab();
  const h = historyFor(t);
  h.batch(() => {
    for (const p of [r, pc]) { const from = { x: p.x, y: p.y }; p.x += 50; h.moved(p.device.id, from); }
    t.updateAnnotation(area!.id, (a) => ({ ...a, points: a.points.map((q) => ({ x: q.x + 50, y: q.y })) }));
  });
  h.undo();
  assert.deepEqual([r.x, pc.x], [100, 100]);
  assert.equal(t.annotations[0]?.points[0]?.x, 50, 'the drawing went back too');
  h.batch(() => { h.removeDevice(r.device.id); h.removeDevice(pc.device.id); });
  assert.equal(t.placed.size, 1);
  h.undo();
  assert.equal(t.placed.size, 3);
  assert.ok(t.net.linkAt({ device: r.device.id, port: 'GigabitEthernet0/0' }), 'and their cables');
});

test('a paste near the edge stays inside the workspace', () => {
  const t = new Topology();
  const pc = t.add('pc', 2350, 1550);
  const out = pasteClip(t, copyClip(t, [pc.device.id], []), 40, { w: 2400, h: 1600, margin: 40 });
  assert.deepEqual([out.devices[0]!.x, out.devices[0]!.y], [2360, 1560]);
});
