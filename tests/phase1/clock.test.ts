/** Topology accepts an optional clock base: same base, same simulated start; omitted, today's Date.now(). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { EXAMPLES } from '../../src/net/examples.ts';

const BASE = Date.UTC(2024, 0, 2, 3, 4, 5);

test('baseMs fixes the clock start, also through fromJSON', () => {
  assert.equal(new Topology(BASE).clock.now(), BASE);
  const file = EXAMPLES[0]!.build().toJSON();
  const a = Topology.fromJSON(file, BASE);
  const b = Topology.fromJSON(file, BASE);
  assert.ok(a.clock.now() >= BASE && a.clock.now() < BASE + 60_000); // fromJSON settles the lab a few sim seconds
  assert.equal(a.clock.now(), b.clock.now());
});

test('without baseMs the clock starts at the wall clock', () => {
  const before = Date.now();
  const t = new Topology().clock.now();
  assert.ok(t >= before && t <= Date.now());
});
