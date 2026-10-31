/** The mission a topology file belongs to, and the hints already shown: untrusted JSON, saved with the workspace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMissionState, withHint } from '../../src/labs/mission-state.ts';
import { Topology } from '../../src/net/topology.ts';

test('a valid mission state is kept; anything else is no mission', () => {
  assert.deepEqual(parseMissionState({ id: 'basico', hints: ['1.1', '2.3'] }), { id: 'basico', hints: ['1.1', '2.3'] });
  assert.deepEqual(parseMissionState({ id: 'relay' }), { id: 'relay', hints: [] });
  for (const bad of [undefined, null, 'basico', [], { id: '' }, { id: 'x'.repeat(65) }, { id: 'a b' }, { id: 7 }]) {
    assert.equal(parseMissionState(bad), undefined, JSON.stringify(bad));
  }
});

test('hint ids are task.level, deduplicated and bounded', () => {
  const s = parseMissionState({ id: 'basico', hints: ['1.1', '1.1', 'x', '99.9', '1.4', 3, ...Array.from({ length: 100 }, (_, i) => `${(i % 20) + 1}.${(i % 3) + 1}`)] });
  assert.ok(s);
  assert.ok(s.hints.every((h) => /^\d{1,2}\.[1-3]$/.test(h)));
  assert.equal(new Set(s.hints).size, s.hints.length);
  assert.ok(s.hints.length <= 60);
});

test('a state remembers that the solution was loaded (only an explicit true)', () => {
  assert.deepEqual(parseMissionState({ id: 'basico', hints: ['1.1'], solution: true }), { id: 'basico', hints: ['1.1'], solution: true });
  for (const v of [false, 'true', 1, null]) assert.equal('solution' in (parseMissionState({ id: 'basico', solution: v }) ?? {}), false, String(v));
});

test('withHint adds a hint once and keeps the state immutable', () => {
  const s = { id: 'basico', hints: ['1.1'] };
  const next = withHint(s, '1.2');
  assert.deepEqual(next.hints, ['1.1', '1.2']);
  assert.deepEqual(s.hints, ['1.1']);
  assert.equal(withHint(next, '1.2'), next);
});

test('the mission travels with the topology file', () => {
  const t = new Topology();
  assert.equal('mission' in t.toJSON(), false);
  t.mission = { id: 'basico', hints: ['1.1'] };
  const back = Topology.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  assert.deepEqual(back.mission, { id: 'basico', hints: ['1.1'] });
});

test('a huge hints array is cut to the limit before it is read', () => {
  const hints = ['1.1', ...Array.from({ length: 1_000_000 }, () => '2.2')];
  const state = parseMissionState({ id: 'basico', hints });
  assert.deepEqual(state?.hints, ['1.1', '2.2']);
});
