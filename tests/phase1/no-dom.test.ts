/** Characterization (Phase 1, PR 1.1): the marking path loads and runs in Node with no DOM, as Classroom's Worker does. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import { evaluate } from '../../src/classroom/evaluate.ts';
import { parseRestrictions } from '../../src/classroom/restrictions.ts';
import { EXAMPLES } from '../../src/net/examples.ts';

test('Node has no document or window, and loading and marking a lab works anyway', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
  const r = evaluate(EXAMPLES[0]!.build().toJSON(), parseChecklist([{ id: 'pc', check: { type: 'device', device: 'PC0', kind: 'pc' } }]));
  assert.deepEqual([r.score, r.max], [1, 1]);
  assert.equal(typeof parseRestrictions({}), 'object');
  assert.equal(typeof document, 'undefined');
});
