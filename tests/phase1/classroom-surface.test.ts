/** Characterization: every value symbol FixITClassroom imports (src/worker/netfix.ts, src/web/core/*) exists with its kind. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowsDevice, parseRestrictions, NO_RESTRICTIONS, DEVICE_KINDS } from '../../src/classroom/restrictions.ts';
import { parseChecklist } from '../../src/classroom/checklist.ts';
import { evaluate, WORK_LIMIT } from '../../src/classroom/evaluate.ts';
import { checkMarkingBudget } from '../../src/classroom/budget.ts';
import { EXAMPLES } from '../../src/net/examples.ts';
import { Topology } from '../../src/net/topology.ts';
import { validateFile } from '../../src/net/topology-file.ts';
import { withWorkLimit, WorkLimitError } from '../../src/net/network.ts';
import { LABS_ES } from '../../src/i18n/es-ES/labs.ts';

test('the symbols the Classroom Worker and web import exist with the expected kind', () => {
  for (const f of [allowsDevice, parseRestrictions, parseChecklist, evaluate, validateFile, withWorkLimit, checkMarkingBudget]) assert.equal(typeof f, 'function', f.name);
  assert.equal(typeof Topology, 'function');
  assert.equal(typeof Topology.fromJSON, 'function');
  assert.equal(typeof WorkLimitError, 'function');
  assert.equal(typeof WORK_LIMIT, 'number');
  assert.ok(Array.isArray(EXAMPLES) && EXAMPLES.length > 0);
  assert.equal(typeof EXAMPLES[0]!.build, 'function');
  assert.ok(Array.isArray(DEVICE_KINDS) && DEVICE_KINDS.includes('router'));
  assert.equal(typeof NO_RESTRICTIONS, 'object');
  assert.equal(typeof LABS_ES, 'object');
});
