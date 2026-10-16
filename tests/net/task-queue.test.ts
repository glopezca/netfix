/** Event queue of the simulation: ordered by time then insertion, logarithmic, and a work limit for the marking. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../../src/net/task-queue.ts';
import { withWorkLimit, WorkLimitError, Network } from '../../src/net/network.ts';
import { Topology } from '../../src/net/topology.ts';
import type { Switch } from '../../src/devices/switch.ts';
import type { Pc } from '../../src/devices/pc.ts';

test('tasks come out by time and, at the same time, in insertion order', () => {
  const q = new TaskQueue<string>();
  [[5, 'c'], [1, 'a'], [5, 'd'], [3, 'b'], [1, 'a2']].forEach(([t, v], i) => q.push({ time: t as number, seq: i, value: v as string }));
  assert.equal(q.peek()?.value, 'a');
  const out: string[] = [];
  for (let x = q.pop(); x; x = q.pop()) out.push(x.value);
  assert.deepEqual(out, ['a', 'a2', 'b', 'c', 'd']);
  assert.equal(q.size, 0);
});

test('a work limit stops a simulation that would not end and is restored afterwards', () => {
  const net = new Network();
  const tick = (): void => net.schedule(0, tick);
  tick();
  assert.throws(() => withWorkLimit(1000, () => net.runFor(1)), WorkLimitError);
  assert.equal(withWorkLimit(10, () => 'ok'), 'ok');
});

test('a switching loop (no spanning tree) is congestion, not a hang: frames beyond the in-flight cap are dropped', () => {
  const t = new Topology();
  const a = t.add('switch', 0, 0).device as Switch;
  const b = t.add('switch', 0, 0).device as Switch;
  const pc = t.add('pc', 0, 0).device as Pc;
  for (const p of [1, 2]) t.connect({ device: a.id, port: `FastEthernet0/${p}` }, { device: b.id, port: `FastEthernet0/${p}` });
  t.connect({ device: pc.id, port: 'FastEthernet0' }, { device: a.id, port: 'FastEthernet0/24' });
  pc.useDhcp();
  const start = performance.now();
  t.settle(5000);
  assert.ok(performance.now() - start < 5000, 'settles in bounded time');
  assert.ok(t.net.pending() <= 20_000);
});
