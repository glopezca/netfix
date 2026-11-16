/** Topology accepts an optional clock base: same base, same simulated start; omitted, today's Date.now(). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology } from '../../src/net/topology.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { formatToolbarClock } from '../../src/core/clock.ts';

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

test('the toolbar clock shows the simulated time in the client\'s own zone, with its name', () => {
  const t = Date.UTC(2026, 10, 16, 20, 0, 40);
  assert.equal(formatToolbarClock(t, 'es-ES', 'Europe/Madrid'), '21:00:40 CET');
  assert.equal(formatToolbarClock(t, 'en-GB', 'Atlantic/Canary'), '20:00:40 WET');
  assert.equal(formatToolbarClock(t, 'en-GB', 'UTC'), '20:00:40 UTC');
  // Without a zone: the browser's (the system clock's) zone, not UTC.
  assert.equal(formatToolbarClock(t, 'es-ES'), formatToolbarClock(t, 'es-ES', Intl.DateTimeFormat().resolvedOptions().timeZone));
});
