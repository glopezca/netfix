/** Undo and redo of workspace edits: devices, cables, moves and drawings (not the configuration of a device). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { EditHistory, MAX_EDITS } from '../../src/net/edit-history.ts';
import { Router } from '../../src/devices/router.ts';

function lab(): { topo: Topology; h: EditHistory; r: string; pc: string } {
  const topo = new Topology();
  const h = new EditHistory(topo);
  const r = h.addDevice('router', 100, 100).device.id;
  const pc = h.addDevice('pc', 300, 100).device.id;
  h.connect({ device: r, port: 'GigabitEthernet0/0' }, { device: pc, port: 'FastEthernet0' });
  return { topo, h, r, pc };
}

test('a deleted device comes back with its cables and its configuration, and can be deleted again', () => {
  // Arrange
  const { topo, h, r, pc } = lab();
  const router = topo.get(r)?.device as Router;
  router.domainName = 'aula.lab';
  // Act
  assert.equal(h.removeDevice(r), true);
  assert.equal(topo.get(r), undefined);
  assert.equal(topo.net.links.length, 0);
  const undone = h.undo();
  // Assert
  assert.equal(undone?.kind, 'remove');
  assert.equal(topo.get(r)?.device, router, 'the same device, with its running state');
  assert.equal((topo.get(r)?.device as Router).domainName, 'aula.lab');
  assert.deepEqual(topo.net.links.map((l) => [l.a.device, l.b.device]), [[r, pc]]);
  assert.deepEqual(h.redo()?.removed, [r], 'redo deletes it again (its windows must close)');
  assert.equal(topo.get(r), undefined);
});

test('adding, cabling and moving are undone in reverse order and redone in order', () => {
  const { topo, h, r, pc } = lab();
  const p = topo.get(pc);
  assert.ok(p);
  p.x = 500;
  h.moved(pc, { x: 300, y: 100 });
  assert.equal(h.undo()?.kind, 'move');
  assert.deepEqual([p.x, p.y], [300, 100]);
  assert.equal(h.undo()?.kind, 'connect');
  assert.equal(topo.net.links.length, 0);
  assert.deepEqual(h.undo()?.removed, [pc], 'undoing an add removes the device');
  assert.equal(topo.get(pc), undefined);
  assert.equal(h.redo()?.kind, 'add');
  assert.equal(topo.get(pc), p);
  h.redo();
  assert.equal(topo.net.links.length, 1);
  h.redo();
  assert.equal(p.x, 500);
  assert.equal(h.canRedo(), false);
  assert.equal(topo.get(r)?.device.id, r);
});

test('a cable deleted by mistake is reconnected to the same ports', () => {
  const { topo, h, r, pc } = lab();
  const link = topo.net.links[0];
  assert.ok(link);
  h.disconnect(link.id);
  assert.equal(topo.net.links.length, 0);
  h.undo();
  assert.deepEqual(topo.net.links.map((l) => [l.a, l.b]), [[{ device: r, port: 'GigabitEthernet0/0' }, { device: pc, port: 'FastEthernet0' }]]);
});

test('drawing changes are one step each; quick restyles (the RGB picker) merge into one', () => {
  const topo = new Topology();
  const h = new EditHistory(topo);
  const a = topo.addAnnotation({ kind: 'rect', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], color: '#388e3c', fill: true, width: 2 });
  assert.ok(a);
  h.syncDrawings(0);
  for (const [i, color] of ['#111111', '#222222', '#333333'].entries()) {
    topo.updateAnnotation(a.id, (x) => ({ ...x, color }));
    h.syncDrawings(1000 + i * 50);
  }
  h.syncDrawings(1200);
  assert.equal(h.undo()?.kind, 'drawings');
  assert.equal(topo.annotations[0]?.color, '#388e3c', 'the three colour steps undo at once');
  h.undo();
  assert.deepEqual(topo.annotations, []);
  h.redo();
  h.redo();
  assert.equal(topo.annotations[0]?.color, '#333333');
});

test('a new edit clears the redo list; the history is bounded and starts empty', () => {
  const { h } = lab();
  h.undo();
  assert.equal(h.canRedo(), true);
  h.addDevice('switch', 50, 50);
  assert.equal(h.canRedo(), false);
  const fresh = new EditHistory(new Topology());
  assert.equal(fresh.undo(), null);
  assert.equal(fresh.redo(), null);
  for (let i = 0; i < MAX_EDITS + 5; i++) fresh.addDevice('pc', 10 + i, 10);
  let n = 0;
  while (fresh.undo()) n++;
  assert.equal(n, MAX_EDITS);
});

test('undoing a cable whose port is now taken leaves it out instead of failing', () => {
  const { topo, h, r, pc } = lab();
  h.removeDevice(pc);
  // Not through the history (as a file or a lab would do it).
  const other = topo.add('pc', 400, 400).device.id;
  topo.connect({ device: r, port: 'GigabitEthernet0/0' }, { device: other, port: 'FastEthernet0' });
  assert.equal(h.undo()?.skipped, 1, 'the cable left out is reported');
  assert.ok(topo.get(pc));
  assert.equal(topo.net.links.filter((l) => l.b.device === pc).length, 0);
});

test('a restored device never shares its name or its public block with one added meanwhile', () => {
  const topo = new Topology();
  const h = new EditHistory(topo);
  const a = h.addDevice('cloud', 100, 100);
  const pc = h.addDevice('pc', 300, 300);
  h.removeDevice(a.device.id);
  h.removeDevice(pc.device.id);
  const b = topo.add('cloud', 200, 100);
  const pc2 = topo.add('pc', 400, 300);
  assert.equal(pc2.label, pc.label, 'the name was free again');
  h.undo();
  h.undo();
  assert.notEqual(topo.get(pc.device.id)?.label, pc2.label);
  const block = (id: string): number | undefined => {
    const d = topo.get(id)?.device;
    return d && 'settings' in d && typeof d.settings === 'object' && d.settings && 'block' in d.settings ? Number(d.settings.block) : undefined;
  };
  assert.ok(block(a.device.id) !== undefined);
  assert.notEqual(block(a.device.id), block(b.device.id));
  assert.notEqual(topo.get(a.device.id)?.label, b.label);
});
