/** Core entry imported alone in Node (CORE.md paso 3; R7: load-time registries are filled by the entry). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../src/pkg/core.ts';

const SURFACE = [
  'FILE_VERSION', 'validateFile', 'Topology', 'EXAMPLES', 'allowsDevice', 'allowsLab', 'allowsTab', 'parseRestrictions',
  'parseChecklist', 'evaluate', 'WORK_LIMIT', 'evaluateFile', 'checkMarkingBudget', 'MARK_MAX_DEVICES',
  'MARK_MAX_CONFIG_LINES', 'withWorkLimit', 'WorkLimitError',
];

test('the entry exposes the PUBLIC-API 3.1-3.2 surface', () => {
  for (const name of SURFACE) assert.notEqual((core as Record<string, unknown>)[name], undefined, name);
  assert.equal(core.FILE_VERSION, 2);
});

test('a lab loads and is evaluated from the entry alone', () => {
  const file = core.EXAMPLES[0]!.build().toJSON();
  const topo = core.Topology.fromJSON(core.validateFile(file));
  assert.equal(topo.placed.size, file.devices.length);
  const checklist = core.parseChecklist([{ id: 'pc', check: { type: 'device', device: 'PC0', kind: 'pc' } }]);
  const r = core.evaluate(file, checklist);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0]!.id, 'pc');
});

test('R7: the registries fill on import (host files readable, which needs registerHostFs)', () => {
  const file = core.EXAMPLES[0]!.build().toJSON();
  const r = core.evaluate(file, core.parseChecklist([{ id: 'f', check: { type: 'file', device: 'PC0', path: '/etc/hostname' } }]));
  assert.equal(r.items[0]!.passed, true, r.items[0]!.detail);
});
