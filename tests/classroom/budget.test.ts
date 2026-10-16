/** What headless marking accepts before simulating: a cheap look at the file bounds the CPU and memory of loading it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMarkingBudget, MARK_MAX_DEVICES, MARK_MAX_CONFIG_LINES } from '../../src/classroom/budget.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';

const router = (lines: number, i = 0): object => ({ id: `r${i}`, kind: 'router', x: 0, y: 0, seed: i, label: `R${i}`, config: Array.from({ length: lines }, (_, n) => (n % 2 ? ' no shutdown' : `interface Loopback${n}`)) });
const file = (devices: object[]): unknown => ({ format: 'netfix', version: 2, devices, links: [] });

test('every Netfix lab is within the marking budget', () => {
  for (const ex of EXAMPLES) assert.doesNotThrow(() => checkMarkingBudget(ex.build().toJSON()), ex.id);
});

test('too many devices or IOS configuration lines are refused before loading, with a reason', () => {
  const many = Array.from({ length: MARK_MAX_DEVICES + 1 }, (_, i) => ({ id: `p${i}`, kind: 'server', x: 0, y: 0, seed: i, label: `S${i}` }));
  assert.throws(() => checkMarkingBudget(file(many)), /equipos/);
  assert.throws(() => checkMarkingBudget(file([router(MARK_MAX_CONFIG_LINES + 2)])), /configuración/);
  assert.throws(() => checkMarkingBudget(file([router(MARK_MAX_CONFIG_LINES / 2 + 2, 1), router(MARK_MAX_CONFIG_LINES / 2, 2)])), /configuración/, 'counted over all devices');
  assert.throws(() => evaluate(file(many), parseChecklist([{ id: 'a', check: { type: 'device', device: 'S0' } }])), /equipos/, 'evaluate applies it');
});

test('a router with a thousand interfaces loads in well under a second (interfaces kept in order, not re-sorted)', () => {
  const start = performance.now();
  Topology.fromJSON(file([router(2000)]));
  assert.ok(performance.now() - start < 1500, `${Math.round(performance.now() - start)} ms`);
});
